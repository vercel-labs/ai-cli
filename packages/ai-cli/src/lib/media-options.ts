import { readFile } from "node:fs/promises";

import { createGateway } from "@ai-sdk/gateway";
import type { generateImage } from "ai";

import type { Command } from "./command.js";
import {
  parseInteger,
  parseNonNegativeInt,
  parsePositiveInt,
} from "./parse.js";

export interface MediaOptions {
  model?: string;
  output?: string;
  n?: string;
  seed?: string;
  maxRetries?: string;
  providerOptions?: string;
  headers?: string;
  baseUrl?: string;
  teamIdOrSlug?: string;
  quiet?: boolean;
  json?: boolean;
  concurrency?: string;
  preview?: boolean;
  timeout: number;
}

export function addGatewayConnectionOptions(command: Command): Command {
  return command
    .option("--headers <path>", "JSON file of HTTP headers")
    .option(
      "--base-url <url>",
      "Gateway baseURL (default: SDK gateway endpoint)"
    )
    .option("--team-id-or-slug <team>", "Gateway teamIdOrSlug");
}

export function addGatewayOptions(command: Command): Command {
  return addGatewayConnectionOptions(command).option(
    "--max-retries <n>",
    "SDK maxRetries (default: 2; 0 disables retries)"
  );
}

export function addMediaOptions(
  command: Command,
  concurrency: number,
  start = false
): Command {
  const common = addGatewayOptions(command)
    .option(
      "-m, --model <model>",
      "Model ID, comma-separated for multiple models"
    )
    .option(
      "-o, --output <path>",
      start
        ? "Persist operation JSON to this file (also printed to stdout)"
        : "Output file or directory (use a trailing / for a new directory)"
    )
    .option("-n, --n <n>", "SDK number of outputs per model (default: 1)")
    .option("--seed <integer>", "SDK generation seed, including 0")
    .option(
      "--provider-options <path>",
      "JSON file of SDK providerOptions, including gateway routing"
    )
    .option("-q, --quiet", "Suppress progress; errors remain visible")
    .option(
      "--json",
      start
        ? "JSON operation output (always enabled)"
        : "Write a JSON manifest with all outputs and SDK diagnostics"
    );
  if (start) return common;
  return common
    .option("--no-preview", "Disable inline media previews")
    .option(
      "-p, --concurrency <n>",
      `Parallel models (default: ${concurrency}; SDK controls per-call batching)`
    );
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function readJson(path: string, name: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"), (_key, value: unknown) => {
      if (typeof value === "number" && !Number.isFinite(value))
        throw new Error("JSON numbers must be finite");
      return value;
    });
  } catch (error) {
    throw new Error(
      `--${name}: could not read JSON from ${path}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function readJsonObject(
  path: string,
  name: string
): Promise<Record<string, unknown>> {
  const value = await readJson(path, name);
  if (!isObject(value)) throw new Error(`--${name} must contain a JSON object`);
  return value;
}

export function validateUrl(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`--${name} must be an HTTP(S) URL`);
  }
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error(`--${name} must be an HTTP(S) URL`);
  return value;
}

export async function mediaSettings(
  opts: Partial<MediaOptions>,
  defaultConcurrency = 1
): Promise<{
  gateway: ReturnType<typeof createGateway>;
  n: number;
  seed: number | undefined;
  maxRetries: number | undefined;
  concurrency: number;
  providerOptions: NonNullable<
    Parameters<typeof generateImage>[0]["providerOptions"]
  >;
  headers: Record<string, string>;
  catalogOptions: {
    baseURL: string | undefined;
    headers: Record<string, string>;
  };
}> {
  const n = opts.n === undefined ? 1 : parsePositiveInt(opts.n, "n");
  const seed =
    opts.seed === undefined ? undefined : parseInteger(opts.seed, "seed");
  const maxRetries =
    opts.maxRetries === undefined
      ? undefined
      : parseNonNegativeInt(opts.maxRetries, "max-retries");
  const concurrency =
    opts.concurrency === undefined
      ? defaultConcurrency
      : parsePositiveInt(opts.concurrency, "concurrency");
  const baseURL =
    opts.baseUrl ?? (process.env.AI_GATEWAY_BASE_URL || undefined);
  if (baseURL !== undefined) validateUrl(baseURL, "base-url");
  const customHeaders = opts.headers
    ? await readJsonObject(opts.headers, "headers")
    : {};
  if (
    !Object.values(customHeaders).every((value) => typeof value === "string")
  ) {
    throw new Error("--headers values must be strings");
  }
  // Validate header names and values locally, before discovery or generation.
  const normalizedHeaders = new Headers({
    "http-referer": "https://github.com/vercel-labs/ai-cli",
    "x-title": "ai-cli",
  });
  for (const [name, value] of Object.entries(customHeaders))
    normalizedHeaders.set(name, value as string);
  const headers = Object.fromEntries(normalizedHeaders);
  const rawOptions = opts.providerOptions
    ? await readJsonObject(opts.providerOptions, "provider-options")
    : {};
  if (!Object.values(rawOptions).every(isObject)) {
    throw new Error(
      "--provider-options must map provider names to JSON objects"
    );
  }
  const providerOptions = rawOptions as NonNullable<
    Parameters<typeof generateImage>[0]["providerOptions"]
  >;
  const teamIdOrSlug =
    opts.teamIdOrSlug ?? process.env.AI_GATEWAY_TEAM_ID_OR_SLUG;
  const gateway = createGateway({
    baseURL,
    teamIdOrSlug,
    headers,
    // Gateway 4.0.101 drops zero seeds with a truthiness check. Restore only
    // an explicitly requested zero on media generation/start requests.
    fetch: Object.assign(
      async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1]
      ) => {
        const url = String(input);
        if (
          seed === 0 &&
          /\/(?:image-model|video-model(?:\/start)?)$/.test(url) &&
          typeof init?.body === "string"
        ) {
          const body = JSON.parse(init.body);
          if (body.seed === undefined)
            init = { ...init, body: JSON.stringify({ ...body, seed: 0 }) };
        }
        return globalThis.fetch(input, init);
      },
      { preconnect: globalThis.fetch.preconnect }
    ),
  });
  return {
    gateway,
    n,
    seed,
    maxRetries,
    concurrency,
    providerOptions,
    headers,
    catalogOptions: {
      baseURL,
      headers: {
        ...(teamIdOrSlug ? { "x-vercel-ai-gateway-team": teamIdOrSlug } : {}),
        ...headers,
      },
    },
  };
}

/** Deep merge provider objects without dropping siblings or accepting prototype keys. */
export function mergeOptions(
  left: Record<string, unknown>,
  right: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...left };
  for (const [key, value] of Object.entries(right)) {
    Object.defineProperty(result, key, {
      value:
        isObject(value) && isObject(left[key])
          ? mergeOptions(left[key], value)
          : value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return result;
}

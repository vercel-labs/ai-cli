import {
  generateText,
  gateway,
  type ImagePart,
  type ModelMessage,
  type TextPart,
} from "ai";

import type { Command } from "../lib/command.js";
import {
  collectImageReference,
  isLikelyImage,
  loadImageReferences,
  type ImageReference,
} from "../lib/image-references.js";
import { buildJobs, runJobs } from "../lib/jobs.js";
import { fetchGatewayModels, resolveModels } from "../lib/models.js";
import {
  addCacheOptions,
  cacheKey,
  getCacheEntry,
  imagesHashForRefs,
  resolveCacheTtl,
  setCacheEntry,
  shouldUseCache,
} from "../lib/cache.js";
import type { OutputFormat } from "../lib/output.js";
import { parsePositiveInt, parseTemperature } from "../lib/parse.js";
import { readStdin, stdinAsText } from "../lib/stdin.js";
import { addTimeoutOption, timeoutMs } from "../lib/timeout.js";

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_TIMEOUT_MS = 120_000;

interface TextOptions {
  model?: string;
  output?: string;
  format?: string;
  image?: string[];
  system?: string;
  maxTokens?: string;
  temperature?: string;
  count?: string;
  concurrency?: string;
  quiet?: boolean;
  json?: boolean;
  cache?: boolean;
  cacheTtl?: string;
  timeout: number;
}

type TextPrompt = string | ModelMessage[];

function resolveFormat(fmt?: string): OutputFormat {
  if (!fmt || fmt === "md") return "md";
  if (fmt === "txt") return "txt";
  throw new Error(`--format must be one of: md, txt (got "${fmt}")`);
}

export function registerTextCommand(program: Command) {
  const command = program
    .command("text")
    .description("Generate text from a prompt")
    .argument("[prompt]", "The prompt to generate text from")
    .option(
      "-m, --model <model>",
      "Model ID (creator/model-name), comma-separated for multi-model"
    )
    .option("-o, --output <path>", "Output file path or directory")
    .option("-f, --format <fmt>", "Output format: md, txt (default: md)")
    .option(
      "-i, --image <path-or-url>",
      "Image input path or URL for vision (repeatable)",
      collectImageReference,
      []
    )
    .option("-n, --count <n>", "Number of generations (default: 1)")
    .option(
      "-p, --concurrency <n>",
      `Max parallel generations (default: ${DEFAULT_CONCURRENCY})`
    )
    .option("-s, --system <prompt>", "System prompt")
    .option("--max-tokens <n>", "Maximum tokens to generate")
    .option("-t, --temperature <n>", "Temperature (0-2)")
    .option("-q, --quiet", "Suppress progress output")
    .option("--json", "Output metadata as JSON");
  addCacheOptions(command);
  addTimeoutOption(command, DEFAULT_TIMEOUT_MS).action(
    async (rawPrompt: string | undefined, opts: TextOptions) => {
      const prompt = rawPrompt?.trim() || undefined;
      const stdin = await readStdin();
      const imageReferenceInputs = opts.image ?? [];
      if (!prompt && !stdin && imageReferenceInputs.length === 0) {
        process.stderr.write(
          "Error: prompt, stdin, or image is required (provide a prompt, --image, or pipe text/image via stdin)\n"
        );
        process.exit(1);
      }

      let referenceImages: ImageReference[] = [];
      try {
        referenceImages = await loadImageReferences(imageReferenceInputs);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`Error: ${message}\n`);
        process.exit(1);
      }

      const stdinBytes = stdin ? new Uint8Array(stdin) : undefined;
      const stdinIsImage = stdinBytes ? isLikelyImage(stdinBytes) : false;
      const images: ImageReference[] = [
        ...(stdinBytes && stdinIsImage ? [stdinBytes] : []),
        ...referenceImages,
      ];
      const stdinText = stdin && !stdinIsImage ? stdinAsText(stdin) : undefined;
      const textPrompt = buildTextPrompt({ prompt, stdinText, images });

      const format = resolveFormat(opts.format);
      const gatewayModels = await fetchGatewayModels();
      const models = resolveModels("text", opts.model, gatewayModels.text);
      const countPerModel = opts.count
        ? parsePositiveInt(opts.count, "count")
        : 1;
      const maxTokens = opts.maxTokens
        ? parsePositiveInt(opts.maxTokens, "max-tokens")
        : undefined;
      const temperature = opts.temperature
        ? parseTemperature(opts.temperature)
        : undefined;

      const jobs = buildJobs(models, countPerModel);
      const useCache = shouldUseCache(opts);
      const cacheTtl = resolveCacheTtl(opts as { cacheTtl?: string });
      const cacheSeq = new Map<string, number>();

      const { total, failed } = await runJobs(
        jobs,
        async (modelId) => {
          const seq = cacheSeq.get(modelId) ?? 0;
          cacheSeq.set(modelId, seq + 1);
          const key = useCache
            ? cacheKey({
                command: "text",
                model: modelId,
                prompt: textPrompt,
                system: opts.system,
                temperature,
                maxTokens,
                imagesHash: images.length > 0 ? imagesHashForRefs(images) : undefined,
                extra: { format, seq },
              })
            : undefined;
          if (key) {
            const cached = getCacheEntry(key, cacheTtl);
            if (cached) {
              if (!opts.quiet) process.stderr.write(`Cache hit for ${modelId}\n`);
              return { data: cached.data as string, id: cached.id };
            }
          }
          const abort = AbortSignal.timeout(timeoutMs(opts.timeout));
          const result = await generateText({
            headers: {
              "http-referer": "https://github.com/vercel-labs/ai-cli",
              "x-title": "ai-cli",
            },
            model: gateway(modelId),
            prompt: textPrompt,
            system: opts.system,
            maxOutputTokens: maxTokens,
            temperature,
            abortSignal: abort,
          });
          const generated = { data: result.text, id: result.response.id };
          if (key) setCacheEntry(key, generated, cacheTtl);
          return generated;
        },
        {
          noun: "text",
          format,
          outputPath: opts.output,
          quiet: opts.quiet,
          json: opts.json,
          concurrency: opts.concurrency
            ? parsePositiveInt(opts.concurrency, "concurrency")
            : DEFAULT_CONCURRENCY,
        }
      );
      if (failed === total) process.exit(1);
      if (failed > 0) process.exit(2);
    }
  );
}

function buildTextPrompt({
  prompt,
  stdinText,
  images,
}: {
  prompt?: string;
  stdinText?: string;
  images: ImageReference[];
}): TextPrompt {
  if (images.length === 0) {
    if (stdinText && prompt) return `${stdinText}\n\n---\n\n${prompt}`;
    if (stdinText) return stdinText;
    return prompt!;
  }

  const content: Array<TextPart | ImagePart> = [];

  if (stdinText) content.push({ type: "text", text: stdinText });
  for (const image of images) content.push({ type: "image", image });
  if (prompt) {
    content.push({ type: "text", text: prompt });
  } else if (!stdinText) {
    content.push({
      type: "text",
      text:
        images.length === 1 ? "Describe this image." : "Describe these images.",
    });
  }

  return [{ role: "user", content }];
}

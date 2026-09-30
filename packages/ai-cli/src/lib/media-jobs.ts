import type { GeneratedFile } from "ai";

import type { MediaOptions } from "./media-options.js";
import { writeOutput } from "./output.js";
import { pMap } from "./p-map.js";

export interface MediaArtifact {
  data: Buffer | string;
  mediaType: string;
  id?: string;
  providerMetadata?: unknown;
}

export interface MediaFailure {
  kind: "batch" | "download";
  index: number;
  requested?: number;
  error: ReturnType<typeof errorDetails>;
}

export interface MediaResult {
  artifacts: MediaArtifact[];
  calls?: Array<{ images: MediaArtifact[]; [key: string]: unknown }>;
  failures?: MediaFailure[];
  [key: string]: unknown;
}

export async function runMediaBatches<T>(
  n: number,
  maxPerCall: number | undefined,
  generate: (count: number) => Promise<T>
): Promise<
  Array<
    | { index: number; requested: number; result: T; error?: never }
    | {
        index: number;
        requested: number;
        result?: never;
        error: ReturnType<typeof errorDetails>;
      }
  >
> {
  const perCall = Math.min(maxPerCall ?? n, n);
  const counts = Array.from({ length: Math.ceil(n / perCall) }, (_, index) =>
    Math.min(perCall, n - index * perCall)
  );
  const outcomes = await Promise.allSettled(counts.map(generate));
  return outcomes.map((outcome, index) => ({
    index: index + 1,
    requested: counts[index]!,
    ...(outcome.status === "fulfilled"
      ? { result: outcome.value }
      : { error: errorDetails(outcome.reason) }),
  }));
}

export function artifact(file: GeneratedFile, id?: string): MediaArtifact {
  return {
    data: Buffer.from(file.uint8Array),
    mediaType: file.mediaType,
    providerMetadata: file.providerMetadata,
    id,
  };
}

export function errorDetails(error: unknown) {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: "Error", message: String(error) };
}

export async function runMediaJobs(
  models: string[],
  generate: (model: string) => Promise<MediaResult>,
  opts: Pick<MediaOptions, "output" | "json" | "quiet" | "preview"> & {
    n: number;
    concurrency: number;
    format: "image" | "video";
  }
) {
  const start = Date.now();
  const results = await pMap(
    models,
    async (model, index) => {
      const jobStart = Date.now();
      if (!opts.quiet)
        process.stderr.write(`Generating ${opts.format} with ${model}\n`);
      const files: Record<string, unknown>[] = [];
      let metadata: Record<string, unknown> = {};
      try {
        const {
          artifacts,
          calls,
          failures = [],
          ...diagnostics
        } = await generate(model);
        metadata = diagnostics;
        if (failures.length) metadata.failures = failures;
        const artifactInfo = new Map(
          artifacts.map((item) => [
            item,
            {
              file: null as string | null,
              mediaType: item.mediaType,
              id: item.id,
              providerMetadata: item.providerMetadata,
            },
          ])
        );
        if (calls)
          metadata.calls = calls.map((call) => ({
            ...call,
            images: call.images.map((item) => artifactInfo.get(item)),
          }));
        if (!artifacts.length && !failures.length)
          throw new Error(`Model ${model} did not return any ${opts.format}s`);
        const multiple =
          models.length > 1 || opts.n > 1 || artifacts.length > 1;
        for (const [artifactIndex, item] of artifacts.entries()) {
          const file = await writeOutput({
            data: item.data,
            format: opts.format,
            outputPath: opts.output,
            outputId: item.id,
            mediaType: item.mediaType,
            suffix: multiple ? `${index + 1}-${artifactIndex + 1}` : undefined,
            forceFile: opts.json || multiple,
            quiet: opts.json || opts.quiet,
            display: opts.json ? false : opts.preview,
          });
          const info = artifactInfo.get(item)!;
          info.file = file;
          files.push(info);
        }
        if (
          typeof diagnostics.text === "string" &&
          diagnostics.text &&
          !opts.json
        ) {
          process.stderr.write(`${diagnostics.text}\n`);
        }
        const incomplete = artifacts.length < opts.n || failures.length > 0;
        const detail = incomplete
          ? {
              name: "IncompleteMediaResult",
              message: `Requested ${opts.n} ${opts.format} output(s), saved ${files.length}${failures.length ? `; ${failures.length} batch or download failure(s): ${failures[0]!.error.message}` : ""}`,
            }
          : undefined;
        if (detail)
          process.stderr.write(`Error (${model}): ${detail.message}\n`);
        return {
          model,
          success: !detail,
          elapsedMs: Date.now() - jobStart,
          ...metadata,
          ...(detail ? { error: detail } : {}),
          [opts.format === "image" ? "images" : "videos"]: files,
        };
      } catch (error) {
        const detail = errorDetails(error);
        process.stderr.write(`Error (${model}): ${detail.message}\n`);
        return {
          model,
          success: false,
          elapsedMs: Date.now() - jobStart,
          ...metadata,
          error: detail,
          [opts.format === "image" ? "images" : "videos"]: files,
        };
      }
    },
    opts.concurrency
  );
  const values = results.map((result) => {
    if (result.status === "rejected") throw result.reason;
    return result.value;
  });
  if (opts.json)
    process.stdout.write(
      JSON.stringify(
        { elapsedMs: Date.now() - start, results: values },
        null,
        2
      ) + "\n"
    );
  const failed = values.filter((value) => !value.success).length;
  if (failed) process.exitCode = failed === models.length ? 1 : 2;
}

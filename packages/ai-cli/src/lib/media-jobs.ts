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

export interface MediaResult {
  artifacts: MediaArtifact[];
  calls?: Array<{ images: MediaArtifact[]; [key: string]: unknown }>;
  [key: string]: unknown;
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
        const { artifacts, calls, ...diagnostics } = await generate(model);
        metadata = diagnostics;
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
        if (!artifacts.length)
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
        return {
          model,
          success: true,
          elapsedMs: Date.now() - jobStart,
          ...metadata,
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

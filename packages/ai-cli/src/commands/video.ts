import { experimental_generateVideo as generateVideo, gateway } from "ai";
import type { Command } from "commander";

import { buildJobs, runJobs } from "../lib/jobs.js";
import { resolveModels } from "../lib/models.js";
import {
  parsePositiveInt,
  parseAspectRatio,
  parseNonNegativeFloat,
} from "../lib/parse.js";
import { readStdin } from "../lib/stdin.js";

const DEFAULT_CONCURRENCY = 2;
const DEFAULT_TIMEOUT_MS = 300_000;

interface VideoOptions {
  model?: string;
  output?: string;
  count?: string;
  aspectRatio?: string;
  duration?: string;
  quiet?: boolean;
  json?: boolean;
  concurrency?: string;
  preview?: boolean;
  timeout?: string;
}

export function registerVideoCommand(program: Command) {
  program
    .command("video")
    .description("Generate a video from a prompt")
    .argument("[prompt]", "The prompt to generate a video from")
    .option(
      "-m, --model <model>",
      "Model ID (creator/model-name), comma-separated for multi-model"
    )
    .option("-o, --output <path>", "Output file path or directory")
    .option("-n, --count <n>", "Number of videos per model (default: 1)")
    .option("--aspect-ratio <W:H>", "Aspect ratio (e.g. 16:9)")
    .option("--duration <seconds>", "Video duration in seconds")
    .option("-q, --quiet", "Suppress progress output")
    .option("--json", "Output metadata as JSON")
    .option(
      "--no-preview",
      "Disable inline video frame preview in supported terminals"
    )
    .option(
      "-p, --concurrency <n>",
      `Max parallel generations (default: ${DEFAULT_CONCURRENCY})`
    )
    .option(
      "--timeout <seconds>",
      `Per-request timeout in seconds (default: ${DEFAULT_TIMEOUT_MS / 1000})`
    )
    .action(async (rawPrompt: string | undefined, opts: VideoOptions) => {
      const prompt = rawPrompt?.trim() || undefined;
      const stdin = await readStdin();
      if (!prompt && !stdin) {
        process.stderr.write(
          "Error: prompt is required (provide as argument or pipe via stdin)\n"
        );
        process.exit(1);
      }

      let videoPrompt: string | { image: Uint8Array; text?: string } = prompt!;
      if (stdin) {
        videoPrompt = prompt
          ? { image: new Uint8Array(stdin), text: prompt }
          : { image: new Uint8Array(stdin) };
      }

      const models = resolveModels("video", opts.model);
      const countPerModel = opts.count
        ? parsePositiveInt(opts.count, "count")
        : 1;
      const aspectRatio = opts.aspectRatio
        ? parseAspectRatio(opts.aspectRatio)
        : undefined;
      const duration = opts.duration
        ? parseNonNegativeFloat(opts.duration, "duration")
        : undefined;

      const jobs = buildJobs(models, countPerModel);

      const timeoutMs = opts.timeout
        ? parsePositiveInt(opts.timeout, "timeout") * 1000
        : DEFAULT_TIMEOUT_MS;

      const { total, failed } = await runJobs(
        jobs,
        async (modelId) => {
          const abort = AbortSignal.timeout(timeoutMs);
          const result = await generateVideo({
            headers: {
              "http-referer": "https://github.com/vercel-labs/ai-cli",
              "x-title": "ai-cli",
            },
            model: gateway.video(modelId),
            prompt: videoPrompt,
            abortSignal: abort,
            aspectRatio,
            duration,
          });
          return Buffer.from(result.video.uint8Array);
        },
        {
          noun: "video",
          format: "video",
          outputPath: opts.output,
          quiet: opts.quiet,
          json: opts.json,
          display: opts.preview,
          concurrency: opts.concurrency
            ? parsePositiveInt(opts.concurrency, "concurrency")
            : DEFAULT_CONCURRENCY,
        }
      );
      if (failed === total) process.exit(1);
      if (failed > 0) process.exit(2);
    });
}

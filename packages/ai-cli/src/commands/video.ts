import { experimental_generateVideo as generateVideo, gateway } from "ai";

import type { Command } from "../lib/command.js";
import {
  collectImageReference,
  loadImageReferences,
  type ImageReference,
} from "../lib/image-references.js";
import { buildJobs, runJobs } from "../lib/jobs.js";
import { fetchGatewayModels, resolveModels } from "../lib/models.js";
import {
  parsePositiveInt,
  parseAspectRatio,
  parseNonNegativeFloat,
  parseSize,
} from "../lib/parse.js";
import { responseIdFromHeaders } from "../lib/response-id.js";
import { readStdin } from "../lib/stdin.js";
import { addTimeoutOption, timeoutMs } from "../lib/timeout.js";

const DEFAULT_CONCURRENCY = 2;
const DEFAULT_TIMEOUT_MS = 300_000;

interface VideoOptions {
  model?: string;
  output?: string;
  image?: string[];
  startFrame?: string[];
  endFrame?: string[];
  count?: string;
  aspectRatio?: string;
  resolution?: string;
  duration?: string;
  quiet?: boolean;
  json?: boolean;
  concurrency?: string;
  preview?: boolean;
  timeout: number;
}

export function registerVideoCommand(program: Command) {
  const command = program
    .command("video")
    .description("Generate a video from a prompt or start/end frames")
    .argument("[prompt]", "The prompt to generate a video from")
    .option(
      "-m, --model <model>",
      "Model ID (creator/model-name), comma-separated for multi-model"
    )
    .option("-o, --output <path>", "Output file path or directory")
    .option(
      "-i, --image <path-or-url>",
      "Start frame image path or URL",
      collectImageReference,
      []
    )
    .option(
      "--start-frame <path-or-url>",
      "Start frame image path or URL (same as --image)",
      collectImageReference,
      []
    )
    .option(
      "--end-frame <path-or-url>",
      "End frame image path or URL (requires a start frame)",
      collectImageReference,
      []
    )
    .option("-n, --count <n>", "Number of videos per model (default: 1)")
    .option("--aspect-ratio <W:H>", "Aspect ratio (e.g. 16:9)")
    .option("--resolution <WxH>", "Video resolution (e.g. 1920x1080)")
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
    );
  addTimeoutOption(command, DEFAULT_TIMEOUT_MS).action(
    async (rawPrompt: string | undefined, opts: VideoOptions) => {
      const prompt = rawPrompt?.trim() || undefined;
      const stdin = await readStdin();
      const startInputs = [...(opts.image ?? []), ...(opts.startFrame ?? [])];
      const endInputs = opts.endFrame ?? [];
      const startCount = startInputs.length + (stdin ? 1 : 0);
      if (startCount > 1) {
        throw new Error(
          "video generation accepts one start frame; use one --start-frame, --image, or piped image, and --end-frame for the end frame"
        );
      }
      if (endInputs.length > 1) {
        throw new Error(
          "video generation accepts one end frame; provide one --end-frame value"
        );
      }
      if (endInputs.length > 0 && startCount === 0) {
        throw new Error(
          "--end-frame requires a start frame from --start-frame, --image, or piped stdin"
        );
      }
      if (!prompt && startCount === 0) {
        throw new Error(
          "prompt or image is required (provide a prompt, --start-frame, --image, or pipe an image via stdin)"
        );
      }
      for (const [flag, references] of [
        ["--image", opts.image],
        ["--start-frame", opts.startFrame],
        ["--end-frame", opts.endFrame],
      ] as const) {
        if (references?.some((reference) => !reference.trim())) {
          throw new Error(`${flag} cannot be empty`);
        }
      }

      const [startImages, endImages] = await Promise.all([
        loadImageReferences(startInputs),
        loadImageReferences(endInputs),
      ]);
      const startFrame = stdin ?? startImages[0];
      const endFrame = endImages[0];

      let videoPrompt: string | { image: ImageReference; text?: string } =
        prompt ?? "";
      let frameImages: Parameters<typeof generateVideo>[0]["frameImages"];
      if (endFrame !== undefined) {
        frameImages = [
          { image: startFrame!, frameType: "first_frame" },
          { image: endFrame, frameType: "last_frame" },
        ];
      } else if (startFrame !== undefined) {
        videoPrompt = prompt
          ? { image: startFrame, text: prompt }
          : { image: startFrame };
      }

      const gatewayModels = await fetchGatewayModels();
      const models = resolveModels("video", opts.model, gatewayModels.video);
      const countPerModel = opts.count
        ? parsePositiveInt(opts.count, "count")
        : 1;
      const generationOptions = videoGenerationOptions(opts);

      const jobs = buildJobs(models, countPerModel);

      const { total, failed } = await runJobs(
        jobs,
        async (modelId) => {
          const abort = AbortSignal.timeout(timeoutMs(opts.timeout));
          const result = await generateVideo({
            headers: {
              "http-referer": "https://github.com/vercel-labs/ai-cli",
              "x-title": "ai-cli",
            },
            model: gateway.video(modelId),
            prompt: videoPrompt,
            frameImages,
            abortSignal: abort,
            ...generationOptions,
          });
          return {
            data: Buffer.from(result.video.uint8Array),
            id: responseIdFromHeaders(result.responses[0]?.headers),
          };
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
    }
  );
}

export function videoGenerationOptions(opts: {
  aspectRatio?: string;
  resolution?: string;
  duration?: string;
}) {
  return {
    aspectRatio: opts.aspectRatio
      ? parseAspectRatio(opts.aspectRatio)
      : undefined,
    resolution: opts.resolution
      ? parseSize(opts.resolution, "resolution")
      : undefined,
    duration: opts.duration
      ? parseNonNegativeFloat(opts.duration, "duration")
      : undefined,
  };
}

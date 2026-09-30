import { mkdir, writeFile, rename, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  createDownload,
  experimental_generateVideo as generateVideo,
  experimental_startVideo as startVideo,
  experimental_getVideoStatus as getVideoStatus,
  type JSONValue,
} from "ai";

import type { Command } from "../lib/command.js";
import {
  collectImageReference,
  loadImageReferences,
} from "../lib/image-references.js";
import { artifact, runMediaJobs } from "../lib/media-jobs.js";
import {
  addGatewayOptions,
  addMediaOptions,
  mediaSettings,
  readJsonObject,
  validateUrl,
  type MediaOptions,
} from "../lib/media-options.js";
import { fetchGatewayModels, resolveModels } from "../lib/models.js";
import {
  parsePositiveInt,
  parseAspectRatio,
  parseNonNegativeFloat,
  parseSize,
} from "../lib/parse.js";
import { responseIdFromHeaders } from "../lib/response-id.js";
import { readStdin } from "../lib/stdin.js";
import { addTimeoutOption, timeoutMs, parseTimerMs } from "../lib/timeout.js";
import { readFrameImages, readInputReferences } from "../lib/video-inputs.js";

const DEFAULT_CONCURRENCY = 2;
const DEFAULT_TIMEOUT_MS = 600_000;

interface VideoOptions extends MediaOptions {
  image?: string[];
  frameImages?: string;
  inputReferences?: string;
  maxVideosPerCall?: string;
  aspectRatio?: string;
  resolution?: string;
  duration?: string;
  fps?: string;
  generateAudio?: boolean;
  pollIntervalMs?: string;
  pollTimeoutMs?: string;
  downloadMaxBytes?: string;
  webhookUrl?: string;
}

function generationCommand(command: Command, start = false) {
  return addTimeoutOption(
    addMediaOptions(
      command.argument("[prompt]", "Video prompt"),
      DEFAULT_CONCURRENCY,
      start
    )
      .option(
        "-i, --image <path-or-url>",
        "SDK prompt.image (or pipe image bytes)",
        collectImageReference,
        []
      )
      .option(
        "--frame-images <path>",
        "JSON SDK frameImages array with first_frame / last_frame roles"
      )
      .option(
        "--input-references <path>",
        "JSON SDK inputReferences array; specify mediaType for video URLs"
      )
      .option(
        "--max-videos-per-call <n>",
        "SDK maxVideosPerCall batching limit"
      )
      .option("--aspect-ratio <W:H|adaptive>", "SDK aspectRatio")
      .option("--resolution <WxH>", "SDK resolution (e.g. 1920x1080)")
      .option("--duration <seconds>", "SDK duration in seconds")
      .option("--fps <n>", "SDK frames per second")
      .option("--generate-audio", "Request generated audio")
      .option("--no-generate-audio", "Disable generated audio"),
    DEFAULT_TIMEOUT_MS
  );
}

async function generationInputs(
  rawPrompt: string | undefined,
  opts: VideoOptions
) {
  const settings = await mediaSettings(opts, DEFAULT_CONCURRENCY);
  const generationOptions = videoGenerationOptions(opts);
  const maxVideosPerCall =
    opts.maxVideosPerCall === undefined
      ? undefined
      : parsePositiveInt(opts.maxVideosPerCall, "max-videos-per-call");
  const frameImages = opts.frameImages
    ? await readFrameImages(opts.frameImages)
    : undefined;
  const inputReferences = opts.inputReferences
    ? await readInputReferences(opts.inputReferences)
    : undefined;
  const prompt = rawPrompt?.trim() || undefined;
  const stdin = await readStdin();
  if ((opts.image?.length ?? 0) + (stdin ? 1 : 0) > 1)
    throw new Error(
      "Use one --image or piped image; use --frame-images for frame roles and --input-references for multiple references"
    );
  const image = stdin ?? (await loadImageReferences(opts.image ?? []))[0];
  if (!prompt && !image && !frameImages?.length && !inputReferences?.length)
    throw new Error(
      "prompt, --image, --frame-images, or --input-references is required"
    );
  return {
    settings,
    request: {
      ...generationOptions,
      n: settings.n,
      seed: settings.seed,
      maxRetries: settings.maxRetries,
      headers: settings.headers,
      providerOptions: settings.providerOptions,
      maxVideosPerCall,
      prompt: image ? { image, text: prompt } : (prompt ?? ""),
      frameImages,
      inputReferences,
    },
  };
}

export function registerVideoCommand(program: Command) {
  const command = generationCommand(
    program
      .command("video")
      .description(
        "Generate video with AI SDK polling, or start/check an asynchronous operation"
      )
  )
    .option("--poll-interval-ms <ms>", "SDK poll.intervalMs (default: 5000)")
    .option(
      "--poll-timeout-ms <ms>",
      "SDK poll.timeoutMs (default: --timeout in milliseconds)"
    )
    .option(
      "--download-max-bytes <bytes>",
      "SDK createDownload maxBytes (default: 2 GiB)"
    );
  command.action(async (prompt: string | undefined, opts: VideoOptions) => {
    const poll = {
      intervalMs:
        opts.pollIntervalMs === undefined
          ? undefined
          : parseTimerMs(opts.pollIntervalMs, "poll-interval-ms"),
      timeoutMs:
        opts.pollTimeoutMs === undefined
          ? timeoutMs(opts.timeout)
          : parseTimerMs(opts.pollTimeoutMs, "poll-timeout-ms"),
    };
    const download = createDownload({
      maxBytes:
        opts.downloadMaxBytes === undefined
          ? undefined
          : parsePositiveInt(opts.downloadMaxBytes, "download-max-bytes"),
    });
    const { settings, request } = await generationInputs(prompt, opts);
    const catalog = await fetchGatewayModels(settings.catalogOptions);
    const models = resolveModels("video", opts.model, catalog.video);
    await runMediaJobs(
      models,
      async (modelId) => {
        const result = await generateVideo({
          ...request,
          model: settings.gateway.video(modelId),
          poll,
          download,
          abortSignal: AbortSignal.timeout(timeoutMs(opts.timeout)),
        });
        return {
          artifacts: result.videos.map((file) =>
            artifact(file, responseIdFromHeaders(result.responses[0]?.headers))
          ),
          warnings: result.warnings,
          responses: result.responses,
          providerMetadata: result.providerMetadata,
        };
      },
      {
        ...opts,
        n: settings.n,
        concurrency: settings.concurrency,
        format: "video",
      }
    );
  });

  generationCommand(
    command
      .command("start")
      .description(
        "Start one asynchronous video operation and emit/persist its JSON reference"
      ),
    true
  )
    .option(
      "--webhook-url <url>",
      "SDK webhookUrl for completion notifications"
    )
    .action(async (prompt: string | undefined, opts: VideoOptions) => {
      const webhookUrl =
        opts.webhookUrl === undefined
          ? undefined
          : validateUrl(opts.webhookUrl, "webhook-url");
      const destination = opts.output ? resolve(opts.output) : undefined;
      if (destination) {
        await mkdir(dirname(destination), { recursive: true });
        const existing = await stat(destination).catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return undefined;
            throw error;
          }
        );
        if (existing?.isDirectory())
          throw new Error(
            "video start --output must be a JSON file, not a directory"
          );
      }
      const { settings, request } = await generationInputs(prompt, opts);
      const catalog = await fetchGatewayModels(settings.catalogOptions);
      const models = resolveModels("video", opts.model, catalog.video);
      if (models.length !== 1)
        throw new Error("video start accepts one model per operation");
      const model = models[0]!;
      const result = await startVideo({
        ...request,
        model: settings.gateway.video(model),
        webhookUrl,
        abortSignal: AbortSignal.timeout(timeoutMs(opts.timeout)),
      });
      const data = JSON.stringify({ model, ...result }, null, 2) + "\n";
      // Emit first so a filesystem failure cannot lose an already-started job.
      process.stdout.write(data);
      if (destination) {
        const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
        try {
          await writeFile(temporary, data, { mode: 0o600, flag: "wx" });
          await rename(temporary, destination);
        } catch (error) {
          // Preserve one valid operation JSON on stdout even if persistence fails.
          process.stderr.write(
            `Error: could not save operation to ${destination}: ${error instanceof Error ? error.message : String(error)}\n`
          );
          process.exitCode = 1;
        } finally {
          await rm(temporary, { force: true }).catch(() => {});
        }
      }
    });

  const statusCommand = addGatewayOptions(
    command
      .command("status")
      .description(
        "Check a saved SDK operation; returns JSON without downloading by default"
      )
      .argument("<operation-file>", "JSON emitted by video start")
      .option("--download", "Download completed videos")
      .option(
        "--download-max-bytes <bytes>",
        "SDK createDownload maxBytes (default: 2 GiB)"
      )
      .option("-o, --output <path>", "Downloaded video file or directory")
      .option(
        "--json",
        "JSON status / downloaded artifact manifest (always enabled)"
      )
      .option("-q, --quiet", "Suppress progress")
      .option("--no-preview", "Disable previews")
  );
  addTimeoutOption(statusCommand, DEFAULT_TIMEOUT_MS).action(
    async (
      path: string | undefined,
      opts: MediaOptions & { download?: boolean; downloadMaxBytes?: string }
    ) => {
      if (!path) throw new Error("video status requires an operation file");
      if (opts.output && !opts.download)
        throw new Error("video status --output requires --download");
      const settings = await mediaSettings(opts);
      const download = createDownload({
        maxBytes:
          opts.downloadMaxBytes === undefined
            ? undefined
            : parsePositiveInt(opts.downloadMaxBytes, "download-max-bytes"),
      });
      const saved = await readJsonObject(path, "operation");
      if (
        typeof saved.model !== "string" ||
        !saved.model.trim() ||
        !("operation" in saved)
      )
        throw new Error(
          "Operation file must contain model and operation from video start"
        );
      const model = resolveModels("video", saved.model);
      if (model.length !== 1)
        throw new Error("Operation file must contain one model");
      const abortSignal = AbortSignal.timeout(timeoutMs(opts.timeout));
      const result = await getVideoStatus(settings.gateway.video(model[0]!), {
        operation: saved.operation as JSONValue,
        headers: settings.headers,
        maxRetries: settings.maxRetries,
        abortSignal,
      });
      if (!opts.download || result.status !== "completed") {
        process.stdout.write(
          JSON.stringify({ model: model[0], ...result }, null, 2) + "\n"
        );
        if (result.status === "error") {
          process.stderr.write(`Error: ${result.error}\n`);
          process.exitCode = 1;
        }
        return;
      }
      await runMediaJobs(
        model,
        async () => ({
          status: result.status,
          response: result.response,
          warnings: result.warnings,
          providerMetadata: result.providerMetadata,
          artifacts: await Promise.all(
            result.videos.map(async (video) => {
              if (video.type === "url") {
                const file = await download({
                  url: new URL(video.url),
                  abortSignal,
                });
                return {
                  data: Buffer.from(file.data),
                  mediaType:
                    (video.mediaType &&
                    video.mediaType !== "application/octet-stream"
                      ? video.mediaType
                      : undefined) ||
                    file.mediaType ||
                    "video/mp4",
                };
              }
              return {
                data:
                  video.type === "base64"
                    ? Buffer.from(video.data, "base64")
                    : Buffer.from(video.data),
                mediaType: video.mediaType || "video/mp4",
              };
            })
          ),
        }),
        {
          ...opts,
          n: result.videos.length,
          concurrency: 1,
          json: true,
          format: "video",
        }
      );
    }
  );
}

export function videoGenerationOptions(
  opts: Pick<
    VideoOptions,
    "aspectRatio" | "resolution" | "duration" | "fps" | "generateAudio"
  >
) {
  const duration =
    opts.duration === undefined
      ? undefined
      : parseNonNegativeFloat(opts.duration, "duration");
  if (duration === 0) throw new Error("--duration must be greater than zero");
  const fps =
    opts.fps === undefined ? undefined : parseNonNegativeFloat(opts.fps, "fps");
  if (fps === 0) throw new Error("--fps must be greater than zero");
  return {
    aspectRatio:
      opts.aspectRatio === "adaptive"
        ? ("adaptive" as const)
        : opts.aspectRatio === undefined
          ? undefined
          : parseAspectRatio(opts.aspectRatio),
    resolution:
      opts.resolution === undefined
        ? undefined
        : parseSize(opts.resolution, "resolution"),
    duration,
    fps,
    generateAudio: opts.generateAudio,
  };
}

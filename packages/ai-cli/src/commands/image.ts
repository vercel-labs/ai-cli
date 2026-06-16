import { generateImage, generateText, gateway } from "ai";
import type { Command } from "commander";

import {
  collectImageReference,
  loadImageReferences,
  type ImageReference,
} from "../lib/image-references.js";
import { buildJobs, runJobs } from "../lib/jobs.js";
import { fetchGatewayModels, resolveModels } from "../lib/models.js";
import { parsePositiveInt, parseSize, parseAspectRatio } from "../lib/parse.js";
import { responseIdFromHeaders } from "../lib/response-id.js";
import { readStdin } from "../lib/stdin.js";

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_TIMEOUT_MS = 300_000;

interface ImageOptions {
  model?: string;
  output?: string;
  image?: string[];
  count?: string;
  size?: string;
  aspectRatio?: string;
  quality?: string;
  style?: string;
  quiet?: boolean;
  json?: boolean;
  concurrency?: string;
  preview?: boolean;
}

export function registerImageCommand(program: Command) {
  program
    .command("image")
    .description("Generate an image from a prompt")
    .argument("[prompt]", "The prompt to generate an image from")
    .option(
      "-m, --model <model>",
      "Model ID (creator/model-name), comma-separated for multi-model"
    )
    .option("-o, --output <path>", "Output file path or directory")
    .option(
      "-i, --image <path-or-url>",
      "Reference image path or URL (repeatable)",
      collectImageReference,
      []
    )
    .option("-n, --count <n>", "Number of images per model (default: 1)")
    .option("--size <WxH>", "Image size (e.g. 1024x1024)")
    .option("--aspect-ratio <W:H>", "Aspect ratio (e.g. 16:9)")
    .option("--quality <level>", "Quality (standard, hd)")
    .option("--style <style>", "Style (e.g. vivid, natural)")
    .option("-q, --quiet", "Suppress progress output")
    .option("--json", "Output metadata as JSON")
    .option(
      "--no-preview",
      "Disable inline image preview in supported terminals"
    )
    .option(
      "-p, --concurrency <n>",
      `Max parallel generations (default: ${DEFAULT_CONCURRENCY})`
    )
    .action(async (rawPrompt: string | undefined, opts: ImageOptions) => {
      const prompt = rawPrompt?.trim() || undefined;
      const stdin = await readStdin();
      const imageReferenceInputs = opts.image ?? [];
      if (!prompt && !stdin && imageReferenceInputs.length === 0) {
        process.stderr.write(
          "Error: prompt or reference image is required (provide a prompt, --image, or pipe an image via stdin)\n"
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

      const images: ImageReference[] = [
        ...(stdin ? [new Uint8Array(stdin)] : []),
        ...referenceImages,
      ];

      let imagePrompt: string | { images: ImageReference[]; text?: string };
      if (images.length > 0) {
        imagePrompt = prompt ? { images, text: prompt } : { images };
      } else {
        imagePrompt = prompt!;
      }

      const gatewayModels = await fetchGatewayModels();
      const models = resolveModels("image", opts.model, gatewayModels.image);
      const countPerModel = opts.count
        ? parsePositiveInt(opts.count, "count")
        : 1;
      const size = opts.size ? parseSize(opts.size) : undefined;
      const aspectRatio = opts.aspectRatio
        ? parseAspectRatio(opts.aspectRatio)
        : undefined;
      const provOpts = buildProviderOptions(opts);

      if (
        (opts.quality || opts.style) &&
        models.every((m) => !m.startsWith("openai/"))
      ) {
        process.stderr.write(
          "Warning: --quality and --style only apply to OpenAI models\n"
        );
      }

      const jobs = buildJobs(models, countPerModel);

      const { total, failed } = await runJobs(
        jobs,
        async (modelId) => {
          const abort = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);

          if (gatewayModels.languageImageModelIds.has(modelId)) {
            const messageContent: Array<
              | { type: "text"; text: string }
              | { type: "image"; image: ImageReference }
            > = [];
            if (typeof imagePrompt === "string") {
              messageContent.push({ type: "text", text: imagePrompt });
            } else {
              for (const img of imagePrompt.images) {
                messageContent.push({ type: "image", image: img });
              }
              if (imagePrompt.text) {
                messageContent.push({
                  type: "text",
                  text: imagePrompt.text,
                });
              } else {
                messageContent.push({
                  type: "text",
                  text: "Generate an image",
                });
              }
            }
            const creator = gatewayModels.all.find(
              (m) => m.id === modelId
            )?.creator;
            const result = await generateText({
              headers: {
                "http-referer": "https://github.com/vercel-labs/ai-cli",
                "x-title": "ai-cli",
              },
              model: gateway(modelId),
              messages: [{ role: "user", content: messageContent }],
              abortSignal: abort,
              providerOptions:
                creator === "google"
                  ? { google: { responseModalities: ["IMAGE", "TEXT"] } }
                  : undefined,
            });
            const imageFile = result.files?.find((f) =>
              f.mediaType.startsWith("image/")
            );
            if (!imageFile) {
              throw new Error(
                `Model ${modelId} did not return an image in the response`
              );
            }
            return {
              data: Buffer.from(imageFile.uint8Array),
              id: result.response.id,
            };
          }

          const result = await generateImage({
            headers: {
              "http-referer": "https://github.com/vercel-labs/ai-cli",
              "x-title": "ai-cli",
            },
            model: gateway.image(modelId),
            prompt: imagePrompt,
            abortSignal: abort,
            n: 1,
            size,
            aspectRatio,
            providerOptions:
              Object.keys(provOpts).length > 0 ? provOpts : undefined,
          });
          return {
            data: Buffer.from(result.image.uint8Array),
            id: responseIdFromHeaders(result.responses[0]?.headers),
          };
        },
        {
          noun: "image",
          format: "image",
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

function buildProviderOptions(
  opts: ImageOptions
): Record<string, Record<string, string>> {
  const providerOptions: Record<string, Record<string, string>> = {};
  if (opts.quality || opts.style) {
    providerOptions.openai = {};
    if (opts.quality) providerOptions.openai.quality = opts.quality;
    if (opts.style) providerOptions.openai.style = opts.style;
  }
  return providerOptions;
}

import { generateImage, generateText, type JSONValue } from "ai";

import type { Command } from "../lib/command.js";
import {
  collectImageReference,
  loadImageReferences,
  type ImageReference,
} from "../lib/image-references.js";
import { readGenerateTextOptions, toolImages } from "../lib/language-images.js";
import { artifact, runMediaJobs } from "../lib/media-jobs.js";
import {
  addMediaOptions,
  mediaSettings,
  mergeOptions,
  type MediaOptions,
} from "../lib/media-options.js";
import { fetchGatewayModels, resolveModels } from "../lib/models.js";
import { parsePositiveInt, parseSize, parseAspectRatio } from "../lib/parse.js";
import { responseIdFromHeaders } from "../lib/response-id.js";
import { readStdin } from "../lib/stdin.js";
import { addTimeoutOption, timeoutMs } from "../lib/timeout.js";

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_TIMEOUT_MS = 300_000;
const SVG_IMAGE_MODEL_IDS = new Set([
  "quiverai/arrow-1.1",
  "quiverai/arrow-2",
  "quiverai/arrow-2-telos",
]);
const SVG_LANGUAGE_IMAGE_MODEL_IDS = new Set([
  "quiverai/arrow-2",
  "quiverai/arrow-2-telos",
]);

interface ImageOptions extends MediaOptions {
  images?: string[];
  mask?: string;
  size?: string;
  aspectRatio?: string;
  maxImagesPerCall?: string;
  api?: string;
  generateTextOptions?: string;
}

export function registerImageCommand(program: Command) {
  const command = addMediaOptions(
    program
      .command("image")
      .description(
        "Generate or edit images using AI SDK generateImage or generateText"
      )
      .argument("[prompt]", "Image prompt"),
    DEFAULT_CONCURRENCY
  )
    .option(
      "-i, --images <path-or-url>",
      "SDK prompt.images reference (repeatable)",
      collectImageReference,
      []
    )
    .option(
      "--mask <path-or-url>",
      "SDK prompt.mask for editing reference images"
    )
    .option("--size <WxH>", "SDK image size, e.g. 1024x1024")
    .option("--aspect-ratio <W:H>", "SDK aspectRatio, e.g. 16:9")
    .option("--max-images-per-call <n>", "SDK maxImagesPerCall batching limit")
    .option(
      "--api <api>",
      "generateImage or generateText (default: model catalog)"
    )
    .option(
      "--generate-text-options <path>",
      "JSON generateText settings and provider tools; selects generateText"
    );
  addTimeoutOption(command, DEFAULT_TIMEOUT_MS).action(
    async (rawPrompt: string | undefined, opts: ImageOptions) => {
      const settings = await mediaSettings(opts, DEFAULT_CONCURRENCY);
      const size = opts.size === undefined ? undefined : parseSize(opts.size);
      const aspectRatio =
        opts.aspectRatio === undefined
          ? undefined
          : parseAspectRatio(opts.aspectRatio);
      const maxImagesPerCall =
        opts.maxImagesPerCall === undefined
          ? undefined
          : parsePositiveInt(opts.maxImagesPerCall, "max-images-per-call");
      if (
        opts.api !== undefined &&
        !["generateImage", "generateText"].includes(opts.api)
      )
        throw new Error("--api must be generateImage or generateText");
      if (opts.generateTextOptions && opts.api === "generateImage")
        throw new Error("--generate-text-options requires --api generateText");
      const textOptions = opts.generateTextOptions
        ? await readGenerateTextOptions(opts.generateTextOptions)
        : {};
      const prompt = rawPrompt?.trim() || undefined;
      const stdin = await readStdin();
      const images: ImageReference[] = [
        ...(stdin ? [new Uint8Array(stdin)] : []),
        ...(await loadImageReferences(opts.images ?? [], "images")),
      ];
      const mask =
        opts.mask === undefined
          ? undefined
          : (await loadImageReferences([opts.mask], "mask"))[0];
      if (mask !== undefined && images.length === 0)
        throw new Error("--mask requires --images or piped image input");
      if (!prompt && images.length === 0)
        throw new Error(
          "prompt or reference image is required (use --images or pipe an image via stdin)"
        );
      const imagePrompt =
        images.length > 0 ? { images, text: prompt, mask } : prompt!;
      const catalog = await fetchGatewayModels(settings.catalogOptions);
      const models = resolveModels("image", opts.model, catalog.image);
      const explicitApi =
        opts.api ?? (opts.generateTextOptions ? "generateText" : undefined);
      if (!explicitApi && !catalog.available)
        throw new Error(
          "Cannot determine the image API because model discovery failed. Retry or select --api generateImage / --api generateText explicitly."
        );
      const languageIds = new Set([
        ...catalog.languageImageModelIds,
        ...SVG_LANGUAGE_IMAGE_MODEL_IDS,
      ]);
      const usesText = (model: string) =>
        explicitApi === "generateText" ||
        (!explicitApi && languageIds.has(model));
      if (models.some(usesText)) {
        if (size || mask || maxImagesPerCall !== undefined || settings.n !== 1)
          throw new Error(
            "generateText does not support --size, --mask, --max-images-per-call or --n other than 1; use --provider-options for model-specific image settings"
          );
        if (
          aspectRatio &&
          models.some(
            (model) => usesText(model) && !model.startsWith("google/")
          )
        )
          throw new Error(
            "--aspect-ratio on generateText is supported for Google imageConfig only; use --provider-options for this model"
          );
      }
      await runMediaJobs(
        models,
        async (modelId) => {
          const common = {
            headers: settings.headers,
            seed: settings.seed,
            maxRetries: settings.maxRetries,
            abortSignal: AbortSignal.timeout(timeoutMs(opts.timeout)),
          };
          if (usesText(modelId)) {
            const result = await generateText({
              ...textOptions,
              ...common,
              model: settings.gateway(modelId),
              messages: [
                {
                  role: "user",
                  content: [
                    ...images.map((image) => ({
                      type: "image" as const,
                      image,
                    })),
                    { type: "text", text: prompt ?? "Generate an image" },
                  ],
                },
              ],
              providerOptions: mergeOptions(
                languageImageProviderOptions(
                  modelId.split("/")[0],
                  aspectRatio
                ) ?? {},
                settings.providerOptions
              ) as typeof settings.providerOptions,
            });
            const artifacts = result.files
              .filter((file) => file.mediaType.startsWith("image/"))
              .map((file) => artifact(file, result.response.id));
            artifacts.push(
              ...toolImages(
                result.toolResults,
                textOptions.tools,
                result.response.id
              )
            );
            if (artifacts.length === 0 && SVG_IMAGE_MODEL_IDS.has(modelId)) {
              const svg = extractSvgImage(result.text);
              if (svg)
                artifacts.push({
                  data: svg,
                  mediaType: "image/svg+xml",
                  id: result.response.id,
                });
            }
            const {
              messages: _messages,
              body: _body,
              ...response
            } = result.response;
            return {
              artifacts,
              text: result.text,
              usage: result.usage,
              totalUsage: result.totalUsage,
              warnings: result.warnings,
              providerMetadata: result.providerMetadata,
              response,
              finishReason: result.finishReason,
              // Tool image bytes live in artifacts, not in the diagnostic manifest.
              toolResults: result.toolResults.map((item) => ({
                ...item,
                output:
                  textOptions.tools?.[item.toolName]?.id ===
                    "openai.image_generation" &&
                  typeof item.output === "object" &&
                  item.output !== null &&
                  "result" in item.output
                    ? { ...item.output, result: "[saved as image]" }
                    : item.output,
              })),
            };
          }
          const result = await generateImage({
            ...common,
            model: settings.gateway.image(modelId),
            prompt: imagePrompt,
            n: settings.n,
            maxImagesPerCall,
            size,
            aspectRatio,
            providerOptions: settings.providerOptions,
          });
          const calls = result.calls.map((call) => ({
            images: call.images.map((file) => ({
              ...artifact(file, responseIdFromHeaders(call.response.headers)),
              mediaType: generatedImageMediaType(modelId, file.mediaType),
            })),
            response: call.response,
            providerMetadata: call.providerMetadata,
            warnings: call.warnings,
            usage: call.usage,
          }));
          return {
            artifacts: calls.flatMap((call) => call.images),
            usage: result.usage,
            warnings: result.warnings,
            calls,
          };
        },
        {
          ...opts,
          n: settings.n,
          concurrency: settings.concurrency,
          format: "image",
        }
      );
    }
  );
}

export function extractSvgImage(text: string): string | undefined {
  const svgStart = /<svg(?=[\s/>])/gi;
  let bestMatch: string | undefined;
  for (let match = svgStart.exec(text); match; match = svgStart.exec(text)) {
    const svg = extractSvgImageAt(text, match.index);
    if (!svg) continue;

    if (!bestMatch || svg.length > bestMatch.length) bestMatch = svg;
    // Nested SVG elements are already included in this candidate.
    svgStart.lastIndex = match.index + svg.length;
  }

  return bestMatch;
}

function extractSvgImageAt(text: string, start: number): string | undefined {
  let depth = 0;
  let cursor = start;
  while (cursor < text.length) {
    const tagStart = text.indexOf("<", cursor);
    if (tagStart === -1) return undefined;

    if (text.startsWith("<!--", tagStart)) {
      const commentEnd = text.indexOf("-->", tagStart + 4);
      if (commentEnd === -1) return undefined;
      cursor = commentEnd + 3;
      continue;
    }

    if (text.startsWith("<![CDATA[", tagStart)) {
      const cdataEnd = text.indexOf("]]>", tagStart + 9);
      if (cdataEnd === -1) return undefined;
      cursor = cdataEnd + 3;
      continue;
    }

    const tagEnd = findMarkupEnd(text, tagStart + 1);
    if (tagEnd === -1) return undefined;

    const tag = text.slice(tagStart, tagEnd + 1);
    if (/^<svg(?=[\s/>])/i.test(tag)) {
      if (/\/\s*>$/.test(tag)) {
        if (depth === 0) return text.slice(start, tagEnd + 1);
      } else {
        depth++;
      }
    } else if (/^<\/svg\s*>$/i.test(tag)) {
      depth--;
      if (depth === 0) return text.slice(start, tagEnd + 1);
      if (depth < 0) return undefined;
    }

    cursor = tagEnd + 1;
  }

  return undefined;
}

function findMarkupEnd(text: string, start: number): number {
  let quote: '"' | "'" | undefined;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (char === quote) quote = undefined;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ">") {
      return i;
    }
  }

  return -1;
}

export function generatedImageMediaType(
  modelId: string,
  reportedMediaType: string
): string {
  return SVG_IMAGE_MODEL_IDS.has(modelId) ? "image/svg+xml" : reportedMediaType;
}

export function languageImageProviderOptions(
  creator: string | undefined,
  aspectRatio?: `${number}:${number}`
): { google: Record<string, JSONValue> } | undefined {
  if (creator !== "google") return undefined;
  return {
    google: {
      responseModalities: ["IMAGE", "TEXT"],
      // Gemini image models don't support `size`; aspect ratio goes through
      // imageConfig and defaults to 1:1 when unset.
      ...(aspectRatio ? { imageConfig: { aspectRatio } } : {}),
    },
  };
}

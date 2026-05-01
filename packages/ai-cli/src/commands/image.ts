import { generateImage, gateway } from "ai";
import type { Command } from "commander";

import { buildJobs, runJobs } from "../lib/jobs.js";
import { resolveModels } from "../lib/models.js";
import { parsePositiveInt, parseSize, parseAspectRatio } from "../lib/parse.js";
import { readStdin } from "../lib/stdin.js";

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_TIMEOUT_MS = 120_000;

interface ImageOptions {
  model?: string;
  output?: string;
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
      if (!prompt && !stdin) {
        process.stderr.write(
          "Error: prompt is required (provide as argument or pipe via stdin)\n"
        );
        process.exit(1);
      }
      let imagePrompt: string | { images: Uint8Array[]; text?: string } =
        prompt!;
      if (stdin) {
        imagePrompt = prompt
          ? { images: [new Uint8Array(stdin)], text: prompt }
          : { images: [new Uint8Array(stdin)] };
      }

      const models = resolveModels("image", opts.model);
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
          const result = await generateImage({
            model: gateway.image(modelId),
            prompt: imagePrompt,
            abortSignal: abort,
            n: 1,
            size,
            aspectRatio,
            providerOptions:
              Object.keys(provOpts).length > 0 ? provOpts : undefined,
          });
          return Buffer.from(result.image.uint8Array);
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

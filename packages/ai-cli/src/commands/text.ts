import { generateText, gateway } from "ai";
import type { Command } from "commander";

import { buildJobs, runJobs } from "../lib/jobs.js";
import { resolveModels } from "../lib/models.js";
import type { OutputFormat } from "../lib/output.js";
import { parsePositiveInt, parseTemperature } from "../lib/parse.js";
import { readStdin, stdinAsText } from "../lib/stdin.js";

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_TIMEOUT_MS = 120_000;

interface TextOptions {
  model?: string;
  output?: string;
  format?: string;
  system?: string;
  maxTokens?: string;
  temperature?: string;
  count?: string;
  concurrency?: string;
  quiet?: boolean;
  json?: boolean;
}

function resolveFormat(fmt?: string): OutputFormat {
  if (!fmt || fmt === "md") return "md";
  if (fmt === "txt") return "txt";
  throw new Error(`--format must be one of: md, txt (got "${fmt}")`);
}

export function registerTextCommand(program: Command) {
  program
    .command("text")
    .description("Generate text from a prompt")
    .argument("[prompt]", "The prompt to generate text from")
    .option(
      "-m, --model <model>",
      "Model ID (creator/model-name), comma-separated for multi-model"
    )
    .option("-o, --output <path>", "Output file path or directory")
    .option("-f, --format <fmt>", "Output format: md, txt (default: md)")
    .option("-n, --count <n>", "Number of generations (default: 1)")
    .option(
      "-p, --concurrency <n>",
      `Max parallel generations (default: ${DEFAULT_CONCURRENCY})`
    )
    .option("-s, --system <prompt>", "System prompt")
    .option("--max-tokens <n>", "Maximum tokens to generate")
    .option("-t, --temperature <n>", "Temperature (0-2)")
    .option("-q, --quiet", "Suppress progress output")
    .option("--json", "Output metadata as JSON")
    .action(async (rawPrompt: string | undefined, opts: TextOptions) => {
      const prompt = rawPrompt?.trim() || undefined;
      const stdin = await readStdin();
      if (!prompt && !stdin) {
        process.stderr.write(
          "Error: prompt is required (provide as argument or pipe via stdin)\n"
        );
        process.exit(1);
      }
      let fullPrompt: string;
      if (stdin && prompt) {
        fullPrompt = `${stdinAsText(stdin)}\n\n---\n\n${prompt}`;
      } else if (stdin) {
        fullPrompt = stdinAsText(stdin);
      } else {
        fullPrompt = prompt!;
      }

      const format = resolveFormat(opts.format);
      const models = resolveModels("text", opts.model);
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

      const { total, failed } = await runJobs(
        jobs,
        async (modelId) => {
          const abort = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
          const result = await generateText({
            model: gateway(modelId),
            prompt: fullPrompt,
            system: opts.system,
            maxOutputTokens: maxTokens,
            temperature,
            abortSignal: abort,
          });
          return result.text;
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
    });
}

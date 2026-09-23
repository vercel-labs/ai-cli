import { readFile } from "node:fs/promises";

import { gateway } from "@ai-sdk/gateway";

import type { Command } from "../lib/command.js";
import {
  buildQuestions,
  decodeEvaluationText,
  evaluateState,
  parseInputFormat,
  parseMaxRetries,
  parseProviderOptions,
  parseQuestions,
  parseState,
  type InputFormat,
  type QuestionOptions,
} from "../lib/evaluation.js";
import {
  addCacheOptions,
  cacheKey,
  getCacheEntry,
  resolveCacheTtl,
  setCacheEntry,
  shouldUseCache,
} from "../lib/cache.js";
import { fetchGatewayModels, resolveModels } from "../lib/models.js";
import { readStdin } from "../lib/stdin.js";
import { addTimeoutOption, timeoutMs } from "../lib/timeout.js";

interface EvaluateOptions extends QuestionOptions {
  questions?: string;
  model?: string;
  input: InputFormat;
  providerOptions?: string;
  maxRetries: number;
  cache?: boolean;
  cacheTtl?: string;
  timeout: number;
}

async function readTextFile(path: string, flag: string): Promise<string> {
  try {
    return decodeEvaluationText(await readFile(path));
  } catch (error) {
    throw new Error(
      `Could not read --${flag} file ${JSON.stringify(path)}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function resolveEvaluationModel(userModel?: string): Promise<string> {
  const models = resolveModels("evaluation", userModel);
  if (models.length !== 1 || models[0].includes(","))
    throw new Error("ai evaluate requires exactly one evaluation model");
  const model = models[0];
  if (model === "jev") return "typesafe-ai/jev";
  if (model.includes("/")) return model;
  const known = (await fetchGatewayModels()).evaluation;
  const resolved = resolveModels("evaluation", model, known)[0];
  if (!resolved.includes("/"))
    throw new Error(
      `Unknown evaluation model: ${model}. Run ai models --type evaluation.`
    );
  return resolved;
}

const append = (value: string, previous: string[] = []) => [...previous, value];

export function registerEvaluateCommand(program: Command) {
  const command = program
    .command("evaluate")
    .description(
      "Evaluate named, typed questions against stdin; output answers and metadata as JSON"
    )
    .option(
      "--boolean <id=question>",
      "Ask for P(true); repeat for multiple questions",
      append
    )
    .option(
      "--choice <id=question>",
      "Ask for one of the supplied choices; repeatable",
      append
    )
    .option(
      "--choices <id=a,b,...>",
      "Comma-separated choices for the named question",
      append
    )
    .option(
      "--score <id=question>",
      "Ask for a score on ordered levels; repeatable",
      append
    )
    .option(
      "--levels <id=low,...,high>",
      "Comma-separated score levels, lowest to highest",
      append
    )
    .option(
      "--questions <path>",
      "JSON file of named questions with typed criteria"
    )
    .option(
      "-m, --model <model>",
      "Evaluation model ID or short name (default: typesafe-ai/jev)"
    )
    .option(
      "--input <format>",
      "State format: auto, text, or json (arrays stay intact)",
      parseInputFormat,
      "auto" as InputFormat
    )
    .option(
      "--provider-options <path>",
      "JSON file of provider-specific options"
    )
    .option(
      "--max-retries <n>",
      "Retries for transient provider failures",
      parseMaxRetries,
      2
    );
  addCacheOptions(command);

  addTimeoutOption(command, 30_000).action(
    async (_: undefined, options: EvaluateOptions) => {
      const questions = buildQuestions(
        options,
        options.questions
          ? parseQuestions(await readTextFile(options.questions, "questions"))
          : undefined
      );
      const providerOptions = options.providerOptions
        ? parseProviderOptions(
            await readTextFile(options.providerOptions, "provider-options")
          )
        : undefined;
      if (process.stdin.isTTY)
        throw new Error("Pipe text or a JSON state to stdin.");
      const state = parseState(
        decodeEvaluationText((await readStdin()) ?? new Uint8Array()),
        options.input
      );
      const model = await resolveEvaluationModel(options.model);
      const useCache = shouldUseCache(options);
      const cacheTtl = resolveCacheTtl(options as { cacheTtl?: string });
      if (useCache) {
        const key = cacheKey({
          command: "evaluate",
          model,
          prompt: state,
          extra: { questions, providerOptions, input: options.input },
        });
        const cached = getCacheEntry(key, cacheTtl);
        if (cached) {
          process.stderr.write(`Cache hit for ${model}\n`);
          process.stdout.write((cached.data as string) + "\n");
          return;
        }
        const result = await evaluateState(state, questions, {
          model: gateway.evaluationModel(model),
          timeoutMs: timeoutMs(options.timeout),
          maxRetries: options.maxRetries,
          providerOptions,
        });
        const serialized = JSON.stringify(result, null, 2);
        setCacheEntry(key, { data: serialized }, cacheTtl);
        process.stdout.write(serialized + "\n");
        return;
      }
      const result = await evaluateState(state, questions, {
        model: gateway.evaluationModel(model),
        timeoutMs: timeoutMs(options.timeout),
        maxRetries: options.maxRetries,
        providerOptions,
      });
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    }
  );
}

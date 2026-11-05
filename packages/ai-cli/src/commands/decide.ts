import { readFile } from "node:fs/promises";

import type { Command } from "../lib/command.js";
import {
  buildQuestions,
  decisionState,
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
  collectImageReference,
  loadImageReferences,
} from "../lib/image-references.js";
import {
  addGatewayConnectionOptions,
  mediaSettings,
} from "../lib/media-options.js";
import { fetchGatewayModels, resolveModels } from "../lib/models.js";
import { readStdin } from "../lib/stdin.js";
import { addTimeoutOption, timeoutMs } from "../lib/timeout.js";

interface DecideOptions extends QuestionOptions {
  questions?: string;
  images?: string[];
  model?: string;
  input: InputFormat;
  providerOptions?: string;
  maxRetries: number;
  timeout: number;
  headers?: string;
  baseUrl?: string;
  teamIdOrSlug?: string;
  scope?: string;
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

async function resolveEvaluationModel(
  catalogOptions: Awaited<ReturnType<typeof mediaSettings>>["catalogOptions"],
  userModel?: string
): Promise<string> {
  const models = resolveModels("evaluation", userModel);
  if (models.length !== 1 || models[0].includes(","))
    throw new Error("ai decide requires exactly one evaluation model");
  const model = models[0];
  if (model === "jev") return "typesafe-ai/jev";
  if (model.includes("/")) return model;
  const known = (await fetchGatewayModels(catalogOptions)).evaluation;
  const resolved = resolveModels("evaluation", model, known)[0];
  if (!resolved.includes("/"))
    throw new Error(
      `Unknown evaluation model: ${model}. Run ai models --type evaluation.`
    );
  return resolved;
}

const append = (value: string, previous: string[] = []) => [...previous, value];

export function registerDecideCommand(program: Command) {
  const command = program
    .command("decide")
    .alias("evaluate")
    .description(
      "Answer named questions about text or images and print the result as JSON"
    )
    .example(
      'ai decide --boolean "refund=Refund requested?" < ticket.txt',
      "Ask a question about text"
    )
    .example(
      'ai decide --boolean "receipt=Is this a receipt?" --images scan.png',
      "Ask a question about an image"
    )
    .note(
      "Pipe text or JSON to stdin as input; images can be used without stdin."
    )
    .option(
      "--boolean <KEY=VALUE>",
      "Ask for P(true); repeat for multiple questions",
      append
    )
    .option(
      "--choice <KEY=VALUE>",
      "Ask for one of the supplied choices; repeatable",
      append
    )
    .option(
      "--choices <KEY=VALUE>",
      "Comma-separated choices for the named question",
      append
    )
    .option(
      "--score <KEY=VALUE>",
      "Ask for a score on ordered levels; repeatable",
      append
    )
    .option(
      "--levels <KEY=VALUE>",
      "Comma-separated score levels, lowest to highest",
      append
    )
    .option(
      "--questions <PATH>",
      "JSON file of named questions with typed criteria"
    )
    .option(
      "-i, --images <VALUE>",
      "Image file part after stdin in the decision state (repeatable)",
      collectImageReference,
      []
    )
    .option(
      "-m, --model <MODEL>",
      "Evaluation model ID or short name (default: typesafe-ai/jev)"
    )
    .option(
      "--input <FORMAT>",
      "State format: auto, text, or json (arrays stay intact)",
      parseInputFormat,
      "auto" as InputFormat
    )
    .option(
      "--provider-options <PATH>",
      "JSON file of provider-specific options"
    )
    .option(
      "--max-retries <NUMBER>",
      "Retries for transient provider failures",
      parseMaxRetries,
      2
    );
  addGatewayConnectionOptions(command);

  addTimeoutOption(command, 30_000).action(
    async (_: undefined, options: DecideOptions) => {
      const { gateway, catalogOptions } = await mediaSettings({
        headers: options.headers,
        baseUrl: options.baseUrl,
        teamIdOrSlug: options.teamIdOrSlug,
        scope: options.scope,
      });
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
      const images = await loadImageReferences(options.images ?? [], "images");
      if (process.stdin.isTTY && images.length === 0)
        throw new Error(
          "Pipe text or a JSON state to stdin, or pass --images."
        );
      const stdin = decodeEvaluationText(
        (process.stdin.isTTY ? null : await readStdin()) ?? new Uint8Array()
      );
      const state = decisionState(
        // Images may stand alone; blank stdin then adds no text part.
        images.length > 0 && !stdin.trim()
          ? undefined
          : parseState(stdin, options.input),
        images
      );
      const model = await resolveEvaluationModel(catalogOptions, options.model);
      const result = await evaluateState(state, questions, {
        model: gateway.decisionModel(model),
        timeoutMs: timeoutMs(options.timeout),
        maxRetries: options.maxRetries,
        providerOptions,
      });
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    }
  );
}

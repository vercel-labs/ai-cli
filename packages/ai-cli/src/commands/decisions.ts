import { readFile } from "node:fs/promises";

import { gateway } from "@ai-sdk/gateway";

import type { Command } from "../lib/command.js";
import {
  DEFAULT_RUBRIC,
  evaluateRecords,
  parseRubric,
  parseThreshold,
  parseUncertainPolicy,
  type DecisionCommand,
  type UncertainPolicy,
} from "../lib/evaluation.js";
import { fetchGatewayModels, resolveModels } from "../lib/models.js";
import { parsePositiveInt } from "../lib/parse.js";
import {
  decodeRecordText,
  formatRecords,
  parseInputFormat,
  parseRecords,
  type InputFormat,
} from "../lib/records.js";
import { readStdin } from "../lib/stdin.js";
import { addTimeoutOption, timeoutMs } from "../lib/timeout.js";

interface DecisionOptions {
  model?: string;
  context?: string;
  input: InputFormat;
  threshold?: number;
  onUncertain?: UncertainPolicy;
  rubric?: string;
  top?: number;
  concurrency: number;
  quiet?: boolean;
  json?: boolean;
  timeout: number;
}

async function readTextFile(path: string, flag: string): Promise<string> {
  try {
    return decodeRecordText(await readFile(path));
  } catch (error) {
    throw new Error(
      "Could not read --" +
        flag +
        " file " +
        JSON.stringify(path) +
        ": " +
        (error instanceof Error ? error.message : String(error))
    );
  }
}

async function resolveEvaluationModel(userModel?: string): Promise<string> {
  const models = resolveModels("evaluation", userModel);
  if (models.length !== 1 || models[0].includes(",")) {
    throw new Error("Decision commands require exactly one evaluation model");
  }
  const model = models[0];
  if (model === "jev") return "typesafe-ai/jev";
  if (model.includes("/")) return model;
  const known = (await fetchGatewayModels()).evaluation;
  const resolved = resolveModels("evaluation", model, known)[0];
  if (!resolved.includes("/")) {
    throw new Error(
      "Unknown evaluation model: " +
        model +
        ". Run ai models --type evaluation."
    );
  }
  return resolved;
}

export function registerDecisionCommands(program: Command) {
  const descriptions: Record<DecisionCommand, string> = {
    filter: "Keep input records that match a criterion",
    rank: "Rank input records by a criterion",
    pick: "Select one input record by a criterion",
  };
  for (const name of ["filter", "rank", "pick"] as const) {
    const command = program
      .command(name)
      .description(descriptions[name])
      .argument("<criterion>", "Natural-language criterion for input records")
      .option(
        "-m, --model <model>",
        "Evaluation model ID or short name (default: typesafe-ai/jev)"
      )
      .option(
        "--input <format>",
        "Input format",
        parseInputFormat,
        "auto" as InputFormat
      )
      .option(
        "--context <path>",
        "UTF-8 file providing context for the criterion"
      )
      .option(
        "-p, --concurrency <n>",
        "Max parallel evaluation requests",
        (value) => parsePositiveInt(value, "concurrency"),
        4
      )
      .option("-q, --quiet", "Suppress progress and outcome diagnostics")
      .option("--json", "Output records, decisions, usage, and timing as JSON");
    if (name !== "rank") {
      command.option(
        "--threshold <p>",
        "Required match probability, greater than 0.5 and at most 1",
        parseThreshold,
        0.8
      );
    }
    if (name === "filter") {
      command.option(
        "--on-uncertain <policy>",
        "Ambiguous records: error, skip, or keep",
        parseUncertainPolicy,
        "error" as UncertainPolicy
      );
    } else {
      command.option(
        "--rubric <path>",
        "JSON file of score labels, lowest to highest"
      );
    }
    if (name === "rank") {
      command.option(
        "--top <n>",
        "Return only the highest-ranked n records",
        (value) => parsePositiveInt(value, "top")
      );
    }
    addTimeoutOption(command, 30_000).action(
      async (rawCriterion: string | undefined, options: DecisionOptions) => {
        const criterion = rawCriterion?.trim();
        if (!criterion)
          throw new Error(
            "A criterion is required (for example: ai " +
              name +
              ' "describes a bug")'
          );
        // Validate local inputs before reading stdin or making any requests.
        const context = options.context
          ? await readTextFile(options.context, "context")
          : undefined;
        const rubric = options.rubric
          ? parseRubric(await readTextFile(options.rubric, "rubric"))
          : DEFAULT_RUBRIC;
        const model = await resolveEvaluationModel(options.model);
        if (process.stdin.isTTY)
          throw new Error(
            "Pipe records to stdin (lines, a JSON array, or JSONL)"
          );
        const input = parseRecords(
          decodeRecordText((await readStdin()) ?? new Uint8Array()),
          options.input
        );
        if (
          !options.quiet &&
          process.stderr.isTTY &&
          input.records.length > 0
        ) {
          process.stderr.write(
            "Evaluating " +
              input.records.length +
              " records with " +
              model +
              "…\n"
          );
        }
        const start = performance.now();
        const result = await evaluateRecords(name, input.records, {
          model: gateway.evaluationModel(model),
          criterion,
          context,
          rubric,
          timeoutMs: timeoutMs(options.timeout),
          concurrency: options.concurrency,
          threshold: options.threshold ?? 0.8,
          onUncertain: options.onUncertain ?? "error",
          top: options.top,
        });
        if (options.json) {
          process.stdout.write(
            JSON.stringify(
              {
                command: name,
                model,
                status: result.status,
                elapsed_ms: Math.round(performance.now() - start),
                input_count: input.records.length,
                count: result.selected.length,
                calls: result.calls,
                usage: result.usage,
                ...(name !== "rank" ? { threshold: options.threshold } : {}),
                ...(name !== "filter" ? { rubric } : {}),
                ...(result.selection ? { selection: result.selection } : {}),
                results: result.decisions.map(({ record, ...decision }) => ({
                  index: record.index,
                  record: record.value,
                  ...decision,
                })),
              },
              null,
              2
            ) + "\n"
          );
        } else if (result.status === "ok") {
          process.stdout.write(formatRecords(result.selected, input.format));
        }
        if (result.status !== "ok") {
          process.exitCode = result.status === "no_match" ? 3 : 4;
          if (!options.quiet) {
            process.stderr.write(
              result.status === "no_match"
                ? "No matching record found.\n"
                : "Evaluation is uncertain. Inspect --json for probabilities" +
                    (name === "filter"
                      ? " or set --on-uncertain skip|keep"
                      : "") +
                    ".\n"
            );
          }
        }
      }
    );
  }
}

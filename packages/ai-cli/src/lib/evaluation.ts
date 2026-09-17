import {
  experimental_evaluate as evaluate,
  type Experimental_EvaluationModel as EvaluationModel,
  type Experimental_EvaluationQuestion as EvaluationQuestion,
  type JSONValue,
} from "ai";

export type Questions = Record<string, EvaluationQuestion>;
type JSONObject = { [key: string]: JSONValue };
export type State = string | JSONObject | JSONValue[];
export type InputFormat = "auto" | "text" | "json";

export interface QuestionOptions {
  boolean?: string[];
  choice?: string[];
  choices?: string[];
  score?: string[];
  levels?: string[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isJSON(value: unknown): value is JSONValue {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJSON);
  return isObject(value) && Object.values(value).every(isJSON);
}

function isContent(value: unknown): value is State {
  return (
    (typeof value === "string" || Array.isArray(value) || isObject(value)) &&
    isJSON(value)
  );
}

function parseJSON(text: string, source: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON in ${source}`);
  }
}

export function decodeEvaluationText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Evaluation input must be UTF-8 text, not binary data.");
  }
}

export function parseInputFormat(value: string): InputFormat {
  if (value !== "auto" && value !== "text" && value !== "json") {
    throw new Error("--input must be one of: auto, text, json");
  }
  return value;
}

export function parseState(text: string, format: InputFormat = "auto"): State {
  if (!text.trim()) throw new Error("Pipe text or a JSON state to stdin.");
  if (format === "text") return text;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    if (format === "json" || /^\s*[{["]/.test(text)) {
      throw new Error(
        "Invalid JSON in stdin. Use --input text for plain text."
      );
    }
    return text;
  }
  if (!isContent(value)) {
    throw new Error(
      "JSON state must be a string, object, or array with finite numbers. Use --input text for plain text."
    );
  }
  return value;
}

function validateQuestions(value: unknown): asserts value is Questions {
  if (!isObject(value) || Object.keys(value).length === 0) {
    throw new Error(
      'At least one named question is required. Use --boolean "refund=Refund requested?" or --questions questions.json.'
    );
  }
  for (const [id, question] of Object.entries(value)) {
    const fail = (message: string): never => {
      throw new Error(`Question ${JSON.stringify(id)}: ${message}`);
    };
    if (!id.trim()) fail("ID must not be empty");
    if (!isObject(question))
      throw new Error(`Question ${JSON.stringify(id)} must be an object`);
    // Reject misspelled fields instead of letting the SDK ignore them.
    if (
      Object.keys(question).some(
        (key) => !["type", "instructions", "criteria"].includes(key)
      )
    ) {
      fail("only type, instructions, and criteria are supported");
    }
    if (
      !isContent(question.instructions) ||
      (typeof question.instructions === "string" &&
        !question.instructions.trim())
    ) {
      fail("instructions must be a nonempty string, JSON object, or array");
    }
    const criteria = question.criteria;
    switch (question.type) {
      case "boolean":
        if (criteria === undefined) continue;
        if (
          !isObject(criteria) ||
          Object.keys(criteria).some((key) => key !== "true" && key !== "false")
        ) {
          fail("boolean criteria may only describe true and false");
        }
        break;
      case "choice":
        if (!isObject(criteria) || Object.keys(criteria).length === 0)
          fail("choice criteria must be a nonempty option map");
        break;
      case "score":
        if (!Array.isArray(criteria) || criteria.length < 2)
          fail("score criteria must contain at least two ordered levels");
        break;
      default:
        fail("type must be boolean, choice, or score");
    }
    if (
      !isJSON(criteria) ||
      criteria === null ||
      Object.values(criteria).some(
        (description) => description !== null && !isContent(description)
      )
    ) {
      fail(
        "criteria descriptions must be strings, JSON objects, arrays, or null"
      );
    }
  }
}

export function parseQuestions(text: string): Questions {
  const value = parseJSON(text, "--questions file");
  validateQuestions(value);
  return value;
}

function namedValue(value: string, flag: string): [string, string] {
  const separator = value.indexOf("=");
  const id = value.slice(0, separator).trim();
  const content = value.slice(separator + 1).trim();
  if (separator < 1 || !id || !content)
    throw new Error(`--${flag} requires id=value with a nonempty ID and value`);
  return [id, content];
}

export function buildQuestions(
  options: QuestionOptions,
  base: Questions = {}
): Questions {
  const questions = new Map<string, unknown>(Object.entries(base));
  for (const type of ["boolean", "choice", "score"] as const) {
    for (const value of options[type] ?? []) {
      const [id, instructions] = namedValue(value, type);
      if (questions.has(id)) throw new Error(`Duplicate question ID: ${id}`);
      questions.set(id, { type, instructions });
    }
  }
  const suppliedCriteria = new Set<string>();
  for (const flag of ["choices", "levels"] as const) {
    const type = flag === "choices" ? "choice" : "score";
    for (const value of options[flag] ?? []) {
      const [id, content] = namedValue(value, flag);
      const question = questions.get(id);
      if (!isObject(question) || question.type !== type)
        throw new Error(
          `--${flag} requires a matching --${type} question: ${id}`
        );
      if (suppliedCriteria.has(id) || question.criteria !== undefined)
        throw new Error(`Duplicate criteria for question: ${id}`);
      const labels = content.split(",").map((label) => label.trim());
      if (
        labels.some((label) => !label) ||
        new Set(labels).size !== labels.length
      )
        throw new Error(
          `--${flag} labels must be nonempty and unique. Use --questions for descriptions containing commas.`
        );
      questions.set(id, {
        ...question,
        criteria:
          type === "choice"
            ? Object.fromEntries(labels.map((label) => [label, label]))
            : labels,
      });
      suppliedCriteria.add(id);
    }
  }
  const result = Object.fromEntries(questions);
  validateQuestions(result);
  return result;
}

export function parseProviderOptions(text: string): Record<string, JSONObject> {
  const value = parseJSON(text, "--provider-options file");
  if (
    !isObject(value) ||
    !isJSON(value) ||
    Object.values(value).some((options) => !isObject(options))
  ) {
    throw new Error(
      "--provider-options must contain a JSON object of provider names to option objects"
    );
  }
  return value as Record<string, JSONObject>;
}

export function parseMaxRetries(value: string): number {
  const retries = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(retries))
    throw new Error("--max-retries must be a non-negative integer");
  return retries;
}

export async function evaluateState(
  state: State,
  questions: Questions,
  options: {
    model: EvaluationModel;
    timeoutMs: number;
    maxRetries?: number;
    providerOptions?: Record<string, JSONObject>;
  }
) {
  return evaluate({
    model: options.model,
    state,
    questions,
    maxRetries: options.maxRetries,
    providerOptions: options.providerOptions,
    headers: {
      "http-referer": "https://github.com/vercel-labs/ai-cli",
      "x-title": "ai-cli",
    },
    // One deadline includes any SDK retries. Never split state or questions.
    abortSignal: AbortSignal.timeout(options.timeoutMs),
  });
}

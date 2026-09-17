import { describe, expect, test } from "bun:test";

import type { Experimental_EvaluationModel as EvaluationModel } from "ai";

import {
  buildQuestions,
  decodeEvaluationText,
  evaluateState,
  parseInputFormat,
  parseMaxRetries,
  parseProviderOptions,
  parseQuestions,
  parseState,
  type Questions,
  type QuestionOptions,
} from "./evaluation.js";

type Model = Exclude<EvaluationModel, string>;
type Call = Parameters<Model["doEvaluate"]>[0];
type Result = Awaited<ReturnType<Model["doEvaluate"]>>;

function harness(respond: (call: Call) => Result | Promise<Result>) {
  const calls: Call[] = [];
  const model: Model = {
    specificationVersion: "v4",
    provider: "test",
    modelId: "test/evaluation",
    supportedQuestionTypes: ["boolean", "choice", "score"],
    async doEvaluate(call) {
      calls.push(call);
      return respond(call);
    },
  };
  return { calls, options: { model, timeoutMs: 1000, maxRetries: 0 } };
}

const mixed = buildQuestions({
  boolean: ["refund=Refund requested?"],
  choice: ["team=Which team?"],
  choices: ["team=billing,support"],
  score: ["tone=How positive?"],
  levels: ["tone=angry,neutral,happy"],
});
const answers: Result["answers"] = {
  refund: { type: "boolean", probability: 0.01 },
  team: {
    type: "choice",
    choice: "billing",
    probabilities: { billing: 0.9, support: 0.1 },
  },
  tone: {
    type: "score",
    score: 0.3,
    probabilities: { "0": 0.8, "1": 0.1, "2": 0.1 },
  },
};

describe("evaluate evaluation", () => {
  test("all questions share unchanged state in one request and retain native metadata", async () => {
    const metadata = { typesafe: { confidence: { team: 0.72, tone: 0.65 } } };
    const { calls, options } = harness(() => ({
      answers,
      providerMetadata: metadata,
      warnings: [],
      usage: { inputTokens: 20, outputTokens: 0 },
    }));
    const state = [
      { message: "I was charged twice. Refund the extra charge." },
      { account: "123" },
    ];
    const result = await evaluateState(state, mixed, {
      ...options,
      providerOptions: { gateway: { order: ["typesafe-ai"] } },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].state).toBe(state);
    expect(calls[0].questions).toBe(mixed);
    expect(calls[0].providerOptions).toEqual({
      gateway: { order: ["typesafe-ai"] },
    });
    expect(result.answers).toEqual(answers);
    expect(result.providerMetadata).toEqual(metadata);
    expect(result.usage).toEqual({
      inputTokens: 20,
      outputTokens: 0,
      totalTokens: 20,
    });
  });

  test("does not cap or split question sets at the old batch size", async () => {
    const questions = buildQuestions({
      boolean: Array.from(
        { length: 100 },
        (_, i) => `q${i}=Is a refund requested?`
      ),
    });
    const { calls, options } = harness((call) => ({
      answers: Object.fromEntries(
        Object.keys(call.questions).map((id) => [
          id,
          { type: "boolean", probability: 0.5 },
        ])
      ),
      warnings: [],
    }));
    const result = await evaluateState("message", questions, options);
    expect(calls).toHaveLength(1);
    expect(Object.keys(result.answers)).toHaveLength(100);
    expect(result.usage.inputTokens).toBeUndefined();
  });

  test("does not synthesize distributions or native confidence", async () => {
    const { options } = harness(() => ({
      answers: { team: { type: "choice", choice: "billing" } },
      warnings: [],
    }));
    const result = await evaluateState({}, { team: mixed.team }, options);
    expect(result.answers.team).toEqual({ type: "choice", choice: "billing" });
    expect(result.providerMetadata).toBeUndefined();
  });

  test.each([
    {},
    { refund: { type: "boolean", probability: 2 } },
    { refund: { type: "score", score: 0 } },
  ])("rejects invalid or incomplete provider output", async (invalid) => {
    const { options } = harness(() => ({
      answers: invalid as Result["answers"],
      warnings: [],
    }));
    await expect(
      evaluateState("message", { refund: mixed.refund }, options)
    ).rejects.toThrow();
  });

  test("rejects invented choices", async () => {
    const { options } = harness(() => ({
      answers: { team: { type: "choice", choice: "invented" } },
      warnings: [],
    }));
    await expect(
      evaluateState("message", { team: mixed.team }, options)
    ).rejects.toThrow("unknown option");
  });

  test("provider failures and deadline cancellation fail the request", async () => {
    const failed = harness(() => {
      throw new Error("provider failed");
    });
    await expect(
      evaluateState("message", mixed, failed.options)
    ).rejects.toThrow("provider failed");
    const blocked = harness(
      (call) =>
        new Promise((_, reject) => {
          call.abortSignal!.addEventListener(
            "abort",
            () => reject(call.abortSignal!.reason),
            { once: true }
          );
        })
    );
    await expect(
      evaluateState("message", mixed, { ...blocked.options, timeoutMs: 10 })
    ).rejects.toThrow();
    expect(blocked.calls[0].abortSignal?.aborted).toBe(true);
  });
});

describe("evaluate input", () => {
  test("preserves strings, JSON objects, arrays, and whitespace", () => {
    expect(parseState("  first\n\nsecond\n")).toBe("  first\n\nsecond\n");
    expect(parseState('[{"id":1},{"id":2}]')).toEqual([{ id: 1 }, { id: 2 }]);
    expect(parseState('{"message":"hello"}')).toEqual({ message: "hello" });
    expect(parseState('"hello\nworld"', "text")).toBe('"hello\nworld"');
    expect(parseState('"hello"')).toBe("hello");
    expect(parseState("[]")).toEqual([]);
    expect(parseState("[INFO] ready\n", "text")).toBe("[INFO] ready\n");
  });

  test.each([
    "",
    "  ",
    "null",
    "true",
    "42",
    '{"x":1e999}',
    '[{"id":1}',
    '{"id":1}\n{"id":2}',
  ])("rejects empty or invalid state: %s", (text) => {
    expect(() => parseState(text)).toThrow();
  });

  test("rejects binary input and invalid formats", () => {
    expect(() => decodeEvaluationText(new Uint8Array([0xff]))).toThrow("UTF-8");
    expect(() => parseState("hello", "json")).toThrow("Invalid JSON");
    expect(() => parseInputFormat("jsonl")).toThrow("--input");
  });

  test("full question files preserve structured instructions and criteria", () => {
    const raw: Questions = {
      refund: {
        type: "boolean",
        instructions: { task: "Refund requested?", examples: ["money back"] },
        criteria: { true: ["explicit request"], false: null },
      },
      team: {
        type: "choice",
        instructions: ["Which team?"],
        criteria: {
          billing: { handles: ["payments", "refunds"] },
          support: null,
        },
      },
      impact: {
        type: "score",
        instructions: "How many users are affected?",
        criteria: [{ scope: "one user" }, ["everyone"]],
      },
    };
    expect(parseQuestions(JSON.stringify(raw))).toEqual(raw);
    expect(
      buildQuestions(
        { boolean: ["extra=Cancel requested?"] },
        parseQuestions(JSON.stringify(raw))
      )
    ).toMatchObject(raw);
  });

  test.each([
    { boolean: ["missing-id"] },
    { boolean: ["=empty"] },
    { boolean: ["id= "] },
    { boolean: ["id=one", "id=two"] },
    { boolean: ["id=one"], choice: ["id=two"] },
    { choice: ["team=Which team?"] },
    { choices: ["team=billing,support"] },
    { choice: ["team=Which team?"], choices: ["team=billing,billing"] },
    { choice: ["team=Which team?"], choices: ["team=billing,,support"] },
    { score: ["impact=How severe?"], levels: ["impact=one"] },
    { score: ["impact=How severe?"], choices: ["impact=one,two"] },
    {
      score: ["impact=How severe?"],
      levels: ["impact=one,two", "impact=low,high"],
    },
  ] satisfies QuestionOptions[])(
    "rejects ambiguous inline questions",
    (options) => {
      expect(() => buildQuestions(options)).toThrow();
    }
  );

  test("rejects duplicate IDs across a file and inline flags", () => {
    expect(() =>
      buildQuestions({ boolean: ["refund=Another question?"] }, mixed)
    ).toThrow("Duplicate question ID");
  });

  test.each(
    [
      {},
      [],
      { x: { type: "boolean", instructions: "q", instruction: "typo" } },
      { x: { type: "boolean", instructions: 1 } },
      { x: { type: "boolean", instructions: "q", criteria: { yes: "yes" } } },
      { x: { type: "choice", instructions: "q", criteria: { a: 1 } } },
      { x: { type: "noul", instructions: "q" } },
    ].map((value) => JSON.stringify(value))
  )("validates question-file schema", (value) => {
    expect(() => parseQuestions(value)).toThrow();
  });

  test("question IDs and choice names cannot overwrite object prototypes", () => {
    const q = buildQuestions({
      choice: ["__proto__=Which option?"],
      choices: ["__proto__=__proto__,constructor"],
    });
    expect(Object.hasOwn(q, "__proto__")).toBe(true);
    expect(Object.keys(q.__proto__.criteria!)).toEqual([
      "__proto__",
      "constructor",
    ]);
  });

  test("defers model limits to the provider while preserving SDK-valid criteria", async () => {
    const questions: Questions = {
      score: {
        type: "score",
        instructions: "Rate",
        criteria: Array.from({ length: 11 }, (_, i) => String(i)),
      },
      choice: {
        type: "choice",
        instructions: "Choose",
        criteria: Object.fromEntries(
          Array.from({ length: 256 }, (_, i) => [String(i), null])
        ),
      },
    };
    const { calls, options } = harness(() => ({
      answers: {
        score: { type: "score", score: 10 },
        choice: { type: "choice", choice: "255" },
      },
      warnings: [],
    }));
    const result = await evaluateState(
      "message",
      parseQuestions(JSON.stringify(questions)),
      options
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].questions).toEqual(questions);
    expect(result.answers.score).toEqual({ type: "score", score: 10 });
  });

  test("validates provider options and retry counts", () => {
    expect(
      parseProviderOptions('{"gateway":{"order":["typesafe-ai"]}}')
    ).toEqual({ gateway: { order: ["typesafe-ai"] } });
    for (const text of [
      "[]",
      "null",
      '{"gateway":true}',
      '{"gateway":{"x":1e999}}',
    ])
      expect(() => parseProviderOptions(text)).toThrow();
    expect(parseMaxRetries("0")).toBe(0);
    for (const text of ["", "-1", "2.1", "2x", "Infinity", "9007199254740992"])
      expect(() => parseMaxRetries(text)).toThrow();
  });
});

import { describe, expect, test } from "bun:test";

import type { Experimental_EvaluationModel as EvaluationModel } from "ai";

import {
  DEFAULT_RUBRIC,
  evaluateRecords,
  parseRubric,
  parseThreshold,
  parseUncertainPolicy,
  type EvaluationOptions,
} from "./evaluation.js";
import { parseRecords } from "./records.js";

type Model = Exclude<EvaluationModel, string>;
type Call = Parameters<Model["doEvaluate"]>[0];
type Response = Awaited<ReturnType<Model["doEvaluate"]>>;

function harness(
  answer: (call: Call) => Response["answers"] | Promise<Response["answers"]>
) {
  const calls: Call[] = [];
  const model: Model = {
    specificationVersion: "v4",
    provider: "test",
    modelId: "test/evaluation",
    supportedQuestionTypes: ["boolean", "score", "choice"],
    async doEvaluate(call) {
      calls.push(call);
      return {
        answers: await answer(call),
        warnings: [],
        usage: { inputTokens: 10, outputTokens: 2 },
      };
    },
  };
  const options: EvaluationOptions = {
    model,
    criterion: "matches the task",
    timeoutMs: 1000,
    concurrency: 4,
    threshold: 0.8,
    onUncertain: "error",
    rubric: DEFAULT_RUBRIC,
  };
  return { options, calls };
}

const records = parseRecords('{"id":"a"}\n{"id":"b"}\n{"id":"c"}').records;

describe("evaluating records", () => {
  test("filter batches independent questions and preserves source order", async () => {
    const { options, calls } = harness(() => ({
      record_1: { type: "boolean", probability: 0.8 },
      record_2: { type: "boolean", probability: 0.2 },
      record_3: { type: "boolean", probability: 0.95 },
    }));
    const result = await evaluateRecords("filter", records, {
      ...options,
      context: "user context",
    });
    expect(result.status).toBe("ok");
    expect(result.selected).toEqual([records[0], records[2]]);
    expect(calls).toHaveLength(1);
    expect(calls[0].state).toEqual({
      records: {
        record_1: { id: "a" },
        record_2: { id: "b" },
        record_3: { id: "c" },
      },
      context: "user context",
    });
    expect(JSON.stringify(calls[0].questions.record_2.instructions)).toContain(
      "record_2"
    );
    expect(result.usage).toEqual({ input_tokens: 10, output_tokens: 2 });
  });

  test("filter handles uncertain records explicitly", async () => {
    const { options } = harness(() => ({
      record_1: { type: "boolean", probability: 0.99 },
      record_2: { type: "boolean", probability: 0.5 },
      record_3: { type: "boolean", probability: 0.01 },
    }));
    const error = await evaluateRecords("filter", records, options);
    expect(error.status).toBe("uncertain");
    expect(error.selected).toEqual([]);
    expect(error.decisions.some((decision) => decision.selected)).toBe(false);
    const skip = await evaluateRecords("filter", records, {
      ...options,
      onUncertain: "skip",
    });
    expect(skip.selected).toEqual([records[0]]);
    const keep = await evaluateRecords("filter", records, {
      ...options,
      onUncertain: "keep",
    });
    expect(keep.selected).toEqual([records[0], records[1]]);
  });

  test("rank uses common score levels, stable ties, and top-k", async () => {
    const { options, calls } = harness(() => ({
      record_1: { type: "score", score: 1 },
      record_2: { type: "score", score: 4 },
      record_3: { type: "score", score: 4 },
    }));
    const result = await evaluateRecords("rank", records, {
      ...options,
      top: 2,
    });
    expect(result.selected).toEqual([records[1], records[2]]);
    expect(calls[0].questions.record_1.criteria).toEqual(DEFAULT_RUBRIC);
    expect(calls[0].questions.record_3.criteria).toEqual(DEFAULT_RUBRIC);
    expect(result.decisions.map((d) => d.score)).toEqual([4, 4, 1]);
  });

  test("pick chooses an original record and checks existence in the same request", async () => {
    const { options, calls } = harness(() => ({
      choice: {
        type: "choice",
        choice: "record_2",
        probabilities: { record_1: 0.01, record_2: 0.98, record_3: 0.01 },
      },
      exists: { type: "boolean", probability: 0.99 },
    }));
    const result = await evaluateRecords("pick", records, options);
    expect(result.selected).toEqual([records[1]]);
    expect(calls).toHaveLength(1);
    expect(calls[0].questions.exists.type).toBe("boolean");
    expect(result.selection?.choice_probability).toBe(0.98);
  });

  test("a confident closest choice still returns no match when nothing qualifies", async () => {
    const { options } = harness(() => ({
      choice: {
        type: "choice",
        choice: "record_1",
        probabilities: { record_1: 1, record_2: 0, record_3: 0 },
      },
      exists: { type: "boolean", probability: 0.2 },
    }));
    const result = await evaluateRecords("pick", records, options);
    expect(result.status).toBe("no_match");
    expect(result.selected).toEqual([]);
  });

  test("pick abstains for ambiguous choices and absent distributions", async () => {
    const { options } = harness(() => ({
      choice: {
        type: "choice",
        choice: "record_1",
        probabilities: { record_1: 0.5, record_2: 0.5, record_3: 0 },
      },
      exists: { type: "boolean", probability: 0.99 },
    }));
    expect((await evaluateRecords("pick", records, options)).status).toBe(
      "uncertain"
    );
    const missing = harness(() => ({
      choice: { type: "choice", choice: "record_1" },
      exists: { type: "boolean", probability: 0.99 },
    }));
    expect(
      (await evaluateRecords("pick", records, missing.options)).status
    ).toBe("uncertain");
  });

  test("more than 255 records are scored in batches before a bounded choice", async () => {
    const many = parseRecords(
      JSON.stringify(Array.from({ length: 300 }, (_, id) => ({ id })))
    ).records;
    const { options, calls } = harness((call) => {
      const answers: Response["answers"] = {};
      for (const [id, question] of Object.entries(call.questions)) {
        if (question.type === "score") {
          answers[id] = { type: "score", score: id === "record_300" ? 4 : 1 };
        } else if (question.type === "choice") {
          answers[id] = {
            type: "choice",
            choice: "record_300",
            probabilities: Object.fromEntries(
              Object.keys(question.criteria).map((key) => [
                key,
                key === "record_300" ? 1 : 0,
              ])
            ),
          };
        } else {
          answers[id] = { type: "boolean", probability: 1 };
        }
      }
      return answers;
    });
    const result = await evaluateRecords("pick", many, options);
    expect(result.selected).toEqual([many[299]]);
    expect(calls).toHaveLength(6);
    expect(Object.keys(calls[5].questions.choice.criteria!)).toHaveLength(32);
    expect(result.usage.input_tokens).toBe(60);
    expect(result.selection?.shortlisted).toBe(32);
  });

  test("empty input avoids all requests", async () => {
    const { options, calls } = harness(() => {
      throw new Error("must not be called");
    });
    expect((await evaluateRecords("filter", [], options)).status).toBe("ok");
    expect((await evaluateRecords("rank", [], options)).status).toBe("ok");
    expect((await evaluateRecords("pick", [], options)).status).toBe(
      "no_match"
    );
    expect(calls).toEqual([]);
  });

  test("provider failures fail the whole decision instead of yielding a partial selection", async () => {
    const { options } = harness(() => {
      throw new Error("provider failed");
    });
    await expect(evaluateRecords("rank", records, options)).rejects.toThrow(
      "provider failed"
    );
  });

  test("provider failures stop pending batches and abort in-flight requests", async () => {
    const many = parseRecords(
      JSON.stringify(Array.from({ length: 320 }, (_, id) => ({ id })))
    ).records;
    const { options, calls } = harness(async (call) => {
      if (Object.hasOwn(call.questions, "record_65")) {
        await Promise.resolve();
        throw new Error("provider failed");
      }
      return new Promise<Response["answers"]>((_, reject) => {
        const signal = call.abortSignal!;
        const abort = () => reject(signal.reason);
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      });
    });

    await expect(
      evaluateRecords("rank", many, { ...options, concurrency: 2 })
    ).rejects.toThrow("provider failed");
    expect(calls).toHaveLength(2);
    expect(calls[0].abortSignal?.aborted).toBe(true);
  });

  test("SDK rejects invented candidate IDs", async () => {
    const { options } = harness(() => ({
      choice: { type: "choice", choice: "invented" },
      exists: { type: "boolean", probability: 1 },
    }));
    await expect(evaluateRecords("pick", records, options)).rejects.toThrow();
  });
});

describe("decision option validation", () => {
  test("thresholds, uncertainty policies, and rubrics are validated", () => {
    for (const value of [
      "",
      "0.5",
      "-1",
      "1.1",
      "NaN",
      "Infinity",
      "0.8junk",
    ]) {
      expect(() => parseThreshold(value)).toThrow("--threshold");
    }
    expect(parseThreshold("0.8")).toBe(0.8);
    expect(() => parseUncertainPolicy("guess")).toThrow("--on-uncertain");
    expect(parseRubric('["none","some","all"]')).toEqual([
      "none",
      "some",
      "all",
    ]);
    for (const value of [
      "{}",
      '["one"]',
      '["one",2]',
      '["one",""]',
      "invalid",
    ]) {
      expect(() => parseRubric(value)).toThrow("--rubric");
    }
  });
});

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "ai-cli-evaluate-"));
const preload = join(directory, "gateway.js");
writeFileSync(
  preload,
  `
import { appendFileSync } from "node:fs";
let calls = 0;
globalThis.fetch = async (url, init) => {
  if (!String(url).endsWith('/evaluation-model')) throw new Error('Unexpected network request');
  appendFileSync(process.env.TEST_REQUESTS, JSON.stringify(JSON.parse(init.body)) + '\\n');
  calls++;
  const status = calls <= Number(process.env.TEST_FAIL_FIRST || 0) ? 503 : Number(process.env.TEST_STATUS || 200);
  return new Response(JSON.stringify(status === 200 ? JSON.parse(process.env.TEST_RESPONSE) : { error: 'provider unavailable' }), { status, headers: { 'content-type': 'application/json' } });
};
if (process.env.TEST_STDOUT_TTY) process.stdout.isTTY = true;
`
);
afterAll(() => rmSync(directory, { recursive: true, force: true }));

const graphicArgs = [
  "--boolean",
  "refund=Refund requested?",
  "--choice",
  "team=Which team?",
  "--choices",
  "team=billing,support",
  "--score",
  "tone=How positive?",
  "--levels",
  "tone=angry,neutral,happy",
];
const mixedAnswers = {
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

async function run(
  args: string[],
  input: string,
  response: Record<string, unknown> = { answers: mixedAnswers },
  extraEnv: Record<string, string> = {}
) {
  const requestPath = join(directory, `requests-${crypto.randomUUID()}.jsonl`);
  writeFileSync(requestPath, "");
  const proc = Bun.spawn(
    ["bun", "run", "--preload", preload, "src/index.ts", "evaluate", ...args],
    {
      cwd: import.meta.dir + "/../..",
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        AI_GATEWAY_API_KEY: "test-key",
        AI_CLI_EVALUATION_MODEL: "typesafe-ai/jev",
        TEST_REQUESTS: requestPath,
        TEST_RESPONSE: JSON.stringify(response),
        ...extraEnv,
      },
    }
  );
  proc.stdin.write(input);
  proc.stdin.end();
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const requests = readFileSync(requestPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return { stdout, stderr, exitCode, requests };
}

describe("evaluate CLI", () => {
  test("the graphic's exact syntax sends one mixed request and prints complete JSON in a TTY", async () => {
    const providerMetadata = {
      typesafe: { confidence: { team: 0.72, tone: 0.65 } },
      gateway: { cost: "0.0001" },
    };
    const result = await run(
      graphicArgs,
      "  Original ticket\n\nwith details\n",
      {
        answers: mixedAnswers,
        providerMetadata,
        usage: { inputTokens: 20, outputTokens: 0 },
        rounding: { probabilityDecimals: 2, scoreDecimals: 2 },
      },
      { TEST_STDOUT_TTY: "1" }
    );
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0].state).toBe(
      "  Original ticket\n\nwith details\n"
    );
    expect(Object.keys(result.requests[0].questions)).toHaveLength(3);
    expect(result.requests[0].questions.team.criteria).toEqual({
      billing: "billing",
      support: "support",
    });
    const output = JSON.parse(result.stdout);
    expect(output).toMatchObject({
      answers: mixedAnswers,
      providerMetadata,
      usage: { inputTokens: 20, outputTokens: 0, totalTokens: 20 },
      rounding: { probabilityDecimals: 2, scoreDecimals: 2 },
      response: { modelId: "typesafe-ai/jev" },
    });
    expect(Number.isNaN(Date.parse(output.response.timestamp))).toBe(false);
    expect(output.response.body.answers).toEqual(mixedAnswers);
    expect(output.response.headers["content-type"]).toBe("application/json");
    expect(Object.keys(output).sort()).toEqual([
      "answers",
      "providerMetadata",
      "response",
      "rounding",
      "usage",
      "warnings",
    ]);
    expect(output).not.toHaveProperty("state");
  });

  test("question and provider files preserve structured data alongside inline questions", async () => {
    const path = join(directory, "questions.json");
    const providers = join(directory, "providers.json");
    const question = {
      type: "choice",
      instructions: { task: "Which team?" },
      criteria: {
        billing: { handles: ["payments", "refunds"] },
        support: null,
      },
    };
    writeFileSync(path, JSON.stringify({ team: question }));
    writeFileSync(
      providers,
      JSON.stringify({ gateway: { order: ["typesafe-ai"] } })
    );
    const result = await run(
      [
        "--questions",
        path,
        "--boolean",
        "refund=Refund requested?",
        "--provider-options",
        providers,
        "-m",
        "jev",
      ],
      '[{"message":"Refund please"},{"account":"123"}]',
      { answers: { team: mixedAnswers.team, refund: mixedAnswers.refund } }
    );
    expect(result.exitCode).toBe(0);
    expect(result.requests[0].state).toEqual([
      { message: "Refund please" },
      { account: "123" },
    ]);
    expect(result.requests[0].questions.team).toEqual(question);
    expect(result.requests[0].providerOptions).toEqual({
      gateway: { order: ["typesafe-ai"] },
    });
    expect(JSON.parse(result.stdout).usage).toEqual({});
  });

  test("CLI JSON matches the SDK result without renaming or dropping fields", async () => {
    const fixture = {
      answers: mixedAnswers,
      usage: { inputTokens: 20, outputTokens: 0 },
      warnings: [],
      rounding: { probabilityDecimals: 2 },
      providerMetadata: { typesafe: { confidence: { team: 0.72 } } },
    };
    const result = await run(graphicArgs, "ticket", fixture);
    expect(result.exitCode).toBe(0);

    const { experimental_evaluate } = await import("ai");
    const { createGateway } = await import("@ai-sdk/gateway");
    const gateway = createGateway({
      apiKey: "test-key",
      fetch: Object.assign(
        async () =>
          new Response(JSON.stringify(fixture), {
            headers: { "content-type": "application/json" },
          }),
        { preconnect: () => {} }
      ),
    });
    const sdk = await experimental_evaluate({
      model: gateway.evaluationModel("typesafe-ai/jev"),
      state: result.requests[0].state,
      questions: result.requests[0].questions,
      maxRetries: 0,
    });
    const output = JSON.parse(result.stdout);
    const expected = JSON.parse(JSON.stringify(sdk));
    expected.response.timestamp = output.response.timestamp;
    expect(output).toEqual(expected);
  });

  test("passes model-specific limits to the provider and accepts other evaluation models", async () => {
    const args = [
      "--score",
      "q=Rate?",
      "--levels",
      "q=" + Array.from({ length: 11 }, (_, i) => String(i)).join(","),
    ];
    const rejected = await run(args, "text", {}, { TEST_STATUS: "400" });
    expect(rejected.exitCode).toBe(1);
    expect(rejected.requests).toHaveLength(1);
    expect(rejected.stdout).toBe("");

    const supported = await run([...args, "-m", "example/evaluator"], "text", {
      answers: { q: { type: "score", score: 10 } },
    });
    expect(supported.exitCode).toBe(0);
    expect(JSON.parse(supported.stdout).response.modelId).toBe(
      "example/evaluator"
    );
  });

  test("flag order does not bind choices to the wrong question", async () => {
    const result = await run(
      [
        "--choices",
        "team=billing,support",
        "--boolean",
        "refund=Refund requested?",
        "--choice",
        "team=Which team?",
      ],
      "message",
      { answers: { team: mixedAnswers.team, refund: mixedAnswers.refund } }
    );
    expect(result.exitCode).toBe(0);
    expect(result.requests[0].questions.team.criteria).toEqual({
      billing: "billing",
      support: "support",
    });
  });

  test.each([0, 0.01, 0.5, 1])(
    "P(true)=%s remains a successful answer",
    async (probability) => {
      const result = await run(
        ["--boolean", "q=Refund requested?"],
        "message",
        { answers: { q: { type: "boolean", probability } } }
      );
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout).answers.q.probability).toBe(probability);
      expect(result.stderr).toBe("");
    }
  );

  test("accepts empty JSON arrays as shared state", async () => {
    const result = await run(["--boolean", "q=Any requests present?"], "[]", {
      answers: { q: { type: "boolean", probability: 0 } },
    });
    expect(result.exitCode).toBe(0);
    expect(result.requests[0].state).toEqual([]);
  });

  test("invalid local inputs fail before any network request or stdout", async () => {
    for (const [args, input] of [
      [graphicArgs, '[{"id":1}'],
      [["--boolean", "q=Test?"], ""],
      [
        ["--boolean", "q=Test?", "-m", "typesafe-ai/jev,typesafe-ai/jev"],
        "text",
      ],
      [["--questions", join(directory, "missing.json")], "text"],
      [["--boolean", "q=Test?", "--boolean", "q=Again?"], "text"],
    ] as [string[], string][]) {
      const result = await run(args, input);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.requests).toHaveLength(0);
    }
  });

  test("provider and invalid response failures emit no partial JSON", async () => {
    const environments: Record<string, string>[] = [{ TEST_STATUS: "403" }, {}];
    for (const extraEnv of environments) {
      const result = await run(
        graphicArgs,
        "text",
        { answers: { refund: mixedAnswers.refund } },
        extraEnv
      );
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).not.toBe("");
      expect(result.requests).toHaveLength(1);
    }
  });

  test("transient failures honor the configured retry limit", async () => {
    const noRetry = await run(
      [...graphicArgs, "--max-retries", "0"],
      "text",
      { answers: mixedAnswers },
      { TEST_FAIL_FIRST: "1" }
    );
    expect(noRetry.exitCode).toBe(1);
    expect(noRetry.requests).toHaveLength(1);
    const retry = await run(
      [...graphicArgs, "--max-retries", "1"],
      "text",
      { answers: mixedAnswers },
      { TEST_FAIL_FIRST: "1" }
    );
    expect(retry.exitCode).toBe(0);
    expect(retry.requests).toHaveLength(2);
  });
});

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, test } from "vitest";

import { runNode } from "../test/process.js";

const directory = mkdtempSync(join(tmpdir(), "ai-cli-decide-"));
const preload = join(directory, "gateway.mjs");
writeFileSync(
  preload,
  `
import { appendFileSync } from "node:fs";
let calls = 0;
globalThis.fetch = async (url, init) => {
  if (!String(url).endsWith('/decision-model')) throw new Error('Unexpected network request');
  appendFileSync(process.env.TEST_REQUESTS, JSON.stringify(JSON.parse(init.body)) + '\\n');
  appendFileSync(process.env.TEST_REQUESTS + '.meta', JSON.stringify({ url: String(url), headers: Object.fromEntries(new Headers(init.headers)) }) + '\\n');
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
  extraEnv: Record<string, string> = {},
  command: "decide" | "evaluate" = "decide"
) {
  const requestPath = join(directory, `requests-${crypto.randomUUID()}.jsonl`);
  writeFileSync(requestPath, "");
  writeFileSync(requestPath + ".meta", "");
  const { stdout, stderr, exitCode } = await runNode(
    ["--import", "tsx", "--import", preload, "src/index.ts", command, ...args],
    {
      cwd: import.meta.dirname + "/../..",
      env: {
        ...process.env,
        AI_GATEWAY_API_KEY: "test-key",
        AI_CLI_EVALUATION_MODEL: "typesafe-ai/jev",
        TEST_REQUESTS: requestPath,
        TEST_RESPONSE: JSON.stringify(response),
        ...extraEnv,
      },
    },
    input
  );
  const meta = readFileSync(requestPath + ".meta", "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const requests = readFileSync(requestPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return { stdout, stderr, exitCode, requests, meta };
}

describe("decide CLI", () => {
  test("evaluate remains an alias with identical requests and JSON output", async () => {
    const [result, alias] = await Promise.all([
      run(graphicArgs, "ticket"),
      run(graphicArgs, "ticket", undefined, {}, "evaluate"),
    ]);
    expect(result.exitCode).toBe(0);
    expect(alias.exitCode).toBe(0);
    expect(alias.stderr).toBe("");
    expect(alias.requests).toEqual(result.requests);
    const output = JSON.parse(result.stdout);
    const aliasOutput = JSON.parse(alias.stdout);
    aliasOutput.response.timestamp = output.response.timestamp;
    expect(aliasOutput).toEqual(output);
  });

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
    expect(result.requests[0].stateParts).toEqual([
      { type: "text", text: "  Original ticket\n\nwith details\n" },
    ]);
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
    expect(result.requests[0].stateParts).toEqual([
      {
        type: "json",
        value: [{ message: "Refund please" }, { account: "123" }],
      },
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

    const { experimental_decide } = await import("ai");
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
    const sdk = await experimental_decide({
      model: gateway.decisionModel("typesafe-ai/jev"),
      state: result.requests[0].stateParts,
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

  test("--images adds ordered file parts after stdin and works without stdin", async () => {
    const png = join(directory, "pixel.png");
    writeFileSync(
      png,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64"
      )
    );
    const answers = { q: { type: "boolean", probability: 0.9 } };
    const args = ["--boolean", "q=Is it a pixel?", "--images", png];
    const withText = await run(args, "caption", { answers });
    expect(withText.exitCode).toBe(0);
    const parts = withText.requests[0].stateParts;
    expect(parts.map((part: { type: string }) => part.type)).toEqual([
      "text",
      "file",
    ]);
    expect(parts[1].mediaType).toBe("image/png");
    expect(parts[1].data).toEqual({
      type: "data",
      data: readFileSync(png).toString("base64"),
    });

    for (const input of ["", "\n"]) {
      const alone = await run(args, input, { answers });
      expect(alone.exitCode).toBe(0);
      expect(alone.requests[0].stateParts).toHaveLength(1);
      expect(alone.requests[0].stateParts[0].type).toBe("file");
    }
  });

  test("--images keeps flag order after a JSON state and accepts data URLs", async () => {
    const answers = { q: { type: "boolean", probability: 0.5 } };
    const png = (byte: number) =>
      Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.from([byte]),
      ]);
    const first = join(directory, "first.png");
    writeFileSync(first, png(1));
    const second = `data:image/png;base64,${png(2).toString("base64")}`;
    const result = await run(
      ["--boolean", "q=Same order?", "-i", first, "--images", second],
      '{"ticket":"123"}',
      { answers }
    );
    expect(result.exitCode).toBe(0);
    expect(result.requests[0].stateParts).toEqual([
      { type: "json", value: { ticket: "123" } },
      {
        type: "file",
        mediaType: "image/png",
        data: { type: "data", data: png(1).toString("base64") },
      },
      {
        type: "file",
        mediaType: "image/png",
        data: { type: "data", data: png(2).toString("base64") },
      },
    ]);
  });

  test("accepts empty JSON arrays as shared state", async () => {
    const result = await run(["--boolean", "q=Any requests present?"], "[]", {
      answers: { q: { type: "boolean", probability: 0 } },
    });
    expect(result.exitCode).toBe(0);
    expect(result.requests[0].stateParts).toEqual([
      { type: "json", value: [] },
    ]);
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

  describe("gateway connection options", () => {
    const teamHeader = "x-vercel-ai-gateway-team";
    const ask = ["--boolean", "refund=Refund requested?"];
    const answers = { answers: { refund: mixedAnswers.refund } };

    test("--team-id-or-slug, --base-url, and --headers reach the decision request", async () => {
      const headers = join(directory, "headers.json");
      writeFileSync(headers, JSON.stringify({ "x-custom": "yes" }));
      const result = await run(
        [
          ...ask,
          "--team-id-or-slug",
          "flag-team",
          "--base-url",
          "https://custom.example/v4/ai",
          "--headers",
          headers,
        ],
        "text",
        answers
      );
      expect(result.exitCode).toBe(0);
      expect(result.meta).toHaveLength(1);
      expect(result.meta[0].url).toBe(
        "https://custom.example/v4/ai/decision-model"
      );
      expect(result.meta[0].headers[teamHeader]).toBe("flag-team");
      expect(result.meta[0].headers["x-custom"]).toBe("yes");
    });

    test("AI_GATEWAY_TEAM_ID_OR_SLUG and AI_GATEWAY_BASE_URL are honored", async () => {
      const result = await run(ask, "text", answers, {
        AI_GATEWAY_TEAM_ID_OR_SLUG: "env-team",
        AI_GATEWAY_BASE_URL: "https://env.example/v4/ai",
      });
      expect(result.exitCode).toBe(0);
      expect(result.meta[0].url).toBe(
        "https://env.example/v4/ai/decision-model"
      );
      expect(result.meta[0].headers[teamHeader]).toBe("env-team");
    });

    test("the flag wins over the environment", async () => {
      const result = await run(
        [...ask, "--team-id-or-slug", "flag-team"],
        "text",
        answers,
        { AI_GATEWAY_TEAM_ID_OR_SLUG: "env-team" }
      );
      expect(result.exitCode).toBe(0);
      expect(result.meta[0].headers[teamHeader]).toBe("flag-team");
    });

    test("--scope sets the team header", async () => {
      const result = await run(
        [...ask, "--scope", "scope-team"],
        "text",
        answers
      );
      expect(result.exitCode).toBe(0);
      expect(result.meta[0].headers[teamHeader]).toBe("scope-team");
    });

    test("--scope wins over --team-id-or-slug", async () => {
      const result = await run(
        [...ask, "--team-id-or-slug", "old-team", "--scope", "scope-team"],
        "text",
        answers
      );
      expect(result.exitCode).toBe(0);
      expect(result.meta[0].headers[teamHeader]).toBe("scope-team");
    });
  });
});

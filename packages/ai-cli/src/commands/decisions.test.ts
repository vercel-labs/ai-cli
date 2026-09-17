import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "ai-cli-decisions-"));
const preload = join(directory, "gateway.js");
writeFileSync(
  preload,
  [
    "globalThis.fetch = async (url) => {",
    "  if (!String(url).endsWith('/evaluation-model')) throw new Error('Unexpected network request');",
    "  const fixture = JSON.parse(process.env.TEST_EVALUATION_RESPONSE);",
    "  return new Response(JSON.stringify(fixture), { status: Number(process.env.TEST_EVALUATION_STATUS || 200), headers: { 'content-type': 'application/json' } });",
    "};",
    "if (process.env.TEST_STDOUT_TTY) process.stdout.isTTY = true;",
  ].join("\n")
);
afterAll(() => rmSync(directory, { recursive: true, force: true }));

async function run(
  args: string[],
  input: string,
  answers: Record<string, unknown> = {},
  extraEnv: Record<string, string> = {}
) {
  const proc = Bun.spawn(
    ["bun", "run", "--preload", preload, "src/index.ts", ...args],
    {
      cwd: import.meta.dir + "/../..",
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        AI_GATEWAY_API_KEY: "test-key",
        AI_CLI_EVALUATION_MODEL: "typesafe-ai/jev",
        TEST_EVALUATION_RESPONSE: JSON.stringify({
          answers,
          usage: { inputTokens: 20, outputTokens: 5 },
        }),
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
  return { stdout, stderr, exitCode };
}

describe("decision CLI output", () => {
  test("filter prints the selected source line even when stdout is a TTY", async () => {
    const result = await run(
      ["filter", "relevant"],
      "  original text  \nother\n",
      {
        record_1: { type: "boolean", probability: 0.99 },
        record_2: { type: "boolean", probability: 0.01 },
      },
      { TEST_STDOUT_TTY: "1" }
    );
    expect(result).toEqual({
      exitCode: 0,
      stdout: "  original text  \n",
      stderr: "",
    });
  });

  test("JSON record output composes across filter, rank, and pick", async () => {
    const input = '[{"id":10},{"id":20},{"id":30}]';
    const filtered = await run(["filter", "relevant"], input, {
      record_1: { type: "boolean", probability: 0.99 },
      record_2: { type: "boolean", probability: 0.01 },
      record_3: { type: "boolean", probability: 0.99 },
    });
    expect(filtered.exitCode).toBe(0);
    const ranked = await run(
      ["rank", "priority", "--top", "1"],
      filtered.stdout,
      {
        record_1: { type: "score", score: 1 },
        record_2: { type: "score", score: 4 },
      }
    );
    expect(ranked.exitCode).toBe(0);
    const picked = await run(["pick", "best"], ranked.stdout, {
      choice: {
        type: "choice",
        choice: "record_1",
        probabilities: { record_1: 1 },
      },
      exists: { type: "boolean", probability: 0.99 },
    });
    expect(picked.exitCode).toBe(0);
    expect(JSON.parse(picked.stdout)).toEqual([{ id: 30 }]);
  });

  test("metadata contains original records and useful stable indices", async () => {
    const result = await run(
      ["rank", "priority", "--top", "1", "--json"],
      "alpha\nbeta\n",
      {
        record_1: { type: "score", score: 1 },
        record_2: { type: "score", score: 4 },
      }
    );
    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output).toMatchObject({
      command: "rank",
      model: "typesafe-ai/jev",
      status: "ok",
      input_count: 2,
      count: 1,
      calls: 1,
      usage: { input_tokens: 20, output_tokens: 5 },
      results: [
        { index: 2, record: "beta", score: 4, selected: true },
        { index: 1, record: "alpha", score: 1, selected: false },
      ],
    });
    expect(output.elapsed_ms).toBeGreaterThanOrEqual(0);
    expect(result.stderr).toBe("");
  });

  test("uncertainty emits no partial records and has a distinct exit code", async () => {
    const result = await run(["filter", "relevant"], "alpha\nbeta\n", {
      record_1: { type: "boolean", probability: 1 },
      record_2: { type: "boolean", probability: 0.5 },
    });
    expect(result.exitCode).toBe(4);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("uncertain");
  });

  test("pick no-match remains inspectable in JSON mode", async () => {
    const result = await run(["pick", "relevant", "--json"], "alpha\n", {
      choice: {
        type: "choice",
        choice: "record_1",
        probabilities: { record_1: 1 },
      },
      exists: { type: "boolean", probability: 0 },
    });
    expect(result.exitCode).toBe(3);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: "no_match",
      count: 0,
    });
    expect(result.stderr).toContain("No matching record");
  });

  test("empty JSON collections compose without API calls", async () => {
    const filtered = await run(["filter", "relevant"], "[]");
    expect(filtered).toEqual({ exitCode: 0, stdout: "[]\n", stderr: "" });
    const picked = await run(["pick", "relevant", "--quiet"], filtered.stdout);
    expect(picked).toEqual({ exitCode: 3, stdout: "", stderr: "" });
  });

  test("malformed JSON and provider failures do not produce records", async () => {
    const malformed = await run(["filter", "relevant"], '[{"id":1}');
    expect(malformed.exitCode).toBe(1);
    expect(malformed.stdout).toBe("");
    expect(malformed.stderr).toContain("Invalid JSON");
    const rejected = await run(
      ["rank", "priority"],
      "alpha\n",
      {},
      {
        TEST_EVALUATION_STATUS: "403",
        TEST_EVALUATION_RESPONSE: JSON.stringify({
          error: "provider unavailable",
        }),
      }
    );
    expect(rejected.exitCode).toBe(1);
    expect(rejected.stdout).toBe("");
  });
});

import { describe, expect, test } from "vitest";

import { createProgram } from "../program.js";
import { mediaFixture } from "../test/media.js";
import {
  buildTools,
  EXCLUDED_COMMANDS,
  HIDDEN_OPTIONS,
  PROFILES,
  toolArgv,
  TOOL_OVERRIDES,
  toolResult,
} from "./mcp.js";

const fixture = mediaFixture();
const definition = createProgram().definition();
const tools = buildTools(definition);
const choice = { id: "pick", type: "choice", question: "Which?" };

function run(overrides: Partial<Parameters<typeof toolResult>[0]>) {
  return toolResult({
    code: 0,
    signal: null,
    stdout: "",
    stderr: "",
    timedOut: false,
    timeoutMs: 250,
    ...overrides,
  });
}

describe("toolArgv", () => {
  test("encodes typed inputs as CLI argv", () => {
    expect(
      toolArgv(tools, "text", {
        prompt: "hi",
        system: "--version",
        image: ["a.png", "b.png"],
      })
    ).toEqual({
      argv: [
        "text",
        "hi",
        "--json",
        "--image=a.png",
        "--image=b.png",
        "--system=--version",
      ],
    });
    expect(
      toolArgv(tools, "video_start", {
        output: "op.json",
        generateAudio: false,
      })
    ).toEqual({
      argv: ["video", "start", "--output=op.json", "--no-generate-audio"],
    });
  });

  test("encodes decide questions as flags and state as stdin", () => {
    expect(
      toolArgv(tools, "decide", {
        questions: [{ ...choice, choices: ["a", "b"] }],
        state: "x",
      })
    ).toEqual({
      argv: ["decide", "--choice=pick=Which?", "--choices=pick=a,b"],
      stdin: "x",
    });
    expect(
      toolArgv(tools, "decide", {
        questions: [{ id: "ok", type: "boolean", question: "Ok?" }],
        images: ["a.png", "b.png"],
      })
    ).toEqual({
      argv: ["decide", "--images=a.png", "--images=b.png", "--boolean=ok=Ok?"],
      stdin: "",
    });
  });

  test("rejects input the CLI would misread", () => {
    expect(toolArgv(tools, "text", { foo: 1 })).toEqual({
      error: expect.stringMatching(
        /^unknown argument 'foo' for text; valid: prompt, /
      ),
    });
    expect(toolArgv(tools, "text", { prompt: "-rf" })).toEqual({
      error: `argument 'prompt' must not start with "-"`,
    });
    expect(toolArgv(tools, "models", { extraArgs: "" })).toEqual({
      error: "argument 'extraArgs' must be an array of strings",
    });
    for (const output of [undefined, ""]) {
      expect(toolArgv(tools, "video_start", { output })).toEqual({
        error: "missing required argument 'output' for video_start",
      });
    }
    expect(
      toolArgv(tools, "decide", {
        questions: [{ ...choice, choices: ["a,b", "c"] }],
      })
    ).toHaveProperty("error");
    for (const extraArgs of [
      ["--base-url=https://attacker.test"],
      ["--seed", "1", "--base-url", "https://attacker.test"],
    ]) {
      expect(toolArgv(tools, "image", { prompt: "x", extraArgs })).toEqual({
        error:
          "extraArgs must not set --base-url; set it in the MCP server environment",
      });
    }
  });
});

test("every CLI command and option is mapped, hidden, or excluded", () => {
  const runnable: string[] = [];
  const visit = (command: typeof definition, path: string[]) => {
    if (command.runnable) runnable.push(path.join(" "));
    for (const child of command.commands) visit(child, [...path, child.name]);
  };
  visit(definition, []);
  const mapped = Object.values(TOOL_OVERRIDES).map(({ path }) =>
    path.join(" ")
  );
  expect(runnable.toSorted()).toEqual(
    [...mapped, ...Object.keys(EXCLUDED_COMMANDS)].toSorted()
  );

  for (const tool of tools) {
    const override = TOOL_OVERRIDES[tool.name]!;
    const command = override.path.reduce(
      (node, name) => node.commands.find((child) => child.name === name)!,
      definition
    );
    const hidden = [...HIDDEN_OPTIONS, ...(override.hiddenOptions ?? [])];
    for (const { name } of command.options) {
      expect(
        hidden.includes(name) || name in tool.inputSchema.properties,
        `${tool.name} drops --${name}`
      ).toBe(true);
    }
  }
});

describe("toolResult", () => {
  test("returns object JSON as structured content and arrays as text only", () => {
    expect(run({ stdout: ' {"count":2}\n' })).toEqual({
      content: [{ type: "text", text: '{"count":2}' }],
      structuredContent: { count: 2 },
    });
    expect(run({ stdout: "[1,2]" })).toEqual({
      content: [{ type: "text", text: "[1,2]" }],
    });
  });

  test("marks failures and keeps every diagnostic", () => {
    expect(run({ code: 1, stderr: "boom" })).toMatchObject({
      isError: true,
      content: [{ text: "boom" }],
    });
    expect(
      run({ code: 2, stdout: '{"success":false}', stderr: "provider failed" })
    ).toMatchObject({
      isError: true,
      content: [{ text: '{"success":false}\nprovider failed' }],
    });
    expect(run({ stdout: "not JSON" })).toMatchObject({ isError: true });
    expect(run({ code: 13 })).toMatchObject({
      isError: true,
      content: [{ text: "exited with code 13" }],
    });
    expect(run({ timedOut: true })).toMatchObject({
      isError: true,
      content: [{ text: "timed out after 250ms" }],
    });
  });
});

test("serves JSON-RPC over stdio and matches the plain CLI output", async () => {
  const requests = [
    { method: "initialize", id: 1 },
    { method: "notifications/initialized" },
    { method: "tools/list", id: 2 },
    {
      method: "tools/call",
      id: 3,
      params: { name: "models", arguments: {} },
    },
    {
      method: "tools/call",
      id: 4,
      params: { name: "video_start", arguments: { output: "op.json" } },
    },
    { method: "tools/call", id: 5, params: { name: "nope" } },
  ];
  const input =
    requests
      .map((request) => JSON.stringify({ jsonrpc: "2.0", ...request }) + "\n")
      .join("") +
    '{"jsonrpc":"1.0","id":6,"method":"ping"}\n' +
    '{"jsonrpc":"2.0","id":{"bad":true},"method":"ping"}\n';
  const [server, models] = await Promise.all([
    fixture.run(["mcp"], { built: true, input: Buffer.from(input) }),
    fixture.run(["models", "--json"], { built: true }),
  ]);
  const responses = new Map(
    server.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .map((response) => [response.id, response])
  );

  expect(server.exitCode).toBe(0);
  expect(responses.size).toBe(7);
  expect(responses.get(6).error.code).toBe(-32600);
  expect(responses.get(null).error.code).toBe(-32600);
  expect(
    responses.get(2).result.tools.map((tool: { name: string }) => tool.name)
  ).toEqual(PROFILES.core);
  expect(responses.get(3).result.content[0].text).toBe(models.stdout.trim());
  expect(responses.get(4).result).toMatchObject({
    isError: true,
    content: [{ text: expect.stringContaining("--profile media") }],
  });
  expect(responses.get(5).error.code).toBe(-32602);
});

test("kills a child that outlives its timeout", async () => {
  const call = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "models", arguments: { timeoutMs: 500 } },
  };
  const server = await fixture.run(["mcp"], {
    built: true,
    mode: "hang",
    input: Buffer.from(JSON.stringify(call) + "\n"),
  });

  expect(server.exitCode).toBe(0);
  expect(JSON.parse(server.stdout).result).toEqual({
    content: [{ type: "text", text: "timed out after 500ms" }],
    isError: true,
  });
});

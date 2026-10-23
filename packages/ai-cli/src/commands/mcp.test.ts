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

function getToolArgv(name: string, args: unknown) {
  const result = toolArgv(tools, name, args);
  if ("error" in result) throw new Error(result.error);
  return result;
}

function findCommand(path: string[]) {
  let current: typeof definition | undefined = definition;
  for (const name of path) {
    current = current?.commands.find((command) => command.name === name);
  }
  return current;
}

describe("MCP tool mappings", () => {
  test("profiles partition every unique ai_ tool", () => {
    const names = tools.map((tool) => tool.name);
    const profiles: string[][] = [PROFILES.core, PROFILES.media, PROFILES.all];

    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name.startsWith("ai_")).toBe(true);
      expect(profiles.some((profile) => profile.includes(name))).toBe(true);
    }
    expect(PROFILES.all.toSorted()).toEqual(names.toSorted());
    expect([...PROFILES.core, ...PROFILES.media].toSorted()).toEqual(
      names.toSorted()
    );
    expect(
      PROFILES.core.some((name: string) => PROFILES.media.includes(name))
    ).toBe(false);
  });

  test("maps text and decide inputs to argv and stdin", () => {
    const text = getToolArgv("ai_text", {
      prompt: "hi",
      model: "openai/gpt-5.5",
    });
    expect(text.argv).toEqual([
      "text",
      "hi",
      "--json",
      "--model=openai/gpt-5.5",
    ]);
    expect(text.stdin).toBeUndefined();

    const textTool = tools.find((tool) => tool.name === "ai_text");
    const imageTool = tools.find((tool) => tool.name === "ai_image");
    expect(textTool?.inputSchema.properties).toHaveProperty("image");
    expect(textTool?.inputSchema.properties).not.toHaveProperty("images");
    expect(imageTool?.inputSchema.properties).toHaveProperty("images");

    const textImages = getToolArgv("ai_text", { image: ["a.png", "b.png"] });
    expect(textImages.argv).toContain("--image=a.png");
    expect(textImages.argv).toContain("--image=b.png");

    const withState = getToolArgv("ai_decide", {
      questions: [
        {
          id: "pick",
          type: "choice",
          question: "Which one?",
          choices: ["a", "b"],
        },
      ],
      state: "x",
    });
    expect(withState.argv).toContain("--choice=pick=Which one?");
    expect(withState.argv).toContain("--choices=pick=a,b");
    expect(withState.argv).not.toContain("--json");
    expect(withState.stdin).toBe("x");
    expect(
      getToolArgv("ai_decide", {
        questions: [
          {
            id: "pick",
            type: "choice",
            question: "Which one?",
            choices: ["a", "b"],
          },
        ],
      }).stdin
    ).toBe("");
  });

  test("maps video status and boolean flags", () => {
    expect(
      getToolArgv("ai_video_status", {
        operationFile: "op.json",
        download: true,
      }).argv
    ).toEqual(["video", "status", "op.json", "--download"]);
    expect(
      getToolArgv("ai_video_status", {
        operationFile: "op.json",
        download: false,
      }).argv
    ).not.toContain("--download");

    expect(
      getToolArgv("ai_video_start", {
        output: "out.mp4",
        generateAudio: false,
      }).argv
    ).toContain("--no-generate-audio");
  });

  test("validates unknown arguments, positional values, and required inputs", () => {
    const unknown = toolArgv(tools, "ai_text", { foo: 1 });
    expect("error" in unknown).toBe(true);
    if ("error" in unknown) {
      const prefix = "unknown argument 'foo' for ai_text; valid: ";
      expect(unknown.error.startsWith(prefix)).toBe(true);
      expect(unknown.error.slice(prefix.length).split(", ")).toEqual(
        expect.arrayContaining([
          "prompt",
          "model",
          "cwd",
          "extraArgs",
          "timeoutMs",
        ])
      );
    }
    expect(toolArgv(tools, "ai_text", { prompt: "-rf" })).toMatchObject({
      error: expect.stringContaining("argument 'prompt'"),
    });
    expect(toolArgv(tools, "ai_video_start", { prompt: "x" })).toEqual({
      error: "missing required argument 'output' for ai_video_start",
    });

    const invalidChoice = toolArgv(tools, "ai_decide", {
      questions: [
        {
          id: "pick",
          type: "choice",
          question: "Which one?",
          choices: ["a,b", "c"],
        },
      ],
    });
    expect("error" in invalidChoice).toBe(true);
  });

  test("encodes flag-like values as typed flag values", () => {
    expect(getToolArgv("ai_text", { system: "--version" }).argv).toContain(
      "--system=--version"
    );
  });

  test("keeps generated tools in sync with the command tree", () => {
    const leaves = new Set<string>();
    const paths = new Set<string>();
    const visit = (command: typeof definition, parentPath: string[] = []) => {
      const path =
        command === definition ? parentPath : [...parentPath, command.name];
      const key = path.join(" ");
      paths.add(key);
      if (command.commands.length === 0) leaves.add(key);
      for (const child of command.commands) visit(child, path);
    };
    visit(definition);

    const overrides = Object.entries(TOOL_OVERRIDES);
    const overridePaths = overrides.map(([, override]) =>
      override.path.join(" ")
    );
    const excludedPaths = Object.keys(EXCLUDED_COMMANDS);
    const mappedOrExcluded = [...overridePaths, ...excludedPaths];

    expect(tools.map((tool) => tool.name).toSorted()).toEqual(
      Object.keys(TOOL_OVERRIDES).toSorted()
    );
    for (const path of leaves) {
      expect(mappedOrExcluded).toContain(path);
    }
    for (const path of mappedOrExcluded) {
      expect(paths).toContain(path);
    }

    const hiddenOptions = new Set(HIDDEN_OPTIONS);
    const replacedDecideOptions = new Set([
      "boolean",
      "choice",
      "choices",
      "score",
      "levels",
    ]);
    for (const [name, override] of overrides) {
      const command = findCommand(override.path);
      const tool = tools.find((candidate) => candidate.name === name);
      expect(command).toBeDefined();
      expect(tool).toBeDefined();
      if (!command || !tool) continue;

      const inputs = new Set(Object.keys(tool.inputSchema.properties));
      for (const option of command.options) {
        expect(
          inputs.has(option.name) ||
            hiddenOptions.has(option.name) ||
            (name === "ai_decide" && replacedDecideOptions.has(option.name))
        ).toBe(true);
      }
    }

    expect(
      tools.every((tool) => !("quiet" in tool.inputSchema.properties))
    ).toBe(true);
  });
});

describe("MCP tool results", () => {
  test("returns parsed object results and omits structured content for arrays", () => {
    const object = { success: true, count: 2 };
    const objectResult = toolResult({
      code: 0,
      signal: null,
      stdout: ` ${JSON.stringify(object)}\n`,
      stderr: "",
      timedOut: false,
      timeoutMs: 100,
    });
    expect(objectResult.isError).toBeFalsy();
    expect(objectResult.structuredContent).toEqual(object);
    expect(objectResult.content[0].text).toBe(JSON.stringify(object));

    const arrayResult = toolResult({
      code: 0,
      signal: null,
      stdout: "[1,2]",
      stderr: "",
      timedOut: false,
      timeoutMs: 100,
    });
    expect(arrayResult.isError).toBeFalsy();
    expect(arrayResult).not.toHaveProperty("structuredContent");
  });

  test("reports process, JSON, and timeout failures", () => {
    const stderrFailure = toolResult({
      code: 1,
      signal: null,
      stdout: "",
      stderr: "boom",
      timedOut: false,
      timeoutMs: 100,
    });
    expect(stderrFailure.isError).toBe(true);
    expect(stderrFailure.content[0].text).toContain("boom");

    const manifest = '{"success":false,"error":"failed"}';
    const manifestFailure = toolResult({
      code: 2,
      signal: null,
      stdout: manifest,
      stderr: "provider failed",
      timedOut: false,
      timeoutMs: 100,
    });
    expect(manifestFailure.isError).toBe(true);
    expect(manifestFailure.content[0].text).toContain(manifest);
    expect(manifestFailure.content[0].text).toContain("provider failed");

    expect(
      toolResult({
        code: 0,
        signal: null,
        stdout: "not JSON",
        stderr: "",
        timedOut: false,
        timeoutMs: 100,
      }).isError
    ).toBe(true);

    const timeout = toolResult({
      code: 0,
      signal: null,
      stdout: "",
      stderr: "",
      timedOut: true,
      timeoutMs: 250,
    });
    expect(timeout.isError).toBe(true);
    expect(timeout.content[0].text).toContain("timed out after 250ms");
  });
});

describe("MCP server", () => {
  test("serves core tools and dispatches calls over JSON-RPC", async () => {
    const messages = [
      { jsonrpc: "2.0", method: "initialize", id: 1 },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", method: "tools/list", id: 2 },
      {
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "ai_models", arguments: {} },
        id: 3,
      },
      {
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "ai_video_start",
          arguments: { prompt: "x", output: "op.json" },
        },
        id: 4,
      },
      {
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "nope", arguments: {} },
        id: 5,
      },
    ];
    const [server, models] = await Promise.all([
      fixture.run(["mcp"], {
        built: true,
        input: Buffer.from(
          `${messages.map((message) => JSON.stringify(message)).join("\n")}\n`
        ),
      }),
      fixture.run(["models", "--json"], { built: true }),
    ]);
    const lines = server.stdout.endsWith("\n")
      ? server.stdout.slice(0, -1).split("\n")
      : server.stdout.split("\n");
    const responses = lines.map((line) => JSON.parse(line));
    const byId = new Map(responses.map((response) => [response.id, response]));
    const listedTools = byId.get(2).result.tools;

    expect(responses).toHaveLength(5);
    expect(server.exitCode).toBe(0);
    expect(
      listedTools.map((tool: { name: string }) => tool.name).toSorted()
    ).toEqual(PROFILES.core.toSorted());
    expect(byId.get(3).result.content[0].text).toBe(models.stdout.trim());
    expect(byId.get(4).result.isError).toBe(true);
    expect(byId.get(4).result.content[0].text).toContain("--profile media");
    expect(byId.get(5).error.code).toBe(-32602);
  });
});

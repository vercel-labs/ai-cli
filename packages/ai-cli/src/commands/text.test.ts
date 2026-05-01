import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { Command } from "commander";

const generateTextMock = mock(async () => ({ text: "buffered text" }));
const streamTextMock = mock(() => ({
  textStream: (async function* () {
    yield "Hello, ";
    yield "world";
    yield "!";
  })(),
}));
const gatewayMock = Object.assign(
  mock((modelId: string) => modelId),
  {
    getAvailableModels: mock(async () => ({ models: [] })),
  }
);

mock.module("ai", () => ({
  generateText: generateTextMock,
  gateway: gatewayMock,
  streamText: streamTextMock,
}));

const { registerTextCommand } = await import("./text.js");

function captureWrites(stream: typeof process.stdout | typeof process.stderr) {
  const originalWrite = stream.write;
  let output = "";
  stream.write = ((chunk: unknown) => {
    output += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    return true;
  }) as typeof stream.write;

  return {
    output: () => output,
    restore: () => {
      stream.write = originalWrite;
    },
  };
}

async function runTextCommand(args: string[]) {
  const program = new Command();
  program.exitOverride();
  registerTextCommand(program);
  await program.parseAsync(["node", "ai", ...args], { from: "node" });
}

describe("text command", () => {
  const originalStdoutIsTTY = process.stdout.isTTY;
  const originalStdinIsTTY = process.stdin.isTTY;
  const originalOutputDir = process.env.AI_CLI_OUTPUT_DIR;

  beforeEach(() => {
    generateTextMock.mockClear();
    streamTextMock.mockClear();
    gatewayMock.mockClear();
    delete process.env.AI_CLI_OUTPUT_DIR;
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: originalStdoutIsTTY,
    });
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: originalStdinIsTTY,
    });
    if (originalOutputDir === undefined) {
      delete process.env.AI_CLI_OUTPUT_DIR;
    } else {
      process.env.AI_CLI_OUTPUT_DIR = originalOutputDir;
    }
  });

  test("streams single-model interactive text to stdout", async () => {
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });
    const stdout = captureWrites(process.stdout);
    const stderr = captureWrites(process.stderr);

    try {
      await runTextCommand(["text", "-m", "openai/gpt-4.1-mini", "say hello"]);
    } finally {
      stdout.restore();
      stderr.restore();
    }

    expect(streamTextMock).toHaveBeenCalledTimes(1);
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(stdout.output()).toBe("Hello, world!");
    expect(stderr.output()).toContain(
      "Generated text with openai/gpt-4.1-mini"
    );
  });

  test("keeps json output on the buffered path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ai-cli-text-"));
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });
    const stdout = captureWrites(process.stdout);
    const stderr = captureWrites(process.stderr);

    try {
      await runTextCommand([
        "text",
        "-m",
        "openai/gpt-4.1-mini",
        "--json",
        "--output",
        join(dir, "out.md"),
        "say hello",
      ]);
    } finally {
      stdout.restore();
      stderr.restore();
      rmSync(dir, { recursive: true, force: true });
    }

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(streamTextMock).not.toHaveBeenCalled();
    expect(stdout.output()).toContain('"success": true');
    expect(stderr.output()).not.toContain("Hello, world!");
  });
});

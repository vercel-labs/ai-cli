import { describe, expect, test } from "bun:test";

import pkg from "../package.json";

const CLI = ["bun", "run", "src/index.ts"];
const ROOT = import.meta.dir + "/..";

async function run(...args: string[]) {
  const proc = Bun.spawn([...CLI, ...args], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}

describe("cli integration", () => {
  test("published bin targets built JavaScript", () => {
    expect(pkg.bin.ai).toBe("./dist/index.js");
    expect(pkg.files).toContain("dist");
    expect(pkg.files).not.toContain("src");
    expect(pkg.dependencies).not.toHaveProperty("commander");
  });

  test("--help exits 0 and lists subcommands", async () => {
    const { exitCode, stdout } = await run("--help");
    expect(exitCode).toBe(0);
    for (const sub of [
      "text",
      "image",
      "video",
      "audio",
      "models",
      "filter",
      "rank",
      "pick",
    ]) {
      expect(stdout).toContain(sub);
    }
  });

  test("--version exits 0 and prints semver", async () => {
    const { exitCode, stdout } = await run("--version");
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("--version works after a nested subcommand", async () => {
    const { exitCode, stdout } = await run("audio", "speak", "--version");
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe(pkg.version);
  });

  test("--version remains global when a nested option expects a value", async () => {
    const { exitCode, stdout } = await run(
      "audio",
      "speak",
      "--voice",
      "--version"
    );
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe(pkg.version);
  });

  test("help command displays subcommand help", async () => {
    const { exitCode, stdout } = await run("help", "text");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Usage: ai text");
    expect(stdout).toContain("--model");
  });

  test("nested help command displays nested subcommand help", async () => {
    const { exitCode, stdout } = await run("audio", "help", "speak");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Usage: ai audio speak");
    expect(stdout).toContain("--voice");
  });

  test("help options work on implicit help commands", async () => {
    const root = await run("help", "--help");
    expect(root.exitCode).toBe(0);
    expect(root.stdout).toContain("Usage: ai [options] [command]");

    const nested = await run("audio", "help", "--help");
    expect(nested.exitCode).toBe(0);
    expect(nested.stdout).toContain("Usage: ai audio [options] [command]");
  });

  test("help options preserve implicit help command targets", async () => {
    const root = await run("help", "text", "--help");
    expect(root.exitCode).toBe(0);
    expect(root.stdout).toContain("Usage: ai text [options] [prompt]");

    const nested = await run("audio", "help", "speak", "--help");
    expect(nested.exitCode).toBe(0);
    expect(nested.stdout).toContain("Usage: ai audio speak [options] [text]");
  });

  test("help takes precedence over an unknown command", async () => {
    const { exitCode, stdout, stderr } = await run("wat", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Usage: ai [options] [command]");
    expect(stderr).toBe("");
  });

  test("unknown options fail before running a command", async () => {
    const { exitCode, stderr } = await run("text", "--wat", "hello");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("unknown option '--wat'");
  });

  test("unknown commands and options include typo suggestions", async () => {
    const command = await run("texte");
    expect(command.exitCode).toBe(1);
    expect(command.stderr).toContain("(Did you mean text?)");

    const option = await run("text", "--modle", "openai/gpt-5.5");
    expect(option.exitCode).toBe(1);
    expect(option.stderr).toContain("(Did you mean --model?)");
  });

  test("missing option values produce a usage error", async () => {
    const { exitCode, stderr } = await run("text", "--model");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("argument missing");
  });

  test("missing option values take precedence over help", async () => {
    const { exitCode, stdout, stderr } = await run("text", "hello", "-h", "-m");
    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("option '-m, --model <model>' argument missing");
  });

  test("text with no prompt and no stdin exits 1", async () => {
    const { exitCode, stderr } = await run("text");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("prompt, stdin, or image is required");
  });

  test("text --help exits 0 and lists flags", async () => {
    const { exitCode, stdout } = await run("text", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("--model");
    expect(stdout).toContain("--format");
    expect(stdout).toContain("--image");
    expect(stdout).toContain("(default: [])");
    expect(stdout).toContain("--temperature");
    expect(
      Math.max(
        ...stdout
          .trimEnd()
          .split("\n")
          .map((line) => line.length)
      )
    ).toBeLessThanOrEqual(80);
  });

  test("text grouped short options support the help flag", async () => {
    const { exitCode, stdout, stderr } = await run("text", "-qh");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Usage: ai text [options] [prompt]");
    expect(stderr).toBe("");
  });

  test("image --help exits 0 and lists flags", async () => {
    const { exitCode, stdout } = await run("image", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("--no-preview");
    expect(stdout).toContain("--image");
    expect(stdout).toContain("--size");
    expect(stdout).toContain("--aspect-ratio");
  });

  test("video --help exits 0 and lists flags", async () => {
    const { exitCode, stdout } = await run("video", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("--image");
    expect(stdout).toContain("--duration");
    expect(stdout).toContain("--aspect-ratio");
    expect(stdout).toContain("--resolution");
  });

  test("audio --help exits 0 and lists subcommands", async () => {
    const { exitCode, stdout } = await run("audio", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("speak");
    expect(stdout).toContain("transcribe");
  });

  test("root help keeps nested command signatures compatible", async () => {
    const { stdout } = await run("--help");
    const audio = stdout
      .split("\n")
      .find((line) => line.trimStart().startsWith("audio"));
    expect(audio).toBeDefined();
    expect(audio).not.toContain("[options]");
    expect(audio).not.toContain("[command]");
  });

  test("audio speak --help exits 0 and lists flags", async () => {
    const { exitCode, stdout } = await run("audio", "speak", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("--voice");
    expect(stdout).toContain("--format");
    expect(stdout).toContain("default: mp3");
    expect(stdout).toContain("--speed");
    expect(stdout).toContain("--no-play");
    expect(stdout).toContain("--no-waveform");
  });

  test("audio transcribe --help exits 0 and lists flags", async () => {
    const { exitCode, stdout } = await run("audio", "transcribe", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("--model");
    expect(stdout).toContain("--format");
    expect(stdout).toContain("--output");
  });

  test.each([
    [["text"], "120"],
    [["image"], "300"],
    [["video"], "300"],
    [["audio", "speak"], "120"],
    [["audio", "transcribe"], "120"],
  ])("%s --help lists --timeout with its default", async (command, seconds) => {
    const { exitCode, stdout } = await run(...command, "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("--timeout");
    expect(stdout).toContain(`default: ${seconds}`);
  });

  test("--timeout rejects a value that would overflow the timer", async () => {
    const { exitCode, stderr } = await run(
      "image",
      "--timeout",
      "3600000",
      "a prompt"
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("The value is in seconds, not milliseconds.");
  });

  test("audio speak with no text and no stdin exits 1", async () => {
    const { exitCode, stderr } = await run("audio", "speak");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("text or stdin is required");
  });

  test("audio transcribe with no audio and no stdin exits 1", async () => {
    const { exitCode, stderr } = await run("audio", "transcribe");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("audio file, URL, or stdin is required");
  });

  test("video -i validates image paths before generation", async () => {
    const { exitCode, stderr } = await run(
      "video",
      "-i",
      "/missing/ref.png",
      "animate this"
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain(
      'could not read reference image "/missing/ref.png"'
    );
  });

  test("models --type invalid exits 1", async () => {
    const { exitCode, stderr } = await run("models", "--type", "realtime");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("must be one of");
  });

  test("models --help documents the model argument", async () => {
    const { exitCode, stdout } = await run("models", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("[model]");
    expect(stdout).toContain("detailed info");
    expect(stdout).toContain("evaluation");
  });

  test.each(["filter", "rank", "pick"])(
    "%s documents its record interface",
    async (command) => {
      const { exitCode, stdout } = await run(command, "--help");
      expect(exitCode).toBe(0);
      expect(stdout).toContain("<criterion>");
      expect(stdout).toContain("--context");
      expect(stdout).toContain("--input");
      expect(stdout).toContain("--json");
      expect(stdout).toContain("typesafe-ai/jev");
      expect(stdout).not.toContain("--count");
    }
  );

  test.each(["filter", "rank", "pick"])(
    "%s requires a criterion",
    async (command) => {
      const result = await run(command);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("criterion is required");
    }
  );

  test("decision flags reject invalid values before requesting a model", async () => {
    for (const args of [
      ["filter", "bug", "--threshold", "0.5"],
      ["filter", "bug", "--on-uncertain", "guess"],
      ["rank", "bug", "--top", "0"],
      ["pick", "bug", "--input", "yaml"],
      ["filter", "bug", "-m", "typesafe-ai/jev,typesafe-ai/jev"],
    ]) {
      expect((await run(...args)).exitCode).toBe(1);
    }
  });

  test("models with unknown model exits 1", async () => {
    const { exitCode, stderr } = await run("models", "no-such/model-xyz");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("model not found: no-such/model-xyz");
  });

  test("models rejects filters combined with a model argument", async () => {
    const { exitCode, stderr } = await run(
      "models",
      "openai/gpt-5.5",
      "--type",
      "text"
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("cannot be used with a model argument");
  });
});

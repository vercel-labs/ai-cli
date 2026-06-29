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
  });

  test("--help exits 0 and lists subcommands", async () => {
    const { exitCode, stdout } = await run("--help");
    expect(exitCode).toBe(0);
    for (const sub of ["text", "image", "video", "audio", "models"]) {
      expect(stdout).toContain(sub);
    }
  });

  test("--version exits 0 and prints semver", async () => {
    const { exitCode, stdout } = await run("--version");
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
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
    expect(stdout).toContain("--temperature");
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
  });

  test("audio --help exits 0 and lists subcommands", async () => {
    const { exitCode, stdout } = await run("audio", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("speak");
    expect(stdout).toContain("transcribe");
  });

  test("audio speak --help exits 0 and lists flags", async () => {
    const { exitCode, stdout } = await run("audio", "speak", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("--voice");
    expect(stdout).toContain("--format");
    expect(stdout).toContain("--speed");
  });

  test("audio transcribe --help exits 0 and lists flags", async () => {
    const { exitCode, stdout } = await run("audio", "transcribe", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("--model");
    expect(stdout).toContain("--format");
    expect(stdout).toContain("--output");
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
});

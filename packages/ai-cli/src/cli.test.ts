import { describe, expect, test } from "bun:test";

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
  test("--help exits 0 and lists subcommands", async () => {
    const { exitCode, stdout } = await run("--help");
    expect(exitCode).toBe(0);
    for (const sub of ["text", "image", "video", "models", "completions"]) {
      expect(stdout).toContain(sub);
    }
  });

  test("--version exits 0 and prints semver", async () => {
    const { exitCode, stdout } = await run("--version");
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("completions zsh exits 0 with valid output", async () => {
    const { exitCode, stdout } = await run("completions", "zsh");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("#compdef ai");
    expect(stdout).toContain("--no-preview");
  });

  test("completions bash exits 0 with valid output", async () => {
    const { exitCode, stdout } = await run("completions", "bash");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("complete -F");
  });

  test("completions fish exits 0 with valid output", async () => {
    const { exitCode, stdout } = await run("completions", "fish");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("complete -c ai");
  });

  test("completions with invalid shell exits 1", async () => {
    const { exitCode, stderr } = await run("completions", "powershell");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Unknown shell");
  });

  test("text with no prompt and no stdin exits 1", async () => {
    const { exitCode, stderr } = await run("text");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("prompt is required");
  });

  test("text --help exits 0 and lists flags", async () => {
    const { exitCode, stdout } = await run("text", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("--model");
    expect(stdout).toContain("--format");
    expect(stdout).toContain("--temperature");
  });

  test("image --help exits 0 and lists flags", async () => {
    const { exitCode, stdout } = await run("image", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("--no-preview");
    expect(stdout).toContain("--size");
    expect(stdout).toContain("--aspect-ratio");
    expect(stdout).toContain("--seed");
  });

  test("image --seed with non-numeric value exits 1", async () => {
    const { exitCode, stderr } = await run("image", "--seed", "abc", "x");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("--seed must be a positive integer");
  });

  test("video --help exits 0 and lists flags", async () => {
    const { exitCode, stdout } = await run("video", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("--duration");
    expect(stdout).toContain("--aspect-ratio");
  });

  test("models --type invalid exits 1", async () => {
    const { exitCode, stderr } = await run("models", "--type", "audio");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("must be one of");
  });
});

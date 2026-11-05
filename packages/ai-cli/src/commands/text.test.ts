import { describe, expect, test } from "vitest";

import { runNode } from "../test/process.js";

const cwd = import.meta.dirname + "/../..";
const run = (...args: string[]) =>
  runNode(["--import", "tsx", "src/index.ts", ...args], { cwd });

describe("command help and format errors", () => {
  test.each([
    ["text"],
    ["image"],
    ["video"],
    ["video", "start"],
    ["video", "status"],
    ["audio", "speak"],
    ["audio", "transcribe"],
    ["decide"],
  ])(
    "%s help shows guidance and hides the deprecated team flag",
    async (...path) => {
      const result = await run(...path, "--help");
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      if (path.join(" ") !== "video")
        expect(result.stdout).toContain("Examples:");
      expect(result.stdout).not.toContain("--team-id-or-slug");
      if (path.at(-1) !== "status") expect(result.stdout).toContain("Notes:");
    }
  );

  test("text format json suggests the json flag", async () => {
    const result = await run("text", "hello", "--format", "json");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Use --json for machine-readable output.");
    expect(result.stdout).toBe("");
  });

  test("other invalid text formats do not suggest the json flag", async () => {
    const result = await run("text", "hello", "--format", "html");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).not.toContain("Use --json");
  });
});

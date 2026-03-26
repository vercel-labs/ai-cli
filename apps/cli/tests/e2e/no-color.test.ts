/**
 * E2E tests for NO_COLOR / --no-color support.
 * These require a valid API key and network access — do NOT run in CI.
 *
 *   AI_GATEWAY_API_KEY=<key> bun test tests/e2e/
 */
import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import * as path from "node:path";

const CLI = path.resolve(import.meta.dirname, "../../dist/ai.mjs");

/** ANSI escape code pattern (colors, bold, dim, etc — not cursor control) */
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape detection requires literal ESC byte
const ANSI_COLOR = /\x1B\[\d{1,3}m/;

function run(
	args: string[],
	opts: { env?: Record<string, string>; stdin?: string } = {},
): Promise<{ stdout: string; stderr: string; code: number | null }> {
	return new Promise((resolve) => {
		const env = { ...process.env, ...opts.env };
		const child = spawn(process.execPath, [CLI, ...args], {
			env,
			stdio: ["pipe", "pipe", "pipe"],
		});

		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		child.stdout.on("data", (d) => stdout.push(d));
		child.stderr.on("data", (d) => stderr.push(d));

		if (opts.stdin !== undefined) {
			child.stdin.write(opts.stdin);
			child.stdin.end();
		}

		child.on("close", (code) => {
			resolve({
				stdout: Buffer.concat(stdout).toString(),
				stderr: Buffer.concat(stderr).toString(),
				code,
			});
		});
	});
}

describe("--no-color flag", () => {
	test("piped output has no ANSI color codes", async () => {
		const { stdout } = await run([
			"--no-color",
			"what is 2+2? answer with just the number",
		]);
		expect(stdout).not.toMatch(ANSI_COLOR);
		expect(stdout).toContain("4");
	}, 30_000);

	test("--help output has no ANSI when --no-color is set", async () => {
		const { stdout } = await run(["--no-color", "--help"]);
		expect(stdout).not.toMatch(ANSI_COLOR);
	});
});

describe("NO_COLOR env var", () => {
	test("piped output has no ANSI color codes", async () => {
		const { stdout } = await run(["what is 2+2? answer with just the number"], {
			env: { NO_COLOR: "1" },
		});
		expect(stdout).not.toMatch(ANSI_COLOR);
		expect(stdout).toContain("4");
	}, 30_000);
});

describe("color enabled by default", () => {
	test("piped output may contain response text", async () => {
		// When piped (no TTY), the chat command outputs plain text anyway.
		// This test just ensures the CLI runs successfully without --no-color.
		const { stdout, code } = await run([
			"what is 2+2? answer with just the number",
		]);
		expect(code).toBe(0);
		expect(stdout).toContain("4");
	}, 30_000);
});

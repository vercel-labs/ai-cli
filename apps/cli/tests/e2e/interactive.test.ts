/**
 * Interactive e2e tests using Bun.Terminal + @xterm/headless.
 *
 * These run the CLI in a real PTY and assert on the final rendered
 * terminal state — confirming that erased confirm prompts, spacing,
 * and tool results look correct to the user.
 *
 * Requires: API key configured, CLI built (`bun run build`).
 * Do NOT run in CI at this time.
 *
 *   bun test tests/e2e/interactive.test.ts
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { spawnCli } from "./pty-helpers";
import type { SpawnedCli } from "./pty-helpers";

let cli: SpawnedCli | null = null;

afterEach(() => {
	cli?.kill();
	cli = null;
});

/** Count consecutive blank lines immediately after the line containing `pattern`. */
function blankLinesAfter(screen: string, pattern: string): number {
	const lines = screen.split("\n");
	let idx = -1;
	for (let i = lines.length - 1; i >= 0; i--) {
		if (lines[i].includes(pattern)) {
			idx = i;
			break;
		}
	}
	if (idx < 0) {
		return -1;
	}
	let count = 0;
	for (let j = idx + 1; j < lines.length && lines[j].trim() === ""; j++) {
		count++;
	}
	return count;
}

// ---------------------------------------------------------------

describe("interactive spacing", () => {
	test("single blank line between prompt and text response", async () => {
		cli = spawnCli();
		await cli.waitFor("type /help");
		cli.write("respond with just the word pong\r");
		await cli.waitFor("pong");
		await new Promise((r) => setTimeout(r, 500));

		const screen = cli.getScreen();
		expect(screen).toContain("pong");
		expect(blankLinesAfter(screen, "respond with just the word pong")).toBe(1);
	}, 60_000);
});

describe("run confirm erased", () => {
	test("Run: header is erased after acceptance, only Ran remains", async () => {
		cli = spawnCli();
		await cli.waitFor("type /help");
		cli.write("run pwd\r");
		// Wait for the full confirm dialog (options line) before pressing 'y'
		await cli.waitFor("always");
		cli.write("y");
		await cli.waitFor("Ran");
		await new Promise((r) => setTimeout(r, 500));

		const screen = cli.getScreen();
		expect(screen).toContain("Ran");
		expect(screen).not.toContain("Run:");
		expect(blankLinesAfter(screen, "run pwd")).toBe(1);
	}, 60_000);
});

describe("edit confirm erased", () => {
	test("Edit header is erased after acceptance, only Edited remains", async () => {
		const dir = join(tmpdir(), `ai-cli-test-${Date.now()}`);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "test.json"), '{"name":"test"}');

		try {
			cli = spawnCli([], { cwd: dir });
			await cli.waitFor("type /help");
			cli.write("change the name field to hello in test.json\r");
			// Wait for the full confirm dialog (options line) before pressing 'y'
			await cli.waitFor("always");
			cli.write("y");
			await cli.waitFor("Edited");
			await new Promise((r) => setTimeout(r, 500));

			const screen = cli.getScreen();
			expect(screen).toContain("Edited");
			expect(screen).not.toContain("Edit test.json?");
			expect(blankLinesAfter(screen, "change the name")).toBe(1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}, 90_000);
});

describe("status spacing", () => {
	test("single blank line between user message and running status", async () => {
		cli = spawnCli([], { env: { AI_CLI_TEST_SCENARIO: "spacing-running" } });
		await cli.waitFor("type /help");
		cli.write("install deps\r");
		await cli.waitFor("Running cd blog && npm install");
		await new Promise((r) => setTimeout(r, 150));

		const screen = cli.getScreen();
		expect(blankLinesAfter(screen, "install deps")).toBe(1);
	}, 90_000);
});

describe("assistant text spacing", () => {
	test("single blank line before assistant text even with leading newlines", async () => {
		cli = spawnCli([], {
			env: { AI_CLI_TEST_SCENARIO: "spacing-leading-newlines" },
		});
		await cli.waitFor("type /help");
		cli.write("delete node mods\r");
		await cli.waitFor(
			"There is no node_modules directory visible in the project.",
		);
		await new Promise((r) => setTimeout(r, 150));

		const screen = cli.getScreen();
		expect(blankLinesAfter(screen, "delete node mods")).toBe(1);
	}, 90_000);
});

describe("multi-turn spacing sequence", () => {
	test("keeps one blank line between each visible message block", async () => {
		cli = spawnCli([], { env: { AI_CLI_TEST_SCENARIO: "spacing-sequence" } });
		await cli.waitFor("type /help");

		cli.write("delete node mods in blog folder\r");
		await cli.waitFor("No node_modules directory found in the blog folder.");

		cli.write("install node mods\r");
		await cli.waitFor("Running cd blog && npm install");
		await new Promise((r) => setTimeout(r, 150));

		const screen = cli.getScreen();
		expect(blankLinesAfter(screen, "delete node mods in blog folder")).toBe(1);
		expect(blankLinesAfter(screen, "error: not found: blog/node_modules")).toBe(
			1,
		);
		expect(blankLinesAfter(screen, "install node mods")).toBe(1);
	}, 90_000);
});

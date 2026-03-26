/**
 * Eval: Build then fix (multi-turn).
 *
 * Turn 1 asks the agent to create a string utility module with tests.
 * Turn 2 reports a bug and asks the agent to investigate and fix it.
 * Validates that the agent can debug its own prior output when given
 * a follow-up report across conversation turns.
 *
 * Requires: AI_GATEWAY_API_KEY set, CLI built, network access.
 *
 *   AI_GATEWAY_API_KEY=<key> bun test tests/evals/build-then-fix.test.ts
 */
import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import {
	assertAnyFileContains,
	assertCommandSucceeds,
	cleanupChat,
	cleanupWorkDir,
	createWorkDir,
	runMultiTurnEval,
} from "./eval-helpers";
import type { MultiTurnEvalResult } from "./eval-helpers";

const TIMEOUT = 900_000;
const CLI_TIMEOUT = 300;

let workDir: string | null = null;
let chatId: string | undefined;

afterEach(() => {
	if (chatId) {
		cleanupChat(chatId);
		chatId = undefined;
	}
	if (workDir) {
		cleanupWorkDir(workDir);
		workDir = null;
	}
});

describe("eval: build then fix (multi-turn)", () => {
	test(
		"creates string utils with tests, then fixes a reported bug",
		async () => {
			workDir = createWorkDir();

			const result: MultiTurnEvalResult = await runMultiTurnEval(
				[
					{
						prompt:
							"Create a TypeScript string utility module with capitalize, reverse, and isPalindrome functions. Write tests using Vitest. Make sure all tests pass.",
						check: (r, _i) => {
							expect(r.json.exitCode).toBe(0);
							assertAnyFileContains(r.workDir, ["ts"], "capitalize");
							assertAnyFileContains(r.workDir, ["ts"], "isPalindrome");
							assertCommandSucceeds(r.workDir, "npm test");
						},
					},
					{
						prompt:
							'Users are reporting that isPalindrome("racecar") works but isPalindrome("Racecar") fails — it should be case-insensitive. Can you investigate and fix it? Add a test for the case-insensitive case. Make sure all tests still pass.',
						check: (r, _i) => {
							expect(r.json.exitCode).toBe(0);
							assertCommandSucceeds(r.workDir, "npm test");
						},
					},
				],
				{
					cwd: workDir,
					timeoutSec: CLI_TIMEOUT,
					setup: async (dir: string) => {
						writeFileSync(
							join(dir, "package.json"),
							JSON.stringify(
								{
									name: "string-utils",
									version: "1.0.0",
									type: "module",
									scripts: { test: "vitest run" },
									devDependencies: { vitest: "latest", typescript: "latest" },
								},
								null,
								2,
							),
						);
					},
				},
			);

			chatId = result.turns[0]?.json.chatId;

			expect(result.turns).toHaveLength(2);

			// After fix, isPalindrome handles case insensitivity
			assertAnyFileContains(result.workDir, ["ts"], "Racecar");

			for (let i = 0; i < result.turns.length; i++) {
				const t = result.turns[i].json;
				console.log(
					`\n  turn ${i + 1}: tokens: ${t.tokens} | cost: $${t.cost.toFixed(4)} | steps: ${t.steps} | toolCalls: ${t.toolCalls} | exit: ${t.exitCode}`,
				);
			}
		},
		TIMEOUT,
	);
});

/**
 * Eval: Iterative feature building (multi-turn).
 *
 * Turn 1 asks the agent to create an HTML page with a click counter.
 * Turn 2 asks it to add a reset button and dark-mode styling.
 * Validates that the agent can build on its own prior work across
 * multiple conversation turns.
 *
 * Requires: AI_GATEWAY_API_KEY set, CLI built.
 *
 *   AI_GATEWAY_API_KEY=<key> bun test tests/evals/iterative-feature.test.ts
 */
import { afterEach, describe, expect, test } from "bun:test";

import {
	assertAnyFileContains,
	assertFileExists,
	cleanupChat,
	cleanupWorkDir,
	createWorkDir,
	runMultiTurnEval,
} from "./eval-helpers";
import type { MultiTurnEvalResult } from "./eval-helpers";

const TIMEOUT = 600_000;
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

describe("eval: iterative feature building (multi-turn)", () => {
	test(
		"builds a counter page, then adds reset button and dark mode",
		async () => {
			workDir = createWorkDir();

			const result: MultiTurnEvalResult = await runMultiTurnEval(
				[
					{
						prompt:
							"Create an index.html file with a button that counts clicks. Display the current count on the page. Use vanilla JavaScript (no frameworks).",
						check: (r, _i) => {
							expect(r.json.exitCode).toBe(0);
							assertFileExists(r.workDir, "index.html");
							assertAnyFileContains(r.workDir, ["html"], "count");
						},
					},
					{
						prompt:
							"Add a reset button that sets the count back to zero. Also add dark mode styles — dark background with light text.",
						check: (r, _i) => {
							expect(r.json.exitCode).toBe(0);
							assertAnyFileContains(r.workDir, ["html"], "reset");
						},
					},
				],
				{
					cwd: workDir,
					timeoutSec: CLI_TIMEOUT,
				},
			);

			chatId = result.turns[0]?.json.chatId;

			// Both turns completed
			expect(result.turns).toHaveLength(2);

			// Log per-turn stats
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

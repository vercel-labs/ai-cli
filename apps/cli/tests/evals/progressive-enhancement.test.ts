/**
 * Eval: Progressive enhancement (multi-turn).
 *
 * Turn 1 asks the agent to create a basic Express REST API with tests.
 * Turn 2 asks it to add input validation and proper error handling.
 * Validates that the agent can layer features onto an existing codebase
 * across multiple conversation turns without breaking existing tests.
 *
 * Requires: AI_GATEWAY_API_KEY set, CLI built, network access.
 *
 *   AI_GATEWAY_API_KEY=<key> bun test tests/evals/progressive-enhancement.test.ts
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertAnyFileContains,
  assertCommandSucceeds,
  cleanupChat,
  cleanupWorkDir,
  createWorkDir,
  type MultiTurnEvalResult,
  runMultiTurnEval,
} from './eval-helpers';

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

describe('eval: progressive enhancement (multi-turn)', () => {
  test(
    'creates Express API, then adds validation and error handling',
    async () => {
      workDir = createWorkDir();

      const result: MultiTurnEvalResult = await runMultiTurnEval(
        [
          {
            prompt:
              'Create an Express REST API with GET /items and POST /items endpoints. Store items in memory as an array. Each item should have an id (auto-generated) and a name. Use TypeScript. Write tests using Vitest and supertest. Make sure all tests pass.',
            check: (r, _i) => {
              expect(r.json.exitCode).toBe(0);
              assertAnyFileContains(r.workDir, ['ts'], 'GET');
              assertAnyFileContains(r.workDir, ['ts'], 'POST');
              assertCommandSucceeds(r.workDir, 'npm test');
            },
          },
          {
            prompt:
              'Add input validation to POST /items: the name field is required and must be a non-empty string. Return 400 with a JSON error message when validation fails. Add tests for the validation cases. Make sure all tests pass.',
            check: (r, _i) => {
              expect(r.json.exitCode).toBe(0);
              assertCommandSucceeds(r.workDir, 'npm test');
            },
          },
        ],
        {
          cwd: workDir,
          timeoutSec: CLI_TIMEOUT,
          setup: async (dir: string) => {
            writeFileSync(
              join(dir, 'package.json'),
              JSON.stringify(
                {
                  name: 'items-api',
                  version: '1.0.0',
                  type: 'module',
                  scripts: { test: 'vitest run' },
                  devDependencies: {
                    vitest: 'latest',
                    typescript: 'latest',
                    supertest: 'latest',
                    '@types/supertest': 'latest',
                    '@types/express': 'latest',
                  },
                  dependencies: { express: 'latest' },
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

      // After turn 2, validation logic exists
      assertAnyFileContains(result.workDir, ['ts'], '400');

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

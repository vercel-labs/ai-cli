/**
 * Eval: Build a CLI tool with tests.
 *
 * Verifies the agent can:
 *   1. Create a project from scratch with TypeScript
 *   2. Implement working CLI logic
 *   3. Write tests for all operations
 *   4. Iterate until tests pass
 *
 * Requires: AI_GATEWAY_API_KEY set, CLI built, network access.
 *
 *   AI_GATEWAY_API_KEY=<key> bun test tests/evals/cli-with-tests.test.ts
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type EvalResult,
  assertAnyFileContains,
  assertCommandSucceeds,
  assertFileExists,
  cleanupWorkDir,
  createWorkDir,
  runEval,
} from './eval-helpers';

const TIMEOUT = 600_000;
const CLI_TIMEOUT = 300;

let workDir: string | null = null;

afterEach(() => {
  if (workDir) {
    cleanupWorkDir(workDir);
    workDir = null;
  }
});

describe('eval: CLI tool with tests', () => {
  test(
    'creates calculator CLI with passing tests',
    async () => {
      workDir = createWorkDir();

      const result: EvalResult = await runEval(
        'Create a Node.js CLI calculator that supports add, subtract, multiply, and divide operations via command-line arguments (e.g. node src/index.ts add 2 3). Use TypeScript. Write tests for all operations. Make sure all tests pass.',
        {
          cwd: workDir,
          timeoutSec: CLI_TIMEOUT,
          setup: async (dir: string) => {
            writeFileSync(
              join(dir, 'package.json'),
              JSON.stringify(
                { name: 'calc', version: '1.0.0', dependencies: {} },
                null,
                2,
              ),
            );
          },
        },
      );

      // 1. TypeScript configured
      assertFileExists(workDir, 'tsconfig.json');

      // 2. Source code contains calculator operations
      assertAnyFileContains(workDir, ['ts'], 'add');
      assertAnyFileContains(workDir, ['ts'], 'subtract');

      // 3. Test file exists
      assertAnyFileContains(workDir, ['ts'], 'test');

      // 4. Tests pass
      assertCommandSucceeds(
        workDir,
        'npx vitest run 2>&1 || npx jest 2>&1 || npm test 2>&1',
      );

      // 5. Agent completed successfully
      expect(result.json.exitCode).toBe(0);

      console.log(
        `\n  tokens: ${result.json.tokens} | cost: $${result.json.cost.toFixed(4)} | exit: ${result.json.exitCode}`,
      );
    },
    TIMEOUT,
  );
});

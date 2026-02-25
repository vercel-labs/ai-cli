/**
 * Eval: Full-stack CRUD REST API.
 *
 * Verifies the agent can build a complete REST API with Hono,
 * implement all CRUD operations, write tests, and make them pass.
 * Complex multi-step task that exercises the review loop.
 *
 * Requires: AI_GATEWAY_API_KEY set, CLI built, network access.
 *
 *   AI_GATEWAY_API_KEY=<key> bun test tests/evals/crud-api.test.ts
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type EvalResult,
  assertAnyFileContains,
  assertCommandSucceeds,
  assertFileContains,
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

describe('eval: CRUD REST API', () => {
  test(
    'creates Hono API with all CRUD routes and passing tests',
    async () => {
      workDir = createWorkDir();

      const result: EvalResult = await runEval(
        'Create a REST API using Hono that manages a list of todos. It should support GET /todos, POST /todos, PUT /todos/:id, and DELETE /todos/:id. Store data in memory. Use TypeScript. Write tests for all endpoints. Make sure all tests pass.',
        {
          cwd: workDir,
          timeoutSec: CLI_TIMEOUT,
          setup: async (dir: string) => {
            writeFileSync(
              join(dir, 'package.json'),
              JSON.stringify(
                {
                  name: 'todo-api',
                  version: '1.0.0',
                  type: 'module',
                  dependencies: {},
                  devDependencies: {},
                },
                null,
                2,
              ),
            );
          },
        },
      );

      // 1. Route definitions for all CRUD methods exist
      assertAnyFileContains(workDir, ['ts'], 'GET');
      assertAnyFileContains(workDir, ['ts'], 'POST');
      assertAnyFileContains(workDir, ['ts'], 'PUT');
      assertAnyFileContains(workDir, ['ts'], 'DELETE');

      // 2. TypeScript configured
      assertFileExists(workDir, 'tsconfig.json');

      // 3. Test file(s) exist
      assertAnyFileContains(workDir, ['ts'], 'expect');

      // 4. Tests pass
      assertCommandSucceeds(workDir, 'npm test');

      // 5. Hono is a dependency
      assertFileContains(workDir, 'package.json', '"hono"');

      // 6. Agent completed successfully
      expect(result.json.exitCode).toBe(0);

      console.log(
        `\n  tokens: ${result.json.tokens} | cost: $${result.json.cost.toFixed(4)} | exit: ${result.json.exitCode}`,
      );
    },
    TIMEOUT,
  );
});

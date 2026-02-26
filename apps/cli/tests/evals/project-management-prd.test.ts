/**
 * Eval: Large PRD — Project Management API.
 *
 * Passes a highly detailed PRD specifying a full-stack project management
 * REST API with 6 data models, 25+ endpoints, middleware, validation,
 * business logic, and comprehensive tests. This is significantly larger
 * than the component library PRD and tests sustained agent performance
 * on a complex, interconnected system.
 *
 * Requires: AI_GATEWAY_API_KEY set, CLI built, network access.
 * This eval is VERY EXPENSIVE and VERY SLOW (15-45 minutes).
 *
 *   AI_GATEWAY_API_KEY=<key> bun test tests/evals/project-management-prd.test.ts
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertAnyFileContains,
  assertCommandSucceeds,
  assertFileContains,
  assertFileExists,
  assertStepCount,
  cleanupWorkDir,
  createWorkDir,
  type EvalResult,
  runEval,
} from './eval-helpers';
import { assertSpecAdherence } from './eval-judge';

const TIMEOUT = 3_600_000; // 60 min bun:test timeout
const CLI_TIMEOUT = 2700; // 45 min CLI timeout

const PRD = `You are building a project management REST API called "taskflow". Follow this PRD exactly.

## Project Setup

- Use TypeScript with strict mode
- Use Hono as the HTTP framework
- Use Vitest for testing
- Store all data in memory (no database — use typed Maps or arrays)
- Install all necessary dependencies (hono, typescript, vitest, @types/node, tsx)
- Create a proper tsconfig.json
- Add a "test" script in package.json that runs "vitest run"
- The server should export the Hono app for testing (don't call .listen() at module level)

## Data Models

Create TypeScript interfaces for ALL 6 models below in a dedicated types file (src/types.ts or similar).

### 1. User
Fields: id (string, UUID), name (string), email (string), role ("admin" | "member"), createdAt (string, ISO date).

### 2. Project
Fields: id (string, UUID), name (string), description (string), ownerId (string, references User.id), status ("active" | "archived"), createdAt (string, ISO date), updatedAt (string, ISO date).

### 3. Task
Fields: id (string, UUID), title (string), description (string), projectId (string, references Project.id), assigneeId (string | null, references User.id), status ("todo" | "in_progress" | "in_review" | "done"), priority ("low" | "medium" | "high" | "urgent"), dueDate (string | null, ISO date), createdAt (string, ISO date), updatedAt (string, ISO date).

### 4. Comment
Fields: id (string, UUID), taskId (string, references Task.id), authorId (string, references User.id), content (string), createdAt (string, ISO date).

### 5. Label
Fields: id (string, UUID), name (string), color (string, hex color like "#ff0000").

### 6. TaskLabel
Fields: taskId (string, references Task.id), labelId (string, references Label.id).
This is a join table for the many-to-many relationship between Tasks and Labels.

## In-Memory Data Store

Create a data store module (src/store.ts or similar) that:
- Exports typed Maps or arrays for each model
- Exports helper functions: generateId() that returns a UUID, and now() that returns an ISO date string
- Exports a resetStore() function that clears all data (used in tests)
- Pre-seeds 2 users on initialization:
  - Admin user: { id: "user-1", name: "Alice Admin", email: "alice@example.com", role: "admin" }
  - Member user: { id: "user-2", name: "Bob Member", email: "bob@example.com", role: "member" }

## API Endpoints

Implement ALL of the following endpoints. Group routes in separate route files under src/routes/.

### Users (src/routes/users.ts)
1. GET /api/users — list all users
2. GET /api/users/:id — get user by id (404 if not found)
3. POST /api/users — create user (body: { name, email, role }). Validate: name and email required, email must be unique, role must be "admin" or "member". Return 201.
4. PUT /api/users/:id — update user (body: partial { name, email, role }). 404 if not found. Validate email uniqueness if changed.
5. DELETE /api/users/:id — delete user. 404 if not found. Cannot delete if user owns projects or is assigned to tasks — return 409 Conflict with message.

### Projects (src/routes/projects.ts)
6. GET /api/projects — list all projects. Support query param ?status=active|archived to filter.
7. GET /api/projects/:id — get project by id (404 if not found)
8. POST /api/projects — create project (body: { name, description, ownerId }). Validate: name required, ownerId must reference existing user. Return 201.
9. PUT /api/projects/:id — update project (body: partial { name, description, status }). 404 if not found. Cannot set status to "archived" if project has tasks with status != "done" — return 409.
10. DELETE /api/projects/:id — delete project. 404 if not found. Cannot delete if project has any tasks — return 409.
11. GET /api/projects/:id/tasks — list all tasks for a project. 404 if project not found.
12. GET /api/projects/:id/stats — return { total, todo, inProgress, inReview, done } task counts for the project.

### Tasks (src/routes/tasks.ts)
13. GET /api/tasks — list all tasks. Support query params: ?status=todo|in_progress|in_review|done, ?priority=low|medium|high|urgent, ?assigneeId=<id>, ?projectId=<id>. Multiple filters can combine.
14. GET /api/tasks/:id — get task by id, including its labels and comments (404 if not found)
15. POST /api/tasks — create task (body: { title, projectId, description?, assigneeId?, priority?, dueDate? }). Validate: title and projectId required, projectId must reference existing active project, assigneeId must reference existing user if provided, priority defaults to "medium", status defaults to "todo". Return 201.
16. PUT /api/tasks/:id — update task (body: partial { title, description, assigneeId, priority, dueDate }). 404 if not found.
17. PATCH /api/tasks/:id/status — update task status (body: { status }). Validate status transitions: todo -> in_progress, in_progress -> in_review, in_review -> done, in_review -> in_progress (sent back), done -> todo (reopen). Any other transition returns 400 with allowed transitions. 404 if not found.
18. DELETE /api/tasks/:id — delete task and all its comments and label associations. 404 if not found.
19. GET /api/tasks/:id/comments — list comments for a task. 404 if task not found.

### Comments (src/routes/comments.ts)
20. POST /api/tasks/:id/comments — create comment (body: { authorId, content }). Validate: authorId must reference existing user, content required and non-empty. 404 if task not found. Return 201.
21. PUT /api/comments/:id — update comment (body: { content }). 404 if not found. Validate content non-empty.
22. DELETE /api/comments/:id — delete comment. 404 if not found.

### Labels (src/routes/labels.ts)
23. GET /api/labels — list all labels
24. POST /api/labels — create label (body: { name, color }). Validate: name required and unique, color must be a valid hex color (match /^#[0-9a-fA-F]{6}$/). Return 201.
25. DELETE /api/labels/:id — delete label and remove all task-label associations. 404 if not found.
26. POST /api/tasks/:id/labels — add label to task (body: { labelId }). 404 if task or label not found. 409 if already applied.
27. DELETE /api/tasks/:id/labels/:labelId — remove label from task. 404 if task, label, or association not found.

### Search (src/routes/search.ts)
28. GET /api/search?q=<query> — search across task titles, task descriptions, project names, and project descriptions. Return { tasks: [...], projects: [...] } with matching results. Query must be at least 2 characters, otherwise return 400.

## Error Handling

- All validation errors return 400 with { error: "<descriptive message>" }
- Not found errors return 404 with { error: "Resource not found" } or similar
- Conflict errors return 409 with { error: "<descriptive message>" }
- All successful mutations return the created/updated resource in the response body

## Tests

Create test files for EACH route group. Each test file must:
- Import the Hono app and use app.request() for testing (no HTTP server needed)
- Call resetStore() in a beforeEach to ensure test isolation
- Test happy paths for all endpoints
- Test validation errors (400 responses)
- Test not-found cases (404 responses)
- Test business rule violations (409 responses)
- Test query parameter filtering where applicable

Required test files:
- src/routes/users.test.ts (or tests/users.test.ts)
- src/routes/projects.test.ts (or tests/projects.test.ts)
- src/routes/tasks.test.ts (or tests/tasks.test.ts)
- src/routes/comments.test.ts (or tests/comments.test.ts)
- src/routes/labels.test.ts (or tests/labels.test.ts)
- src/routes/search.test.ts (or tests/search.test.ts)

Each test file should have at least 8 test cases.

After creating all files, run the tests and make sure they ALL pass. Fix any failures.`;

// ---------------------------------------------------------------------------
// Expected entities for structural assertions
// ---------------------------------------------------------------------------

const ROUTE_GROUPS = [
  'users',
  'projects',
  'tasks',
  'comments',
  'labels',
  'search',
];

const REQUIRED_ENDPOINTS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];

const MODEL_NAMES = [
  'User',
  'Project',
  'Task',
  'Comment',
  'Label',
  'TaskLabel',
];

let workDir: string | null = null;

afterEach(() => {
  if (workDir) {
    cleanupWorkDir(workDir);
    workDir = null;
  }
});

function findFilesRecursive(
  dir: string,
  pattern: RegExp,
  skip = new Set(['node_modules', '.git', 'dist']),
): string[] {
  const results: string[] = [];
  let dirents: import('node:fs').Dirent[];
  try {
    dirents = readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of dirents) {
    const name = entry.name;
    const isDir = entry.isDirectory();
    if (skip.has(name)) continue;
    const full = join(dir, name);
    if (isDir) {
      results.push(...findFilesRecursive(full, pattern, skip));
    } else if (pattern.test(name)) {
      results.push(full);
    }
  }
  return results;
}

function countRouteFiles(dir: string): { found: string[]; missing: string[] } {
  const found: string[] = [];
  const missing: string[] = [];

  const allTsFiles = findFilesRecursive(dir, /\.(ts|tsx)$/);
  const allContent = allTsFiles.map((f) => {
    try {
      return { path: f, content: readFileSync(f, 'utf-8').toLowerCase() };
    } catch {
      return { path: f, content: '' };
    }
  });

  for (const group of ROUTE_GROUPS) {
    const hasFile = allContent.some(
      (f) =>
        f.path.toLowerCase().includes(group) &&
        !f.path.includes('.test.') &&
        !f.path.includes('.spec.'),
    );
    if (hasFile) {
      found.push(group);
    } else {
      missing.push(group);
    }
  }

  return { found, missing };
}

function countTestFiles(dir: string): { found: string[]; missing: string[] } {
  const found: string[] = [];
  const missing: string[] = [];

  const allTestFiles = findFilesRecursive(dir, /\.(test|spec)\.(ts|tsx)$/);

  for (const group of ROUTE_GROUPS) {
    const hasTest = allTestFiles.some((f) => f.toLowerCase().includes(group));
    if (hasTest) {
      found.push(group);
    } else {
      missing.push(group);
    }
  }

  return { found, missing };
}

function countModels(dir: string): { found: string[]; missing: string[] } {
  const found: string[] = [];
  const missing: string[] = [];

  const allTsFiles = findFilesRecursive(dir, /\.ts$/);
  const allContent = allTsFiles
    .map((f) => {
      try {
        return readFileSync(f, 'utf-8');
      } catch {
        return '';
      }
    })
    .join('\n');

  for (const model of MODEL_NAMES) {
    const pattern = new RegExp(`(interface|type)\\s+${model}\\b`);
    if (pattern.test(allContent)) {
      found.push(model);
    } else {
      missing.push(model);
    }
  }

  return { found, missing };
}

function countEndpointMethods(dir: string): Record<string, number> {
  const allTsFiles = findFilesRecursive(dir, /\.ts$/);
  const allContent = allTsFiles
    .filter((f) => !f.includes('.test.') && !f.includes('.spec.'))
    .map((f) => {
      try {
        return readFileSync(f, 'utf-8');
      } catch {
        return '';
      }
    })
    .join('\n');

  const counts: Record<string, number> = {};
  for (const method of REQUIRED_ENDPOINTS) {
    const pattern = new RegExp(`\\.${method.toLowerCase()}\\(`, 'gi');
    const matches = allContent.match(pattern);
    counts[method] = matches ? matches.length : 0;
  }
  return counts;
}

describe('eval: large PRD — project management API', () => {
  test(
    'builds full-stack project management API from a detailed PRD',
    async () => {
      workDir = createWorkDir();

      const result: EvalResult = await runEval(PRD, {
        cwd: workDir,
        timeoutSec: CLI_TIMEOUT,
        setup: async (dir: string) => {
          writeFileSync(
            join(dir, 'package.json'),
            JSON.stringify(
              {
                name: 'taskflow',
                version: '1.0.0',
                type: 'module',
              },
              null,
              2,
            ),
          );
        },
      });

      // -- Route files: at least 5 of 6 ----------------------------
      const routes = countRouteFiles(workDir);
      console.log(
        `\n  route files found: ${routes.found.length}/6 — ${routes.found.join(', ')}`,
      );
      if (routes.missing.length > 0) {
        console.log(`  route files missing: ${routes.missing.join(', ')}`);
      }
      expect(routes.found.length).toBeGreaterThanOrEqual(5);

      // -- Test files: at least 5 of 6 -----------------------------
      const tests = countTestFiles(workDir);
      console.log(
        `  test files found: ${tests.found.length}/6 — ${tests.found.join(', ')}`,
      );
      if (tests.missing.length > 0) {
        console.log(`  test files missing: ${tests.missing.join(', ')}`);
      }
      expect(tests.found.length).toBeGreaterThanOrEqual(5);

      // -- Data models: at least 5 of 6 ----------------------------
      const models = countModels(workDir);
      console.log(
        `  models found: ${models.found.length}/6 — ${models.found.join(', ')}`,
      );
      if (models.missing.length > 0) {
        console.log(`  models missing: ${models.missing.join(', ')}`);
      }
      expect(models.found.length).toBeGreaterThanOrEqual(5);

      // -- HTTP methods in source code ------------------------------
      const methods = countEndpointMethods(workDir);
      console.log(
        `  endpoint methods: ${Object.entries(methods)
          .map(([k, v]) => `${k}=${v}`)
          .join(', ')}`,
      );
      expect(methods.GET).toBeGreaterThanOrEqual(5);
      expect(methods.POST).toBeGreaterThanOrEqual(4);
      expect(methods.DELETE).toBeGreaterThanOrEqual(3);

      // -- TypeScript config ----------------------------------------
      assertFileExists(workDir, 'tsconfig.json');

      // -- Dependencies in package.json -----------------------------
      assertFileContains(workDir, 'package.json', 'hono');
      assertFileContains(workDir, 'package.json', 'vitest');

      // -- Store module exists (data layer) -------------------------
      assertAnyFileContains(workDir, ['ts'], 'resetStore');

      // -- Validation exists ----------------------------------------
      assertAnyFileContains(workDir, ['ts'], '400');
      assertAnyFileContains(workDir, ['ts'], '404');
      assertAnyFileContains(workDir, ['ts'], '409');

      // -- Tests pass -----------------------------------------------
      assertCommandSucceeds(workDir, 'npx vitest run', 180_000);

      // -- Agent completed successfully -----------------------------
      expect(result.json.exitCode).toBe(0);

      // -- Sanity: agent did significant work -----------------------
      assertStepCount(result, { min: 15 });

      // -- Judge: spec adherence ------------------------------------
      await assertSpecAdherence(PRD, workDir);

      console.log(
        `\n  tokens: ${result.json.tokens} | cost: $${result.json.cost.toFixed(4)} | steps: ${result.json.steps} | toolCalls: ${result.json.toolCalls} | exit: ${result.json.exitCode}`,
      );
    },
    TIMEOUT,
  );
});

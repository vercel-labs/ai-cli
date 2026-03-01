export const EVAL_MODELS = [
  'anthropic/claude-sonnet-4.6',
  'xai/grok-4.1-fast-reasoning',
] as const;

export type EvalCategory =
  | 'defaults'
  | 'codegen'
  | 'bugfix'
  | 'refactor'
  | 'multi-turn'
  | 'prd';

export interface EvalDefinition {
  slug: string;
  name: string;
  description: string;
  category: EvalCategory;
  timeoutSec: number;
  prompt: string;
  /** For multi-turn evals, additional prompts after the first */
  followUpPrompts?: string[];
  /** What this eval checks — displayed in the detail view */
  criteria: string[];
  /** When set, the runner will invoke an LLM judge after the agent finishes.
   *  The value is the spec/PRD text the judge uses as ground truth. */
  judgeSpec?: string;
}

export const EVAL_REGISTRY: EvalDefinition[] = [
  {
    slug: 'date-awareness',
    name: 'Date Awareness',
    description: 'Agent responds with the correct current date',
    category: 'defaults',
    timeoutSec: 60,
    prompt: "What is today's date? Respond with just the date.",
    criteria: [
      'Response contains the current year (2026)',
      'Agent completes without error',
    ],
  },
  {
    slug: 'package-manager',
    name: 'Package Manager Detection',
    description:
      'Detects yarn from lockfile and uses it to install a dependency',
    category: 'defaults',
    timeoutSec: 300,
    prompt: 'Add the lodash package to this project.',
    criteria: [
      'Detects existing yarn.lock and uses yarn (not npm/pnpm/bun)',
      'yarn.lock still exists after install',
      'No wrong lockfiles created (package-lock.json, pnpm-lock.yaml, bun.lockb)',
      'lodash added to package.json dependencies',
    ],
  },
  {
    slug: 'latest-versions',
    name: 'Latest Package Versions',
    description: 'Installs current major version of zod, not an outdated one',
    category: 'defaults',
    timeoutSec: 300,
    prompt: 'Add zod to this project. Install it properly.',
    criteria: [
      'zod added to package.json dependencies',
      'Installed version is current major (v4+), not outdated (v3)',
      'A lockfile is created',
      'Agent completes without error',
    ],
  },
  {
    slug: 'create-nextjs',
    name: 'Create Next.js Website',
    description:
      'Scaffolds project with TypeScript, App Router, src dir, and builds',
    category: 'codegen',
    timeoutSec: 300,
    prompt:
      'Create a new Next.js website with a landing page. Install all dependencies and make sure the project builds.',
    criteria: [
      'next.config.ts/mjs/js exists',
      'package.json contains "next" dependency',
      'TypeScript is configured (tsconfig.json exists)',
      'App Router structure (app/ directory with layout and page)',
      'Project builds successfully (next build exits 0)',
    ],
  },
  {
    slug: 'clone-blog-confetti',
    name: 'Clone Blog + Add Confetti',
    description: 'Clones repo, uses pnpm, installs confetti, modifies code',
    category: 'codegen',
    timeoutSec: 300,
    prompt:
      'Clone the repo rauchg/blog and add confetti that triggers on page load. Make sure to install dependencies and verify the changes work.',
    criteria: [
      'Repo cloned into a blog/ subdirectory',
      'pnpm detected and used (pnpm-lock.yaml exists)',
      'canvas-confetti or similar confetti package added to dependencies',
      'Source code modified to trigger confetti on page load',
      'No wrong lockfiles created',
    ],
  },
  {
    slug: 'fix-known-bug',
    name: 'Fix a Known Bug',
    description: 'Finds and fixes the buggy divide function, tests pass',
    category: 'bugfix',
    timeoutSec: 300,
    prompt:
      "There's a bug in this project. The divide function returns wrong results. Find and fix it. Make sure the tests pass.",
    criteria: [
      'Identifies the buggy divide function',
      'Fixes the bug (correct division logic)',
      'All tests pass after the fix',
      'No unrelated changes introduced',
    ],
  },
  {
    slug: 'cli-with-tests',
    name: 'CLI Tool with Tests',
    description: 'Creates calculator CLI with passing tests',
    category: 'codegen',
    timeoutSec: 300,
    prompt:
      'Create a Node.js CLI calculator that supports add, subtract, multiply, and divide operations via command-line arguments (e.g. node src/index.ts add 2 3). Use TypeScript. Write tests for all operations. Make sure all tests pass.',
    criteria: [
      'TypeScript source file exists (src/index.ts or similar)',
      'Supports add, subtract, multiply, divide operations',
      'Test file exists with tests for all 4 operations',
      'All tests pass',
      'package.json has a test script',
    ],
  },
  {
    slug: 'react-component',
    name: 'Multi-file React Components',
    description: 'Creates Button and Modal components with tests that pass',
    category: 'codegen',
    timeoutSec: 300,
    prompt:
      'Create a React component library with a Button component and a Modal component. Each component should have its own file, props interface, and test file. Use TypeScript and Vitest for testing. Make sure all tests pass.',
    criteria: [
      'Button component in its own file with typed props',
      'Modal component in its own file with typed props',
      'Separate test file for each component',
      'TypeScript and Vitest configured',
      'All tests pass',
    ],
  },
  {
    slug: 'crud-api',
    name: 'CRUD REST API',
    description: 'Creates Hono API with all CRUD routes and passing tests',
    category: 'codegen',
    timeoutSec: 300,
    prompt:
      'Create a REST API using Hono that manages a list of todos. It should support GET /todos, POST /todos, PUT /todos/:id, and DELETE /todos/:id. Store data in memory. Use TypeScript. Write tests for all endpoints. Make sure all tests pass.',
    criteria: [
      'Hono app with GET, POST, PUT, DELETE /todos routes',
      'In-memory storage for todo items',
      'TypeScript configured',
      'Test file covering all 4 endpoints',
      'All tests pass',
    ],
  },
  {
    slug: 'refactor-safe',
    name: 'Safe Refactor',
    description: 'Splits utils.ts into separate files without breaking tests',
    category: 'refactor',
    timeoutSec: 300,
    prompt:
      'Refactor the utils module. Split the single utils.ts file into separate files (one per function: capitalize.ts, slugify.ts, truncate.ts). Update all imports in index.ts and the test file. Make sure the tests still pass.',
    criteria: [
      'capitalize.ts, slugify.ts, truncate.ts each exist as separate files',
      'Original utils.ts removed or converted to barrel export',
      'Imports in index.ts and test files updated correctly',
      'All tests still pass after refactoring',
    ],
  },
  {
    slug: 'build-then-fix',
    name: 'Build Then Fix',
    description: 'Creates string utils with tests, then fixes a reported bug',
    category: 'multi-turn',
    timeoutSec: 300,
    prompt:
      'Create a TypeScript string utility module with capitalize, reverse, and isPalindrome functions. Write tests using Vitest. Make sure all tests pass.',
    followUpPrompts: [
      'Users are reporting that isPalindrome("racecar") works but isPalindrome("Racecar") fails — it should be case-insensitive. Can you investigate and fix it? Add a test for the case-insensitive case. Make sure all tests still pass.',
    ],
    criteria: [
      'Turn 1: capitalize, reverse, isPalindrome functions created',
      'Turn 1: Tests pass for all 3 functions',
      'Turn 2: isPalindrome made case-insensitive',
      'Turn 2: New test for case-insensitive palindrome added',
      'Turn 2: All tests still pass',
    ],
  },
  {
    slug: 'iterative-feature',
    name: 'Iterative Feature Building',
    description: 'Builds a counter page, then adds reset button and dark mode',
    category: 'multi-turn',
    timeoutSec: 300,
    prompt:
      'Create an index.html file with a button that counts clicks. Display the current count on the page. Use vanilla JavaScript (no frameworks).',
    followUpPrompts: [
      'Add a reset button that sets the count back to zero. Also add dark mode styles — dark background with light text.',
    ],
    criteria: [
      'Turn 1: index.html with click counter and count display',
      'Turn 1: Vanilla JS, no frameworks',
      'Turn 2: Reset button that clears count to zero',
      'Turn 2: Dark mode styles applied',
    ],
  },
  {
    slug: 'progressive-enhancement',
    name: 'Progressive Enhancement',
    description: 'Creates Express API, then adds validation and error handling',
    category: 'multi-turn',
    timeoutSec: 300,
    prompt:
      'Create an Express REST API with GET /items and POST /items endpoints. Store items in memory as an array. Each item should have an id (auto-generated) and a name. Use TypeScript. Write tests using Vitest and supertest. Make sure all tests pass.',
    followUpPrompts: [
      'Add input validation to POST /items: the name field is required and must be a non-empty string. Return 400 with a JSON error message when validation fails. Add tests for the validation cases. Make sure all tests pass.',
    ],
    criteria: [
      'Turn 1: Express API with GET and POST /items',
      'Turn 1: In-memory storage with auto-generated IDs',
      'Turn 1: Tests pass with Vitest + supertest',
      'Turn 2: POST validation — rejects empty/missing name with 400',
      'Turn 2: Validation test cases added and passing',
    ],
  },
  {
    slug: 'component-library-prd',
    name: 'Component Library (Large PRD)',
    description: 'Builds 12-component React library from a detailed PRD',
    category: 'prd',
    timeoutSec: 1800,
    prompt: `You are building a React component library called "ui-lib". Follow this PRD exactly.

## Project Setup

- Use TypeScript with strict mode
- Use Vitest and React Testing Library (@testing-library/react) for tests
- Configure jsdom as the test environment
- Install all necessary dependencies (react, react-dom, @types/react, vitest, @testing-library/react, jsdom, @testing-library/jest-dom, typescript)
- Create a proper tsconfig.json with jsx support

## Components

Create ALL 12 components below. Each component must:
- Live in its own file under src/components/ (e.g. src/components/Button.tsx)
- Export a named Props interface (e.g. ButtonProps)
- Have a corresponding test file (e.g. src/components/Button.test.tsx)
- Use proper aria-* attributes for accessibility where applicable

### 1. Button
Props: variant ("primary" | "secondary" | "ghost"), size ("sm" | "md" | "lg"), disabled (boolean), loading (boolean), onClick, children.
When loading is true, render a spinner span with aria-label="Loading" and disable the button.
Apply aria-disabled when disabled. Use a <button> element.

### 2. Input
Props: label (string), placeholder (string), error (string, optional), disabled (boolean), type ("text" | "password" | "email"), onChange, value.
Render a <label> with the label text, an <input> element, and an error message <span> when error is provided.
Use aria-invalid="true" when error is present. Use aria-describedby linking to the error message.

### 3. Select
Props: label (string), options (array of { value: string, label: string }), placeholder (string, optional), error (string, optional), disabled (boolean), onChange, value.
Render a <label>, a <select> element with <option> children, and an error span.
Use aria-invalid when error is present.

### 4. Checkbox
Props: label (string), checked (boolean), disabled (boolean), onChange, indeterminate (boolean).
Render a <label> wrapping an <input type="checkbox"> and the label text.
Set the indeterminate property via a ref when the indeterminate prop is true. Use aria-checked.

### 5. Toggle
Props: label (string), checked (boolean), disabled (boolean), onChange, size ("sm" | "md").
Render a <button> with role="switch" and aria-checked. Show the label text.

### 6. Badge
Props: variant ("default" | "success" | "warning" | "error"), size ("sm" | "md"), children.
Render a <span> with a data-variant attribute set to the variant value.

### 7. Avatar
Props: src (string, optional), alt (string), fallback (string — initials to show when no src), size ("sm" | "md" | "lg").
Render an <img> when src is provided, otherwise render a <span> with the fallback text.
Use aria-label on the container.

### 8. Card
Props: title (string, optional), children, footer (ReactNode, optional), hoverable (boolean).
Render an <article> element. Show the title in a heading if provided. Render footer in a <footer> element.

### 9. Modal
Props: open (boolean), onClose (function), title (string), children, footer (ReactNode, optional).
Render a dialog overlay when open is true. Close when clicking the overlay or pressing Escape.
Use role="dialog" and aria-modal="true". Use aria-labelledby pointing to the title.
Focus trap is not required but the modal should have proper ARIA.

### 10. Toast
Props: message (string), variant ("info" | "success" | "warning" | "error"), duration (number, optional), onClose (function).
Render a <div> with role="alert". Apply data-variant. If duration is provided, auto-dismiss after that many ms by calling onClose.

### 11. Tooltip
Props: content (string), children (ReactNode), position ("top" | "bottom" | "left" | "right").
Render the children. On hover, show a tooltip element with role="tooltip" and the content text.
Use aria-describedby on the trigger element to reference the tooltip.

### 12. Tabs
Props: tabs (array of { label: string, content: ReactNode }), defaultIndex (number, default 0), onChange (function, optional).
Render a tablist with role="tablist". Each tab button has role="tab" and aria-selected.
The active panel has role="tabpanel". Use aria-controls and aria-labelledby to link tabs to panels.

## Barrel Export

Create src/index.ts that re-exports all components and their Props types.

## Tests

Each component test file must:
- Import the component and render it with React Testing Library
- Test the default rendering
- Test key props (e.g. variant changes, disabled state, onClick fires)
- Have at least 3 test cases per component

After creating all files, run the tests and make sure they ALL pass. Fix any failures.`,
    criteria: [
      'All 12 components created in src/components/',
      'Each component has typed Props interface',
      'Each component has a corresponding test file',
      'Proper accessibility (aria-*) attributes',
      'Barrel export in src/index.ts',
      'At least 3 test cases per component (36+ total)',
      'All tests pass',
      'LLM judge score ≥ 7/10 for spec adherence',
    ],
    judgeSpec: 'USE_PROMPT',
  },
  {
    slug: 'project-management-prd',
    name: 'Project Management API (Large PRD)',
    description: 'Builds full-stack project management API from a detailed PRD',
    category: 'prd',
    timeoutSec: 2700,
    prompt: `You are building a project management REST API called "taskflow". Follow this PRD exactly.

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

After creating all files, run the tests and make sure they ALL pass. Fix any failures.`,
    criteria: [
      'All 6 data models defined in types file',
      'In-memory store with resetStore() and seed data',
      '28 API endpoints implemented across 5 route groups + search',
      'Validation errors return 400, not-found returns 404, conflicts return 409',
      'Test files for each route group (6 files, 8+ tests each)',
      'Query parameter filtering works (status, priority, assigneeId)',
      'Status transition rules enforced (PATCH /tasks/:id/status)',
      'All tests pass',
      'LLM judge score ≥ 7/10 for spec adherence',
    ],
    judgeSpec: 'USE_PROMPT',
  },
];

export function getEvalBySlug(slug: string): EvalDefinition | undefined {
  return EVAL_REGISTRY.find((e) => e.slug === slug);
}

export function getEvalsByCategory(category: EvalCategory): EvalDefinition[] {
  return EVAL_REGISTRY.filter((e) => e.category === category);
}

export const EVAL_CATEGORIES: { value: EvalCategory; label: string }[] = [
  { value: 'defaults', label: 'Defaults' },
  { value: 'codegen', label: 'Code Generation' },
  { value: 'bugfix', label: 'Bug Fix' },
  { value: 'refactor', label: 'Refactoring' },
  { value: 'multi-turn', label: 'Multi-turn' },
  { value: 'prd', label: 'Large PRD' },
];

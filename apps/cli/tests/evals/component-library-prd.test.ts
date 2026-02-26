/**
 * Eval: Large PRD — React Component Library.
 *
 * Passes a detailed PRD specifying 12 React components, each with
 * TypeScript props, variants, accessibility attributes, and a test file.
 * Validates that the agent can sustain ~100 steps of work on a single
 * large specification without losing context or stopping prematurely.
 *
 * Requires: AI_GATEWAY_API_KEY set, CLI built, network access.
 * This eval is EXPENSIVE and SLOW (10-30 minutes).
 *
 *   AI_GATEWAY_API_KEY=<key> bun test tests/evals/component-library-prd.test.ts
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, writeFileSync } from 'node:fs';
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

const TIMEOUT = 2_400_000; // 40 min bun:test timeout
const CLI_TIMEOUT = 1800; // 30 min CLI timeout

const COMPONENT_NAMES = [
  'Button',
  'Input',
  'Select',
  'Checkbox',
  'Toggle',
  'Badge',
  'Avatar',
  'Card',
  'Modal',
  'Toast',
  'Tooltip',
  'Tabs',
];

const PRD = `You are building a React component library called "ui-lib". Follow this PRD exactly.

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

After creating all files, run the tests and make sure they ALL pass. Fix any failures.`;

let workDir: string | null = null;

afterEach(() => {
  if (workDir) {
    cleanupWorkDir(workDir);
    workDir = null;
  }
});

/**
 * Count how many of the expected components have a source file,
 * accepting flexible naming conventions.
 */
function countComponentFiles(dir: string): {
  found: string[];
  missing: string[];
} {
  const found: string[] = [];
  const missing: string[] = [];

  for (const name of COMPONENT_NAMES) {
    const lower = name.toLowerCase();
    const candidates = [
      `src/components/${name}.tsx`,
      `src/components/${lower}.tsx`,
      `src/components/${name}/index.tsx`,
      `src/components/${lower}/index.tsx`,
      `src/components/${name}/${name}.tsx`,
      `src/components/${lower}/${lower}.tsx`,
    ];
    if (candidates.some((c) => existsSync(join(dir, c)))) {
      found.push(name);
    } else {
      missing.push(name);
    }
  }

  return { found, missing };
}

/**
 * Count how many of the expected components have a test file.
 */
function countTestFiles(dir: string): { found: string[]; missing: string[] } {
  const found: string[] = [];
  const missing: string[] = [];

  for (const name of COMPONENT_NAMES) {
    const lower = name.toLowerCase();
    const candidates = [
      `src/components/${name}.test.tsx`,
      `src/components/${lower}.test.tsx`,
      `src/components/${name}.test.ts`,
      `src/components/${lower}.test.ts`,
      `src/components/${name}/${name}.test.tsx`,
      `src/components/${lower}/${lower}.test.tsx`,
      `src/components/${name}/index.test.tsx`,
      `src/components/${lower}/index.test.tsx`,
      `src/__tests__/${name}.test.tsx`,
      `src/__tests__/${lower}.test.tsx`,
      `tests/${name}.test.tsx`,
      `tests/${lower}.test.tsx`,
    ];
    if (candidates.some((c) => existsSync(join(dir, c)))) {
      found.push(name);
    } else {
      missing.push(name);
    }
  }

  return { found, missing };
}

describe('eval: large PRD — component library', () => {
  test(
    'builds 12-component React library from a detailed PRD',
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
                name: 'ui-lib',
                version: '1.0.0',
                type: 'module',
              },
              null,
              2,
            ),
          );
        },
      });

      // -- Component files: at least 10 of 12 ---------------------
      const components = countComponentFiles(workDir);
      console.log(
        `\n  components found: ${components.found.length}/12 — ${components.found.join(', ')}`,
      );
      if (components.missing.length > 0) {
        console.log(`  components missing: ${components.missing.join(', ')}`);
      }
      expect(components.found.length).toBeGreaterThanOrEqual(10);

      // -- Test files: at least 10 of 12 --------------------------
      const tests = countTestFiles(workDir);
      console.log(
        `  test files found: ${tests.found.length}/12 — ${tests.found.join(', ')}`,
      );
      if (tests.missing.length > 0) {
        console.log(`  test files missing: ${tests.missing.join(', ')}`);
      }
      expect(tests.found.length).toBeGreaterThanOrEqual(10);

      // -- Props interfaces exist ---------------------------------
      assertAnyFileContains(workDir, ['tsx', 'ts'], 'Props');

      // -- Accessibility: aria attributes present ------------------
      assertAnyFileContains(workDir, ['tsx'], 'aria-');

      // -- Barrel export ------------------------------------------
      const barrelCandidates = ['src/index.ts', 'src/index.tsx'];
      const dir = workDir as string;
      const hasBarrel = barrelCandidates.some((p) => existsSync(join(dir, p)));
      expect(hasBarrel).toBe(true);

      // -- TypeScript config --------------------------------------
      assertFileExists(workDir, 'tsconfig.json');

      // -- Dependencies in package.json ---------------------------
      assertFileContains(workDir, 'package.json', 'react');
      assertFileContains(workDir, 'package.json', 'vitest');

      // -- Tests pass ---------------------------------------------
      assertCommandSucceeds(workDir, 'npx vitest run', 180_000);

      // -- Agent completed successfully ---------------------------
      expect(result.json.exitCode).toBe(0);

      // -- Sanity: agent did significant work ---------------------
      assertStepCount(result, { min: 10 });

      // -- Judge: spec adherence -----------------------------------
      await assertSpecAdherence(PRD, workDir);

      console.log(
        `\n  tokens: ${result.json.tokens} | cost: $${result.json.cost.toFixed(4)} | steps: ${result.json.steps} | toolCalls: ${result.json.toolCalls} | exit: ${result.json.exitCode}`,
      );
    },
    TIMEOUT,
  );
});

#!/usr/bin/env bun
/**
 * Runs the eval suite once per model in EVAL_MODELS.
 *
 *   bun run tests/evals/run-matrix.ts           # all models
 *   bun run tests/evals/run-matrix.ts grok      # fuzzy-filter to matching models
 */
import { spawn } from 'node:child_process';
import { EVAL_MODELS } from './eval-helpers';

const filter = process.argv[2]?.toLowerCase();
const models = filter
  ? EVAL_MODELS.filter((m) => m.toLowerCase().includes(filter))
  : [...EVAL_MODELS];

if (models.length === 0) {
  console.error(`No models matched filter "${filter}"`);
  console.error(`Available: ${EVAL_MODELS.join(', ')}`);
  process.exit(1);
}

interface RunResult {
  model: string;
  exitCode: number | null;
  durationMs: number;
}

const results: RunResult[] = [];

for (const model of models) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  MODEL: ${model}`);
  console.log(`${'='.repeat(60)}\n`);

  const start = Date.now();
  const code = await new Promise<number | null>((resolve) => {
    const child = spawn('bun', ['test', 'tests/evals/'], {
      cwd: import.meta.dirname
        ? import.meta.dirname.replace(/\/tests\/evals$/, '')
        : process.cwd(),
      env: { ...process.env, EVAL_MODEL: model },
      stdio: 'inherit',
    });
    child.on('close', resolve);
  });
  results.push({ model, exitCode: code, durationMs: Date.now() - start });
}

console.log(`\n${'='.repeat(60)}`);
console.log('  MATRIX RESULTS');
console.log(`${'='.repeat(60)}`);
for (const r of results) {
  const status = r.exitCode === 0 ? 'PASS' : 'FAIL';
  const mins = (r.durationMs / 60_000).toFixed(1);
  console.log(`  ${status}  ${r.model}  (${mins}m)`);
}

const failed = results.filter((r) => r.exitCode !== 0);
if (failed.length > 0) {
  console.log(`\n  ${failed.length}/${results.length} model(s) had failures.`);
  process.exit(1);
} else {
  console.log(`\n  All ${results.length} model(s) passed.`);
}

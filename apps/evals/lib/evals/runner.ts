import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { evalRuns, evalTasks } from '@/lib/db/schema';
import type { EvalDefinition } from './registry';

const CLI_PATH = resolve(process.cwd(), '../cli/dist/ai.mjs');

interface TaskResult {
  output: string;
  model: string;
  tokens: number;
  cost: number;
  steps: number;
  toolCalls: number;
  exitCode: number;
  error?: string;
}

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'ai-cli-eval-'));
}

function cleanupDir(dir: string): void {
  try {
    spawn('rm', ['-rf', dir], { stdio: 'ignore', detached: true }).unref();
  } catch {}
}

async function runSingleEval(
  evalDef: EvalDefinition,
  model: string,
): Promise<TaskResult> {
  const workDir = createTempDir();
  const args = [
    CLI_PATH,
    '-p',
    '--force',
    '--json',
    '--no-save',
    '--timeout',
    String(evalDef.timeoutSec),
    '--model',
    model,
    evalDef.prompt,
  ];

  try {
    const result = await new Promise<{ stdout: string; stderr: string }>(
      (resolvePromise, rejectPromise) => {
        const child = spawn(process.execPath, args, {
          env: { ...process.env, NO_COLOR: '1' },
          cwd: workDir,
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        const stdoutBufs: Buffer[] = [];
        const stderrBufs: Buffer[] = [];
        child.stdout.on('data', (d: Buffer) => stdoutBufs.push(d));
        child.stderr.on('data', (d: Buffer) => stderrBufs.push(d));
        child.stdin.end();

        const killTimeout = setTimeout(
          () => {
            child.kill('SIGTERM');
            rejectPromise(new Error('Eval process timed out'));
          },
          (evalDef.timeoutSec + 60) * 1000,
        );

        child.on('close', () => {
          clearTimeout(killTimeout);
          resolvePromise({
            stdout: Buffer.concat(stdoutBufs).toString(),
            stderr: Buffer.concat(stderrBufs).toString(),
          });
        });

        child.on('error', (err: Error) => {
          clearTimeout(killTimeout);
          rejectPromise(err);
        });
      },
    );

    const parsed = JSON.parse(result.stdout.trim()) as TaskResult;
    return parsed;
  } finally {
    cleanupDir(workDir);
  }
}

/** Simple concurrency limiter */
async function withConcurrency<T>(
  limit: number,
  tasks: (() => Promise<T>)[],
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < tasks.length) {
      const idx = nextIndex++;
      results[idx] = await tasks[idx]();
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () =>
    worker(),
  );
  await Promise.all(workers);
  return results;
}

export async function executeRun(
  runId: string,
  evalDefs: EvalDefinition[],
  models: string[],
  concurrency = 4,
): Promise<void> {
  await db
    .update(evalRuns)
    .set({ status: 'running' })
    .where(eq(evalRuns.id, runId));

  const taskEntries: {
    evalDef: EvalDefinition;
    model: string;
    taskId: string;
  }[] = [];

  for (const evalDef of evalDefs) {
    for (const model of models) {
      const [inserted] = await db
        .insert(evalTasks)
        .values({
          runId,
          evalName: evalDef.slug,
          model,
          status: 'pending',
        })
        .returning({ id: evalTasks.id });

      taskEntries.push({ evalDef, model, taskId: inserted.id });
    }
  }

  const jobs = taskEntries.map(({ evalDef, model, taskId }) => async () => {
    const startedAt = new Date();
    await db
      .update(evalTasks)
      .set({ status: 'running', startedAt })
      .where(eq(evalTasks.id, taskId));

    try {
      const result = await runSingleEval(evalDef, model);
      const completedAt = new Date();
      const durationMs = completedAt.getTime() - startedAt.getTime();

      await db
        .update(evalTasks)
        .set({
          status: result.error ? 'failed' : 'completed',
          tokens: result.tokens,
          cost: result.cost,
          steps: result.steps,
          toolCalls: result.toolCalls,
          durationMs,
          output: result.output?.slice(0, 10000),
          error: result.error ?? null,
          exitCode: result.exitCode,
          completedAt,
        })
        .where(eq(evalTasks.id, taskId));
    } catch (err) {
      const completedAt = new Date();
      await db
        .update(evalTasks)
        .set({
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
          durationMs: completedAt.getTime() - startedAt.getTime(),
          completedAt,
        })
        .where(eq(evalTasks.id, taskId));
    }
  });

  try {
    await withConcurrency(concurrency, jobs);

    const allTasks = await db
      .select()
      .from(evalTasks)
      .where(eq(evalTasks.runId, runId));

    const hasFailed = allTasks.some((t) => t.status === 'failed');

    await db
      .update(evalRuns)
      .set({
        status: hasFailed ? 'failed' : 'completed',
        completedAt: new Date(),
      })
      .where(eq(evalRuns.id, runId));
  } catch {
    await db
      .update(evalRuns)
      .set({ status: 'failed', completedAt: new Date() })
      .where(eq(evalRuns.id, runId));
  }
}

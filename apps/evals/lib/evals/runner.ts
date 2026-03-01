import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { evalRuns, evalTasks, evalComparisons } from '@/lib/db/schema';
import type { EvalDefinition } from './registry';
import { getEvalBySlug } from './registry';
import { judgeSpecAdherence, judgeComparison } from './judge';

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
  logs: string;
  workDir: string;
  messages?: { role: string; content: string }[];
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
  onLogs?: (logs: string) => void,
): Promise<TaskResult> {
  const workDir = createTempDir();
  const args = [
    CLI_PATH,
    '-p',
    '--force',
    '--json',
    '--verbose',
    '--no-save',
    '--timeout',
    String(evalDef.timeoutSec),
    '--model',
    model,
    evalDef.prompt,
  ];

  const result = await new Promise<{ stdout: string; stderr: string }>(
    (resolvePromise, rejectPromise) => {
      const child = spawn(process.execPath, args, {
        env: { ...process.env, NO_COLOR: '1' },
        cwd: workDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true,
      });

      const stdoutBufs: Buffer[] = [];
      let stderrText = '';
      child.stdout.on('data', (d: Buffer) => stdoutBufs.push(d));
      child.stderr.on('data', (d: Buffer) => {
        stderrText += d.toString();
      });
      child.stdin.end();

      const flushInterval = setInterval(() => {
        if (stderrText && onLogs) {
          onLogs(stderrText);
        }
      }, 3000);

      const killTimeout = setTimeout(
        () => {
          try {
            process.kill(-child.pid!, 'SIGTERM');
          } catch {
            child.kill('SIGTERM');
          }
          rejectPromise(new Error('Eval process timed out'));
        },
        (evalDef.timeoutSec + 60) * 1000,
      );

      child.on('close', () => {
        clearTimeout(killTimeout);
        clearInterval(flushInterval);
        if (stderrText && onLogs) {
          onLogs(stderrText);
        }
        resolvePromise({
          stdout: Buffer.concat(stdoutBufs).toString(),
          stderr: stderrText,
        });
      });

      child.on('error', (err: Error) => {
        clearTimeout(killTimeout);
        clearInterval(flushInterval);
        rejectPromise(err);
      });
    },
  );

  let parsed: TaskResult;
  try {
    parsed = JSON.parse(result.stdout.trim()) as TaskResult;
  } catch (parseErr) {
    return {
      output: '',
      model,
      tokens: 0,
      cost: 0,
      steps: 0,
      toolCalls: 0,
      exitCode: 1,
      error: `Failed to parse CLI JSON output: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
      logs: result.stderr,
      workDir,
    };
  }
  parsed.logs = result.stderr;
  parsed.workDir = workDir;
  return parsed;
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

    let logs = '';

    const extractMessages = (
      text: string,
    ): { role: string; content: string }[] => {
      const msgs: { role: string; content: string }[] = [];
      for (const line of text.split('\n')) {
        if (line.startsWith('[msg] ')) {
          try {
            msgs.push(JSON.parse(line.slice(6)));
          } catch {}
        }
      }
      return msgs;
    };

    const flushLogs = async (newLogs: string) => {
      logs = newLogs;
      try {
        const msgs = extractMessages(logs);
        await db
          .update(evalTasks)
          .set({
            logs: logs.slice(-50000),
            messages: msgs.length > 0 ? JSON.stringify(msgs) : null,
          })
          .where(eq(evalTasks.id, taskId));
      } catch {}
    };

    let workDir: string | null = null;

    try {
      const result = await runSingleEval(evalDef, model, flushLogs);
      logs = result.logs;
      workDir = result.workDir;

      let judgeScore: number | null = null;
      let judgeVerdict: string | null = null;

      const spec = evalDef.judgeSpec;
      if (spec && !result.error) {
        const judgeSpecText = spec === 'USE_PROMPT' ? evalDef.prompt : spec;
        logs += '\n[phase] judge agent\n';
        logs += '  calling judge model...\n';
        await flushLogs(logs);

        try {
          const judgeResult = await judgeSpecAdherence(judgeSpecText, workDir, {
            agentOutput: result.output || undefined,
            agentLogs: logs || undefined,
          });
          judgeScore = judgeResult.adherenceScore;
          judgeVerdict = judgeResult.verdict;

          const implemented = judgeResult.requirements.filter(
            (r) => r.implemented,
          ).length;
          const notImplemented = judgeResult.requirements.filter(
            (r) => !r.implemented,
          ).length;
          logs += `  adherence score: ${judgeResult.adherenceScore}/10\n`;
          logs += `  verdict: ${judgeResult.verdict}\n`;
          logs += `  requirements checked: ${judgeResult.requirements.length}\n`;
          logs += `  implemented: ${implemented}, not implemented: ${notImplemented}\n`;
          if (judgeResult.missingRequirements.length > 0) {
            logs += '  missing:\n';
            for (const m of judgeResult.missingRequirements) {
              logs += `    - ${m}\n`;
            }
          }
          logs += `  reasoning: ${judgeResult.reasoning}\n`;
          logs += '[phase] judge complete\n';
        } catch (judgeErr) {
          logs += `  judge error: ${judgeErr instanceof Error ? judgeErr.message : String(judgeErr)}\n`;
          logs += '[phase] judge failed\n';
        }
        await flushLogs(logs);
      }

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
          logs: logs.slice(-50000),
          judgeScore,
          judgeVerdict,
          messages: result.messages ? JSON.stringify(result.messages) : null,
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
          logs: logs ? logs.slice(-50000) : null,
          completedAt,
        })
        .where(eq(evalTasks.id, taskId));
    } finally {
      if (workDir) cleanupDir(workDir);
    }
  });

  try {
    await withConcurrency(concurrency, jobs);

    const allTasks = await db
      .select()
      .from(evalTasks)
      .where(eq(evalTasks.runId, runId));

    // --- Comparative judge phase ---
    if (models.length >= 2) {
      const evalGroups = new Map<string, typeof allTasks>();
      for (const task of allTasks) {
        const list = evalGroups.get(task.evalName);
        if (list) list.push(task);
        else evalGroups.set(task.evalName, [task]);
      }

      for (const [evalName, tasks] of evalGroups) {
        const completedTasks = tasks.filter(
          (t) => t.status === 'completed' || t.status === 'failed',
        );
        if (completedTasks.length < 2) continue;

        const evalDef = getEvalBySlug(evalName);
        const spec = evalDef?.prompt ?? evalName;

        try {
          const entries = completedTasks.map((t) => ({
            model: t.model,
            output: t.output,
            judgeScore: t.judgeScore,
            judgeVerdict: t.judgeVerdict,
          }));

          const comparison = await judgeComparison(spec, entries);

          await db.insert(evalComparisons).values({
            runId,
            evalName,
            winnerModel: comparison.winnerModel,
            rankings: JSON.stringify(comparison.rankings),
            reasoning: comparison.reasoning,
          });
        } catch (err) {
          console.error(
            `Comparison judge failed for ${evalName}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }
    }

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

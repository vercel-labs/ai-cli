export async function register() {
  const p = globalThis.process;
  if (!p?.env || p.env.NEXT_RUNTIME !== 'nodejs') return;

  const fs = require('fs');
  const { eq } = require('drizzle-orm');
  const { db } = await import('@/lib/db');
  const { evalRuns, evalTasks } = await import('@/lib/db/schema');

  const log = (msg: string) => {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    try {
      p.stderr.write(`[instrumentation] ${msg}\n`);
    } catch {}
    try {
      fs.appendFileSync('/tmp/evals-server.log', line);
    } catch {}
  };

  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP', 'SIGQUIT']) {
    p.on(sig, () => log(`received ${sig}`));
  }
  p.on('beforeExit', (code: number) => log(`beforeExit code=${code}`));
  p.on('exit', (code: number) => log(`exit code=${code}`));
  p.on('uncaughtException', (err: Error) => {
    log(`uncaughtException: ${err.stack || err.message}`);
  });
  p.on('unhandledRejection', (reason: unknown) => {
    log(`unhandledRejection: ${reason}`);
  });

  log(`signal handlers registered (pid=${p.pid})`);

  try {
    await db
      .update(evalTasks)
      .set({
        status: 'failed',
        error: 'Server restarted while task was running',
      })
      .where(eq(evalTasks.status, 'running'));
    await db
      .update(evalTasks)
      .set({
        status: 'failed',
        error: 'Server restarted while task was pending',
      })
      .where(eq(evalTasks.status, 'pending'));
    await db
      .update(evalRuns)
      .set({ status: 'failed', completedAt: new Date() })
      .where(eq(evalRuns.status, 'running'));
    await db
      .update(evalRuns)
      .set({ status: 'failed', completedAt: new Date() })
      .where(eq(evalRuns.status, 'pending'));
  } catch (err) {
    log(`failed to clean orphaned tasks: ${err}`);
  }
}

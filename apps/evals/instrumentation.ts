export async function register() {
  const p = globalThis.process;

  const fs = await (async () => {
    try {
      return await import('fs');
    } catch {
      return null;
    }
  })();

  const earlyLog = (msg: string) => {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    try {
      p?.stderr?.write?.(`[instrumentation] ${msg}\n`);
    } catch {}
    try {
      fs?.appendFileSync?.('/tmp/evals-server.log', line);
    } catch {}
  };

  earlyLog(`register called: runtime=${p?.env?.NEXT_RUNTIME} pid=${p?.pid}`);

  if (!p?.env || p.env.NEXT_RUNTIME !== 'nodejs') return;

  const { eq } = await import('drizzle-orm');
  const { db } = await import('@/lib/db');
  const { evalRuns, evalTasks } = await import('@/lib/db/schema');

  const log = earlyLog;

  for (const sig of ['SIGTERM', 'SIGHUP', 'SIGQUIT']) {
    p.on(sig, () => log(`received ${sig}`));
  }
  p.on('SIGINT', () => {
    log('received SIGINT (ignored)');
  });
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

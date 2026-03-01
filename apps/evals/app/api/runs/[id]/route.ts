import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { evalRuns, evalTasks, evalComparisons } from '@/lib/db/schema';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const run = await db
    .select()
    .from(evalRuns)
    .where(eq(evalRuns.id, id))
    .limit(1);

  if (run.length === 0) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 });
  }

  const tasks = await db
    .select()
    .from(evalTasks)
    .where(eq(evalTasks.runId, id));

  const comparisons = await db
    .select()
    .from(evalComparisons)
    .where(eq(evalComparisons.runId, id));

  return NextResponse.json({ ...run[0], tasks, comparisons });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  await db.delete(evalComparisons).where(eq(evalComparisons.runId, id));
  await db.delete(evalTasks).where(eq(evalTasks.runId, id));
  await db.delete(evalRuns).where(eq(evalRuns.id, id));

  return NextResponse.json({ ok: true });
}

import { NextResponse } from 'next/server';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { evalRuns, evalTasks } from '@/lib/db/schema';
import { EVAL_REGISTRY, getEvalBySlug } from '@/lib/evals/registry';
import { executeRun } from '@/lib/evals/runner';

export async function GET() {
  const runs = await db
    .select({
      id: evalRuns.id,
      status: evalRuns.status,
      createdAt: evalRuns.createdAt,
      completedAt: evalRuns.completedAt,
      taskCount: sql<number>`count(${evalTasks.id})`.as('task_count'),
      completedCount:
        sql<number>`count(case when ${evalTasks.status} in ('completed', 'failed') then 1 end)`.as(
          'completed_count',
        ),
      passedCount:
        sql<number>`count(case when ${evalTasks.status} = 'completed' then 1 end)`.as(
          'passed_count',
        ),
      failedCount:
        sql<number>`count(case when ${evalTasks.status} = 'failed' then 1 end)`.as(
          'failed_count',
        ),
    })
    .from(evalRuns)
    .leftJoin(evalTasks, eq(evalTasks.runId, evalRuns.id))
    .groupBy(evalRuns.id)
    .orderBy(desc(evalRuns.createdAt))
    .limit(50);

  return NextResponse.json(runs);
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    models: string[];
    evals: string[];
  };

  if (!body.models?.length || !body.evals?.length) {
    return NextResponse.json(
      { error: 'models and evals arrays are required' },
      { status: 400 },
    );
  }

  const evalDefs = body.evals
    .map((slug) => getEvalBySlug(slug))
    .filter((e): e is (typeof EVAL_REGISTRY)[number] => e !== undefined);

  if (evalDefs.length === 0) {
    return NextResponse.json(
      { error: 'No valid evals specified' },
      { status: 400 },
    );
  }

  const [run] = await db
    .insert(evalRuns)
    .values({ status: 'pending' })
    .returning();

  // Fire-and-forget — execution runs in background
  executeRun(run.id, evalDefs, body.models).catch((err) => {
    console.error(`Run ${run.id} failed:`, err);
  });

  return NextResponse.json({ id: run.id }, { status: 201 });
}

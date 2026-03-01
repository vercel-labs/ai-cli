import Link from 'next/link';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { evalRuns, evalTasks } from '@/lib/db/schema';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

function statusVariant(status: string) {
  switch (status) {
    case 'completed':
      return 'default' as const;
    case 'running':
      return 'secondary' as const;
    case 'failed':
      return 'destructive' as const;
    default:
      return 'outline' as const;
  }
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function formatTime(date: Date | null): string {
  if (!date) return '—';
  return new Date(date).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const runs = await db
    .select({
      id: evalRuns.id,
      status: evalRuns.status,
      createdAt: evalRuns.createdAt,
      completedAt: evalRuns.completedAt,
      taskCount: sql<number>`count(${evalTasks.id})`.as('task_count'),
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

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Evals</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Run and monitor eval suites against different models.
          </p>
        </div>
        <Link href="/runs/new">
          <Button>New Run</Button>
        </Link>
      </div>

      {runs.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <p className="text-muted-foreground">No runs yet.</p>
          <Link href="/runs/new" className="mt-4">
            <Button variant="outline">Start your first run</Button>
          </Link>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Started</TableHead>
              <TableHead className="text-right">Tasks</TableHead>
              <TableHead className="text-right">Passed</TableHead>
              <TableHead className="text-right">Failed</TableHead>
              <TableHead className="text-right">Duration</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((run) => {
              const duration =
                run.completedAt && run.createdAt
                  ? new Date(run.completedAt).getTime() -
                    new Date(run.createdAt).getTime()
                  : null;
              return (
                <TableRow key={run.id}>
                  <TableCell>
                    <Link href={`/runs/${run.id}`}>
                      <Badge variant={statusVariant(run.status)}>
                        {run.status}
                      </Badge>
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <Link href={`/runs/${run.id}`}>
                      {formatTime(run.createdAt)}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {run.taskCount}
                  </TableCell>
                  <TableCell className="text-right font-mono text-green-500">
                    {run.passedCount}
                  </TableCell>
                  <TableCell className="text-right font-mono text-red-500">
                    {run.failedCount}
                  </TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">
                    {formatDuration(duration)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

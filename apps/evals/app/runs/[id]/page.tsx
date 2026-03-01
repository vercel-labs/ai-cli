'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getEvalBySlug } from '@/lib/evals/registry';

interface Task {
  id: string;
  evalName: string;
  model: string;
  status: string;
  tokens: number | null;
  cost: number | null;
  steps: number | null;
  toolCalls: number | null;
  durationMs: number | null;
  output: string | null;
  error: string | null;
  exitCode: number | null;
  judgeScore: number | null;
  judgeVerdict: string | null;
}

interface RunData {
  id: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  tasks: Task[];
}

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

function taskStatusLabel(status: string) {
  switch (status) {
    case 'completed':
      return 'PASS';
    case 'failed':
      return 'FAIL';
    case 'running':
      return 'RUNNING';
    default:
      return 'PENDING';
  }
}

function taskStatusColor(status: string) {
  switch (status) {
    case 'completed':
      return 'text-green-500';
    case 'failed':
      return 'text-red-500';
    case 'running':
      return 'text-yellow-500';
    default:
      return 'text-muted-foreground';
  }
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function formatCost(cost: number | null): string {
  if (cost == null) return '—';
  return `$${cost.toFixed(4)}`;
}

export default function RunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<RunData | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  const fetchRun = useCallback(async () => {
    const res = await fetch(`/api/runs/${id}`);
    if (res.ok) {
      const data = await res.json();
      setRun(data);
    }
  }, [id]);

  useEffect(() => {
    fetchRun();
  }, [fetchRun]);

  useEffect(() => {
    if (!id) return;
    if (run?.status === 'completed' || run?.status === 'failed') return;

    const evtSource = new EventSource(`/api/runs/${id}/stream`);

    evtSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as RunData;
        setRun(data);
        if (data.status === 'completed' || data.status === 'failed') {
          evtSource.close();
        }
      } catch {}
    };

    evtSource.onerror = () => {
      evtSource.close();
    };

    return () => evtSource.close();
  }, [id, run?.status]);

  if (!run) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-10">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  const models = [...new Set(run.tasks.map((t) => t.model))];
  const evalNames = [...new Set(run.tasks.map((t) => t.evalName))];

  const taskMap = new Map<string, Task>();
  for (const t of run.tasks) {
    taskMap.set(`${t.evalName}::${t.model}`, t);
  }

  const duration =
    run.completedAt && run.createdAt
      ? new Date(run.completedAt).getTime() - new Date(run.createdAt).getTime()
      : run.createdAt
        ? Date.now() - new Date(run.createdAt).getTime()
        : null;

  const passed = run.tasks.filter((t) => t.status === 'completed').length;
  const failed = run.tasks.filter((t) => t.status === 'failed').length;
  const running = run.tasks.filter((t) => t.status === 'running').length;

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-2">
        <Link
          href="/"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          &larr; All Runs
        </Link>
      </div>

      <div className="mb-8 flex items-center gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Run</h1>
        <Badge variant={statusVariant(run.status)}>{run.status}</Badge>
        <div className="ml-auto flex items-center gap-6 text-sm text-muted-foreground font-mono">
          <span>{run.tasks.length} tasks</span>
          <span className="text-green-500">{passed} passed</span>
          {failed > 0 && <span className="text-red-500">{failed} failed</span>}
          {running > 0 && (
            <span className="text-yellow-500">{running} running</span>
          )}
          <span>{formatDuration(duration)}</span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[200px]">Eval</TableHead>
              {models.map((model) => (
                <TableHead
                  key={model}
                  className="min-w-[180px] text-center font-mono text-xs"
                >
                  {model.split('/').pop()}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {evalNames.map((evalName) => {
              const def = getEvalBySlug(evalName);
              return (
                <TableRow key={evalName}>
                  <TableCell>
                    <div className="font-medium text-sm">
                      {def?.name ?? evalName}
                    </div>
                    {def && (
                      <div className="text-xs text-muted-foreground">
                        {def.description}
                      </div>
                    )}
                  </TableCell>
                  {models.map((model) => {
                    const task = taskMap.get(`${evalName}::${model}`);
                    if (!task) {
                      return (
                        <TableCell key={model} className="text-center">
                          —
                        </TableCell>
                      );
                    }
                    return (
                      <TableCell key={model} className="text-center">
                        <button
                          type="button"
                          onClick={() => setSelectedTask(task)}
                          className="inline-flex flex-col items-center gap-0.5 rounded px-2 py-1 hover:bg-muted transition-colors cursor-pointer"
                        >
                          <span
                            className={`text-xs font-bold ${taskStatusColor(task.status)}`}
                          >
                            {task.status === 'running' && (
                              <span className="mr-1 inline-block h-2 w-2 animate-pulse rounded-full bg-yellow-500" />
                            )}
                            {taskStatusLabel(task.status)}
                          </span>
                          {task.status === 'completed' && (
                            <span className="text-[10px] text-muted-foreground font-mono">
                              {formatDuration(task.durationMs)} ·{' '}
                              {formatCost(task.cost)}
                            </span>
                          )}
                          {task.status === 'failed' && task.error && (
                            <span className="text-[10px] text-muted-foreground truncate max-w-[140px]">
                              {task.error.slice(0, 40)}
                            </span>
                          )}
                        </button>
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog
        open={selectedTask !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedTask(null);
        }}
      >
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          {selectedTask && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-3">
                  <span>
                    {getEvalBySlug(selectedTask.evalName)?.name ??
                      selectedTask.evalName}
                  </span>
                  <Badge variant={statusVariant(selectedTask.status)}>
                    {taskStatusLabel(selectedTask.status)}
                  </Badge>
                </DialogTitle>
                <p className="text-sm text-muted-foreground font-mono">
                  {selectedTask.model}
                </p>
              </DialogHeader>

              <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <Stat label="Tokens" value={selectedTask.tokens} />
                <Stat label="Cost" value={formatCost(selectedTask.cost)} />
                <Stat label="Steps" value={selectedTask.steps} />
                <Stat label="Tool Calls" value={selectedTask.toolCalls} />
                <Stat
                  label="Duration"
                  value={formatDuration(selectedTask.durationMs)}
                />
                <Stat label="Exit Code" value={selectedTask.exitCode} />
                <Stat label="Judge Score" value={selectedTask.judgeScore} />
                <Stat label="Judge Verdict" value={selectedTask.judgeVerdict} />
              </div>

              {selectedTask.error && (
                <div className="mt-4">
                  <h3 className="mb-1 text-sm font-medium text-red-500">
                    Error
                  </h3>
                  <pre className="rounded bg-muted p-3 text-xs whitespace-pre-wrap">
                    {selectedTask.error}
                  </pre>
                </div>
              )}

              {selectedTask.output && (
                <div className="mt-4">
                  <h3 className="mb-1 text-sm font-medium">Output</h3>
                  <pre className="rounded bg-muted p-3 text-xs whitespace-pre-wrap max-h-[300px] overflow-y-auto">
                    {selectedTask.output}
                  </pre>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-mono text-sm">{value ?? '—'}</div>
    </div>
  );
}

'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import { getEvalBySlug } from '@/lib/evals/registry';

export interface Task {
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
  logs: string | null;
  judgeScore: number | null;
  judgeVerdict: string | null;
}

export interface RunData {
  id: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  tasks: Task[];
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

export function RunDetail({
  runId,
  evalId,
}: {
  runId: string;
  evalId?: string;
}) {
  const router = useRouter();
  const [run, setRun] = useState<RunData | null>(null);
  const [prevRunId, setPrevRunId] = useState(runId);
  if (prevRunId !== runId) {
    setPrevRunId(runId);
    setRun(null);
  }

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const res = await fetch(`/api/runs/${runId}`);
      if (res.ok && !cancelled) {
        setRun(await res.json());
      }
    };
    load();
    const interval = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [runId]);

  const handleSelectTask = useCallback(
    (taskId: string) => {
      router.push(`/runs/${runId}/evals/${taskId}`, { scroll: false });
    },
    [router, runId],
  );

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (run?.completedAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [run?.completedAt]);

  if (!run) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground text-sm">Loading...</p>
      </div>
    );
  }

  const selectedTask = evalId
    ? (run.tasks.find((t) => t.id === evalId) ?? null)
    : null;

  const passed = run.tasks.filter((t) => t.status === 'completed').length;
  const failed = run.tasks.filter((t) => t.status === 'failed').length;
  const running = run.tasks.filter((t) => t.status === 'running').length;

  const duration =
    run.completedAt && run.createdAt
      ? new Date(run.completedAt).getTime() - new Date(run.createdAt).getTime()
      : run.createdAt
        ? now - new Date(run.createdAt).getTime()
        : null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b px-4 py-2">
        <div className="flex items-center gap-3">
          <Badge variant={statusVariant(run.status)}>{run.status}</Badge>
          <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono">
            <span>{run.tasks.length} tasks</span>
            <span className="text-green-500">{passed}P</span>
            {failed > 0 && <span className="text-red-500">{failed}F</span>}
            {running > 0 && <span className="text-yellow-500">{running}R</span>}
            <span>{formatDuration(duration)}</span>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <ResizablePanelGroup orientation="horizontal" id="eval-detail-layout">
          <ResizablePanel
            id="task-list"
            defaultSize="30%"
            minSize="20%"
            maxSize="50%"
          >
            <TaskList
              tasks={run.tasks}
              selectedId={evalId ?? null}
              onSelect={handleSelectTask}
            />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel id="task-detail" defaultSize="70%" minSize="50%">
            {selectedTask ? (
              <TaskDetail task={selectedTask} />
            ) : (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                <p className="text-sm">Select an eval to view details</p>
              </div>
            )}
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}

function TaskList({
  tasks,
  selectedId,
  onSelect,
}: {
  tasks: Task[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {tasks.map((task) => {
        const def = getEvalBySlug(task.evalName);
        const isSelected = selectedId === task.id;
        return (
          <button
            key={task.id}
            type="button"
            onClick={() => onSelect(task.id)}
            className={`w-full text-left px-4 py-3 border-b transition-colors cursor-pointer hover:bg-accent/50 ${
              isSelected ? 'bg-accent' : ''
            }`}
          >
            <div className="flex items-center gap-2 mb-0.5">
              <span
                className={`text-[11px] font-bold ${taskStatusColor(task.status)}`}
              >
                {task.status === 'running' && (
                  <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-yellow-500" />
                )}
                {taskStatusLabel(task.status)}
              </span>
              <span className="ml-auto text-[10px] text-muted-foreground font-mono">
                {formatDuration(task.durationMs)}
              </span>
            </div>
            <div className="text-sm font-medium truncate">
              {def?.name ?? task.evalName}
            </div>
            <div className="text-[11px] text-muted-foreground font-mono truncate">
              {task.model.split('/').pop()}
            </div>
          </button>
        );
      })}
      {tasks.length === 0 && (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          No tasks
        </div>
      )}
    </div>
  );
}

function TaskDetail({ task }: { task: Task }) {
  const def = getEvalBySlug(task.evalName);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="shrink-0 border-b px-6 py-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold tracking-tight">
            {def?.name ?? task.evalName}
          </h2>
          <Badge variant={statusVariant(task.status)}>
            {taskStatusLabel(task.status)}
          </Badge>
        </div>
        {def && (
          <p className="text-sm text-muted-foreground mt-1">
            {def.description}
          </p>
        )}
        <p className="text-xs text-muted-foreground font-mono mt-1">
          {task.model}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
        {def?.criteria && def.criteria.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-medium">What this eval checks</h3>
            <ul className="space-y-1">
              {def.criteria.map((criterion) => (
                <li
                  key={criterion}
                  className="flex items-start gap-2 text-xs text-muted-foreground"
                >
                  <span className="mt-0.5 shrink-0">•</span>
                  <span>{criterion}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Stat label="Tokens" value={task.tokens} />
          <Stat label="Cost" value={formatCost(task.cost)} />
          <Stat label="Steps" value={task.steps} />
          <Stat label="Tool Calls" value={task.toolCalls} />
          <Stat label="Duration" value={formatDuration(task.durationMs)} />
          <Stat label="Exit Code" value={task.exitCode} />
          <Stat label="Judge Score" value={task.judgeScore} />
          <Stat label="Judge Verdict" value={task.judgeVerdict} />
        </div>

        {def?.prompt && (
          <div>
            <h3 className="mb-1 text-sm font-medium">Prompt</h3>
            <pre className="rounded bg-muted p-3 text-xs whitespace-pre-wrap max-h-[200px] overflow-y-auto">
              {def.prompt}
            </pre>
          </div>
        )}

        {task.error && (
          <div>
            <h3 className="mb-1 text-sm font-medium text-red-500">Error</h3>
            <pre className="rounded bg-muted p-3 text-xs whitespace-pre-wrap">
              {task.error}
            </pre>
          </div>
        )}

        {task.output && (
          <div>
            <h3 className="mb-1 text-sm font-medium">Output</h3>
            <pre className="rounded bg-muted p-3 text-xs whitespace-pre-wrap max-h-[300px] overflow-y-auto">
              {task.output}
            </pre>
          </div>
        )}

        {task.logs && (
          <div>
            <h3 className="mb-1 text-sm font-medium flex items-center gap-2">
              Logs
              {task.status === 'running' && (
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-yellow-500" />
              )}
            </h3>
            <LogViewer logs={task.logs} isLive={task.status === 'running'} />
          </div>
        )}
      </div>
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

function LogViewer({ logs, isLive }: { logs: string; isLive: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wasAtBottomRef = useRef(true);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !isLive) return;
    if (wasAtBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [logs, isLive]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    wasAtBottomRef.current = atBottom;
  };

  const lines = logs.split('\n');

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="rounded bg-muted p-3 text-xs whitespace-pre-wrap max-h-[500px] overflow-y-auto font-mono"
    >
      {lines.map((line, i) => {
        if (line.startsWith('[phase]')) {
          const label = line.slice('[phase] '.length);
          return (
            <div
              key={i}
              className="mt-3 mb-1 border-t border-border pt-2 text-[11px] font-semibold uppercase tracking-wider text-blue-400 first:mt-0 first:border-t-0 first:pt-0"
            >
              {label}
            </div>
          );
        }
        return (
          <div key={i} className="text-muted-foreground">
            {line}
          </div>
        );
      })}
    </div>
  );
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

'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight, ChevronDown } from 'lucide-react';
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

interface RunSummary {
  id: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  taskCount: number;
  passedCount: number;
  failedCount: number;
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

function formatRunDate(date: string): string {
  const d = new Date(date);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function aggregateStatus(tasks: Task[]): string {
  if (tasks.some((t) => t.status === 'running')) return 'running';
  if (tasks.some((t) => t.status === 'pending')) return 'pending';
  if (tasks.every((t) => t.status === 'completed')) return 'completed';
  if (tasks.some((t) => t.status === 'failed')) return 'failed';
  return 'completed';
}

export function RunDetail({
  runId,
  evalId,
}: {
  runId: string;
  evalId?: string;
}) {
  const router = useRouter();
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [runDataMap, setRunDataMap] = useState<Record<string, RunData>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const lastAutoExpandedRunId = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const res = await fetch('/api/runs');
      if (res.ok && !cancelled) setRuns(await res.json());
    };
    load();
    const interval = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const res = await fetch(`/api/runs/${runId}`);
      if (res.ok && !cancelled) {
        const data: RunData = await res.json();
        setRunDataMap((prev) => ({ ...prev, [runId]: data }));
      }
    };
    load();
    const interval = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [runId]);

  useEffect(() => {
    const runData = runDataMap[runId];
    if (!runData || lastAutoExpandedRunId.current === runId) return;
    lastAutoExpandedRunId.current = runId;
    setExpanded((prev) => {
      const next = new Set(prev);
      next.add(`run-${runId}`);
      if (evalId) {
        const task = runData.tasks.find((t) => t.id === evalId);
        if (task) next.add(`model-${runId}-${task.model}`);
      }
      return next;
    });
  }, [runId, evalId, runDataMap]);

  const fetchRunData = useCallback(async (id: string) => {
    const res = await fetch(`/api/runs/${id}`);
    if (res.ok) {
      const data: RunData = await res.json();
      setRunDataMap((prev) => ({ ...prev, [id]: data }));
    }
  }, []);

  const handleToggle = useCallback(
    (key: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
          if (key.startsWith('run-')) {
            const expandedRunId = key.slice(4);
            if (!runDataMap[expandedRunId]) fetchRunData(expandedRunId);
          }
        }
        return next;
      });
    },
    [runDataMap, fetchRunData],
  );

  const handleSelectTask = useCallback(
    (taskRunId: string, taskId: string) => {
      router.push(`/runs/${taskRunId}/evals/${taskId}`, { scroll: false });
    },
    [router],
  );

  const currentRun = runDataMap[runId] ?? null;
  const selectedTask =
    evalId && currentRun
      ? (currentRun.tasks.find((t) => t.id === evalId) ?? null)
      : null;

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (currentRun?.completedAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [currentRun?.completedAt]);

  if (runs.length === 0 && !currentRun) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground text-sm">Loading...</p>
      </div>
    );
  }

  const passed =
    currentRun?.tasks.filter((t) => t.status === 'completed').length ?? 0;
  const failed =
    currentRun?.tasks.filter((t) => t.status === 'failed').length ?? 0;
  const running =
    currentRun?.tasks.filter((t) => t.status === 'running').length ?? 0;

  const duration =
    currentRun?.completedAt && currentRun.createdAt
      ? new Date(currentRun.completedAt).getTime() -
        new Date(currentRun.createdAt).getTime()
      : currentRun?.createdAt
        ? now - new Date(currentRun.createdAt).getTime()
        : null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {currentRun && (
        <div className="shrink-0 border-b px-4 py-2">
          <div className="flex items-center gap-3">
            <Badge variant={statusVariant(currentRun.status)}>
              {currentRun.status}
            </Badge>
            <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono">
              <span>{currentRun.tasks.length} tasks</span>
              <span className="text-green-500">{passed}P</span>
              {failed > 0 && <span className="text-red-500">{failed}F</span>}
              {running > 0 && (
                <span className="text-yellow-500">{running}R</span>
              )}
              <span>{formatDuration(duration)}</span>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0">
        <ResizablePanelGroup orientation="horizontal" id="eval-detail-layout">
          <ResizablePanel
            id="task-list"
            defaultSize="30%"
            minSize="20%"
            maxSize="50%"
          >
            <TaskTree
              runs={runs}
              runDataMap={runDataMap}
              selectedRunId={runId}
              selectedTaskId={evalId ?? null}
              expanded={expanded}
              onToggle={handleToggle}
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

function TaskTree({
  runs,
  runDataMap,
  selectedRunId,
  selectedTaskId,
  expanded,
  onToggle,
  onSelect,
}: {
  runs: RunSummary[];
  runDataMap: Record<string, RunData>;
  selectedRunId: string;
  selectedTaskId: string | null;
  expanded: Set<string>;
  onToggle: (key: string) => void;
  onSelect: (runId: string, taskId: string) => void;
}) {
  return (
    <div className="flex h-full flex-col overflow-y-auto text-sm">
      {runs.map((run) => {
        const runKey = `run-${run.id}`;
        const isRunExpanded = expanded.has(runKey);
        const runData = runDataMap[run.id];
        const isActiveRun = run.id === selectedRunId;

        const modelGroups = new Map<string, Task[]>();
        if (runData) {
          for (const task of runData.tasks) {
            const list = modelGroups.get(task.model);
            if (list) list.push(task);
            else modelGroups.set(task.model, [task]);
          }
        }

        return (
          <div key={run.id}>
            <button
              type="button"
              onClick={() => onToggle(runKey)}
              className={`w-full text-left px-3 py-2 border-b transition-colors cursor-pointer hover:bg-accent/50 flex items-center gap-2 ${
                isActiveRun && !selectedTaskId ? 'bg-accent/30' : ''
              }`}
            >
              {isRunExpanded ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium">
                    {formatRunDate(run.createdAt)}
                  </span>
                  <span
                    className={`text-[10px] font-bold ${taskStatusColor(run.status)}`}
                  >
                    {run.status === 'running' && (
                      <span className="mr-0.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-yellow-500" />
                    )}
                    {run.status.toUpperCase()}
                  </span>
                </div>
                <div className="text-[10px] text-muted-foreground font-mono">
                  {run.passedCount}P / {run.failedCount}F / {run.taskCount}{' '}
                  total
                </div>
              </div>
            </button>

            {isRunExpanded &&
              runData &&
              Array.from(modelGroups.entries()).map(([model, tasks]) => {
                const modelKey = `model-${run.id}-${model}`;
                const isModelExpanded = expanded.has(modelKey);
                const shortModel = model.split('/').pop() ?? model;
                const modelStatus = aggregateStatus(tasks);
                const modelPassed = tasks.filter(
                  (t) => t.status === 'completed',
                ).length;
                const modelFailed = tasks.filter(
                  (t) => t.status === 'failed',
                ).length;

                return (
                  <div key={modelKey}>
                    <button
                      type="button"
                      onClick={() => onToggle(modelKey)}
                      className="w-full text-left pl-7 pr-3 py-1.5 border-b transition-colors cursor-pointer hover:bg-accent/50 flex items-center gap-2"
                    >
                      {isModelExpanded ? (
                        <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                      )}
                      <span
                        className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                          modelStatus === 'completed'
                            ? 'bg-green-500'
                            : modelStatus === 'failed'
                              ? 'bg-red-500'
                              : modelStatus === 'running'
                                ? 'bg-yellow-500 animate-pulse'
                                : 'bg-muted-foreground'
                        }`}
                      />
                      <span className="text-xs font-mono truncate">
                        {shortModel}
                      </span>
                      <span className="ml-auto text-[10px] text-muted-foreground font-mono shrink-0">
                        {modelPassed}P
                        {modelFailed > 0 ? ` / ${modelFailed}F` : ''}
                      </span>
                    </button>

                    {isModelExpanded &&
                      tasks.map((task) => {
                        const def = getEvalBySlug(task.evalName);
                        const isSelected =
                          selectedTaskId === task.id &&
                          selectedRunId === run.id;

                        return (
                          <button
                            key={task.id}
                            type="button"
                            onClick={() => onSelect(run.id, task.id)}
                            className={`w-full text-left pl-14 pr-3 py-1.5 border-b transition-colors cursor-pointer hover:bg-accent/50 flex items-center gap-2 ${
                              isSelected ? 'bg-accent' : ''
                            }`}
                          >
                            <span
                              className={`text-[10px] font-bold shrink-0 ${taskStatusColor(task.status)}`}
                            >
                              {task.status === 'running' && (
                                <span className="mr-0.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-yellow-500" />
                              )}
                              {taskStatusLabel(task.status)}
                            </span>
                            <span className="text-xs truncate">
                              {def?.name ?? task.evalName}
                            </span>
                            <span className="ml-auto text-[10px] text-muted-foreground font-mono shrink-0">
                              {formatDuration(task.durationMs)}
                            </span>
                          </button>
                        );
                      })}
                  </div>
                );
              })}

            {isRunExpanded && !runData && (
              <div className="pl-7 py-3 border-b text-xs text-muted-foreground">
                Loading…
              </div>
            )}
          </div>
        );
      })}
      {runs.length === 0 && (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          No runs
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

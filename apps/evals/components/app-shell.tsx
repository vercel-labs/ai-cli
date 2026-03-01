'use client';

import { useEffect, useState, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronRight, ChevronDown, Trash2, RotateCw } from 'lucide-react';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { getEvalBySlug } from '@/lib/evals/registry';
import type { Task, RunData, Comparison } from '@/components/run-detail';

interface RunSummary {
  id: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  taskCount: number;
  passedCount: number;
  failedCount: number;
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 60_000) return `${(ms / 1000).toFixed(0)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function taskDuration(task: Task, now: number): number | null {
  if (task.durationMs != null) return task.durationMs;
  if (task.startedAt && !task.completedAt) {
    return now - new Date(task.startedAt).getTime();
  }
  return null;
}

function formatRunDate(date: string): string {
  const d = new Date(date);
  const now = new Date();
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  if (isToday) {
    return d.toLocaleString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }
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

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const runMatch = pathname.match(/^\/runs\/([^/]+)/);
  const evalMatch = pathname.match(/^\/runs\/[^/]+\/evals\/([^/]+)/);
  const compareMatch = pathname.match(/^\/runs\/[^/]+\/compare\/([^/]+)/);
  const selectedRunId =
    runMatch?.[1] === 'new' ? null : (runMatch?.[1] ?? null);
  const selectedTaskId = evalMatch?.[1] ?? null;
  const selectedComparisonId = compareMatch?.[1] ?? null;

  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [runDataMap, setRunDataMap] = useState<Record<string, RunData>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [lastAutoExpandedRunId, setLastAutoExpandedRunId] = useState<
    string | null
  >(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const hasActive = runs.some(
      (r) => r.status === 'running' || r.status === 'pending',
    );
    if (!hasActive) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [runs]);

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
    if (!selectedRunId) return;
    let cancelled = false;
    const load = async () => {
      const res = await fetch(`/api/runs/${selectedRunId}`);
      if (res.ok && !cancelled) {
        const data: RunData = await res.json();
        setRunDataMap((prev) => ({ ...prev, [selectedRunId]: data }));
      }
    };
    load();
    const interval = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selectedRunId]);

  if (
    selectedRunId &&
    selectedRunId !== lastAutoExpandedRunId &&
    runDataMap[selectedRunId]
  ) {
    const runData = runDataMap[selectedRunId];
    setLastAutoExpandedRunId(selectedRunId);
    const next = new Set(expanded);
    next.add(`run-${selectedRunId}`);
    if (selectedTaskId) {
      const task = runData.tasks.find((t) => t.id === selectedTaskId);
      if (task) next.add(`model-${selectedRunId}-${task.model}`);
    }
    setExpanded(next);
  }

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

  const handleSelectComparison = useCallback(
    (compRunId: string, comparisonId: string) => {
      router.push(`/runs/${compRunId}/compare/${comparisonId}`, {
        scroll: false,
      });
    },
    [router],
  );

  const [deleteRunId, setDeleteRunId] = useState<string | null>(null);

  const handleDeleteRun = useCallback(async () => {
    if (!deleteRunId) return;
    await fetch(`/api/runs/${deleteRunId}`, { method: 'DELETE' });
    setRuns((prev) => prev.filter((r) => r.id !== deleteRunId));
    setRunDataMap((prev) => {
      const next = { ...prev };
      delete next[deleteRunId];
      return next;
    });
    if (selectedRunId === deleteRunId) {
      router.push('/', { scroll: false });
    }
    setDeleteRunId(null);
  }, [deleteRunId, selectedRunId, router]);

  const [rerunRunId, setRerunRunId] = useState<string | null>(null);

  const handleRerunRun = useCallback(async () => {
    if (!rerunRunId) return;
    const data = runDataMap[rerunRunId];
    if (!data) return;

    const models = [...new Set(data.tasks.map((t) => t.model))];
    const evals = [...new Set(data.tasks.map((t) => t.evalName))];

    const res = await fetch('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ models, evals }),
    });

    if (res.ok) {
      const { id } = await res.json();
      setRerunRunId(null);
      router.push(`/runs/${id}`, { scroll: false });
      const runsRes = await fetch('/api/runs');
      if (runsRes.ok) setRuns(await runsRes.json());
    }
  }, [rerunRunId, runDataMap, router]);

  return (
    <>
      <ResizablePanelGroup orientation="horizontal" id="app-layout">
        <ResizablePanel
          id="sidebar"
          defaultSize="25%"
          minSize="15%"
          maxSize="40%"
        >
          <TaskTree
            runs={runs}
            runDataMap={runDataMap}
            selectedRunId={selectedRunId}
            selectedTaskId={selectedTaskId}
            selectedComparisonId={selectedComparisonId}
            expanded={expanded}
            now={now}
            onToggle={handleToggle}
            onSelect={handleSelectTask}
            onSelectComparison={handleSelectComparison}
            onDeleteRun={setDeleteRunId}
            onRerunRun={setRerunRunId}
          />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel id="content" defaultSize="75%" minSize="50%">
          {children}
        </ResizablePanel>
      </ResizablePanelGroup>

      <Dialog
        open={deleteRunId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteRunId(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete run</DialogTitle>
            <DialogDescription>
              This will permanently delete the run and all its tasks, logs, and
              comparisons. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteRunId(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteRun}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={rerunRunId !== null}
        onOpenChange={(open) => {
          if (!open) setRerunRunId(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rerun</DialogTitle>
            <DialogDescription>
              This will create a new run with the same models and evals.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRerunRunId(null)}>
              Cancel
            </Button>
            <Button onClick={handleRerunRun}>Rerun</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function TaskTree({
  runs,
  runDataMap,
  selectedRunId,
  selectedTaskId,
  selectedComparisonId,
  expanded,
  now,
  onToggle,
  onSelect,
  onSelectComparison,
  onDeleteRun,
  onRerunRun,
}: {
  runs: RunSummary[];
  runDataMap: Record<string, RunData>;
  selectedRunId: string | null;
  selectedTaskId: string | null;
  selectedComparisonId: string | null;
  expanded: Set<string>;
  now: number;
  onToggle: (key: string) => void;
  onSelect: (runId: string, taskId: string) => void;
  onSelectComparison: (runId: string, comparisonId: string) => void;
  onDeleteRun: (runId: string) => void;
  onRerunRun: (runId: string) => void;
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
          <div key={run.id} className="border-b last:border-b-0">
            <div
              className={`group flex items-center gap-2 px-3 py-2 transition-colors hover:bg-accent/50 ${
                isActiveRun && !selectedTaskId ? 'bg-accent/30' : ''
              }`}
            >
              <button
                type="button"
                onClick={() => onToggle(runKey)}
                className="flex flex-1 min-w-0 items-center gap-2 cursor-pointer text-left"
              >
                {isRunExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                <span
                  className={`text-xs font-medium ${run.status === 'running' || run.status === 'pending' ? 'shimmer-text' : ''}`}
                >
                  {formatRunDate(run.createdAt)}
                </span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRerunRun(run.id);
                }}
                className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer text-muted-foreground hover:text-foreground"
              >
                <RotateCw className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteRun(run.id);
                }}
                className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>

            {isRunExpanded &&
              runData &&
              Array.from(modelGroups.entries())
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([model, tasks]) => {
                  const modelKey = `model-${run.id}-${model}`;
                  const isModelExpanded = expanded.has(modelKey);
                  const shortModel = model.split('/').pop() ?? model;
                  const modelStatus = aggregateStatus(tasks);

                  return (
                    <div key={modelKey}>
                      <button
                        type="button"
                        onClick={() => onToggle(modelKey)}
                        className="w-full text-left pl-7 pr-3 py-1.5 transition-colors cursor-pointer hover:bg-accent/50 flex items-center gap-2"
                      >
                        {isModelExpanded ? (
                          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                        )}
                        <span
                          className={`text-xs font-mono truncate ${modelStatus === 'running' || modelStatus === 'pending' ? 'shimmer-text' : ''}`}
                        >
                          {shortModel}
                        </span>
                      </button>

                      {isModelExpanded &&
                        [...tasks]
                          .sort((a, b) => a.evalName.localeCompare(b.evalName))
                          .map((task) => {
                            const def = getEvalBySlug(task.evalName);
                            const isSelected =
                              selectedTaskId === task.id &&
                              selectedRunId === run.id;

                            return (
                              <button
                                key={task.id}
                                type="button"
                                onClick={() => onSelect(run.id, task.id)}
                                className={`w-full text-left pl-14 pr-3 py-1.5 transition-colors cursor-pointer hover:bg-accent/50 flex items-center gap-2 ${
                                  isSelected ? 'bg-accent' : ''
                                }`}
                              >
                                <span
                                  className={`text-xs truncate ${task.status === 'running' || task.status === 'pending' ? 'shimmer-text' : ''}`}
                                >
                                  {def?.name ?? task.evalName}
                                </span>
                                <span
                                  className={`ml-auto text-[10px] font-mono shrink-0 ${task.status === 'running' || task.status === 'pending' ? 'shimmer-text' : 'text-muted-foreground'}`}
                                >
                                  {formatDuration(taskDuration(task, now))}
                                </span>
                              </button>
                            );
                          })}
                    </div>
                  );
                })}

            {isRunExpanded &&
              runData &&
              runData.comparisons &&
              runData.comparisons.length > 0 && (
                <ComparisonTreeNode
                  runId={run.id}
                  comparisons={runData.comparisons}
                  expanded={expanded}
                  selectedComparisonId={selectedComparisonId}
                  selectedRunId={selectedRunId}
                  onToggle={onToggle}
                  onSelectComparison={onSelectComparison}
                />
              )}

            {isRunExpanded && !runData && (
              <div className="pl-7 py-3 text-xs text-muted-foreground">
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

function ComparisonTreeNode({
  runId,
  comparisons,
  expanded,
  selectedComparisonId,
  selectedRunId,
  onToggle,
  onSelectComparison,
}: {
  runId: string;
  comparisons: Comparison[];
  expanded: Set<string>;
  selectedComparisonId: string | null;
  selectedRunId: string | null;
  onToggle: (key: string) => void;
  onSelectComparison: (runId: string, comparisonId: string) => void;
}) {
  const nodeKey = `compare-${runId}`;
  const isExpanded = expanded.has(nodeKey);

  const sorted = [...comparisons].sort((a, b) =>
    a.evalName.localeCompare(b.evalName),
  );

  return (
    <div>
      <button
        type="button"
        onClick={() => onToggle(nodeKey)}
        className="w-full text-left pl-7 pr-3 py-1.5 transition-colors cursor-pointer hover:bg-accent/50 flex items-center gap-2"
      >
        {isExpanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        <span className="text-xs font-medium truncate">Final Comparison</span>
        <span className="ml-auto text-[10px] text-muted-foreground font-mono shrink-0">
          {comparisons.length}
        </span>
      </button>

      {isExpanded &&
        sorted.map((comp) => {
          const def = getEvalBySlug(comp.evalName);
          const isSelected =
            selectedComparisonId === comp.id && selectedRunId === runId;
          const winnerShort =
            comp.winnerModel.split('/').pop() ?? comp.winnerModel;

          return (
            <button
              key={comp.id}
              type="button"
              onClick={() => onSelectComparison(runId, comp.id)}
              className={`w-full text-left pl-14 pr-3 py-1.5 transition-colors cursor-pointer hover:bg-accent/50 flex items-center gap-2 ${
                isSelected ? 'bg-accent' : ''
              }`}
            >
              <span className="text-xs truncate">
                {def?.name ?? comp.evalName}
              </span>
              <span className="ml-auto text-[10px] text-muted-foreground font-mono shrink-0">
                {winnerShort}
              </span>
            </button>
          );
        })}
    </div>
  );
}

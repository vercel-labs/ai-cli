'use client';

import { useEffect, useState, useRef } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
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
  messages: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

interface ChatMessage {
  role: 'assistant' | 'tool' | 'reasoning' | 'error';
  content: string;
}

export interface Comparison {
  id: string;
  evalName: string;
  winnerModel: string;
  rankings: string;
  reasoning: string;
  createdAt: string;
}

interface ComparisonRanking {
  model: string;
  rank: number;
  score: number;
  reasoning: string;
}

export interface RunData {
  id: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  tasks: Task[];
  comparisons?: Comparison[];
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
  comparisonId,
}: {
  runId: string;
  evalId?: string;
  comparisonId?: string;
}) {
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
      if (res.ok && !cancelled) setRun(await res.json());
    };
    load();
    const interval = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [runId]);

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

  const selectedComparison = comparisonId
    ? (run.comparisons?.find((c) => c.id === comparisonId) ?? null)
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
        {selectedComparison ? (
          <ComparisonDetail comparison={selectedComparison} />
        ) : selectedTask ? (
          <TaskDetail task={selectedTask} />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <p className="text-sm">Select an eval to view details</p>
          </div>
        )}
      </div>
    </div>
  );
}

function TaskDetail({ task }: { task: Task }) {
  const def = getEvalBySlug(task.evalName);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'logs' | 'chat'>('logs');

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="shrink-0 border-b px-6 py-3">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold tracking-tight">
            {def?.name ?? task.evalName}
          </h2>
          <Badge variant={statusVariant(task.status)}>
            {taskStatusLabel(task.status)}
          </Badge>
          <span className="text-xs text-muted-foreground font-mono">
            {task.model.split('/').pop()}
          </span>
          <span className="text-xs text-muted-foreground font-mono">
            {formatDuration(task.durationMs)}
          </span>
          {task.judgeScore != null && (
            <span className="text-xs font-mono font-bold text-muted-foreground">
              Judge:{' '}
              <span
                className={
                  task.judgeVerdict === 'pass'
                    ? 'text-green-500'
                    : 'text-red-500'
                }
              >
                {task.judgeScore}/10 {task.judgeVerdict}
              </span>
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
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

        <div>
          <div className="flex items-center gap-1 mb-2">
            <button
              type="button"
              onClick={() => setActiveTab('logs')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                activeTab === 'logs'
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Logs
              {task.status === 'running' && (
                <span className="ml-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-yellow-500" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('chat')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                activeTab === 'chat'
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Chat
            </button>
          </div>

          {activeTab === 'logs' && task.logs && (
            <LogViewer logs={task.logs} isLive={task.status === 'running'} />
          )}
          {activeTab === 'logs' && !task.logs && (
            <div className="text-xs text-muted-foreground py-4">
              No logs available
            </div>
          )}
          {activeTab === 'chat' && <ChatView messages={task.messages} />}
        </div>

        <div className="border-t pt-3">
          <button
            type="button"
            onClick={() => setDetailsOpen((o) => !o)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            {detailsOpen ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            Details
          </button>

          {detailsOpen && (
            <div className="mt-3 space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <Stat label="Tokens" value={task.tokens} />
                <Stat label="Cost" value={formatCost(task.cost)} />
                <Stat label="Steps" value={task.steps} />
                <Stat label="Tool Calls" value={task.toolCalls} />
                <Stat
                  label="Duration"
                  value={formatDuration(task.durationMs)}
                />
                <Stat label="Exit Code" value={task.exitCode} />
                <Stat label="Judge Score" value={task.judgeScore} />
                <Stat label="Judge Verdict" value={task.judgeVerdict} />
              </div>

              {def?.criteria && def.criteria.length > 0 && (
                <div>
                  <h3 className="mb-2 text-sm font-medium">
                    What this eval checks
                  </h3>
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

              {def?.prompt && (
                <div>
                  <h3 className="mb-1 text-sm font-medium">Prompt</h3>
                  <pre className="rounded bg-muted p-3 text-xs whitespace-pre-wrap max-h-[200px] overflow-y-auto">
                    {def.prompt}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ChatView({ messages: raw }: { messages: string | null }) {
  if (!raw) {
    return (
      <div className="text-xs text-muted-foreground py-4">
        No chat data available
      </div>
    );
  }

  let parsed: ChatMessage[];
  try {
    parsed = JSON.parse(raw);
  } catch {
    return (
      <div className="text-xs text-red-500 py-4">
        Failed to parse chat messages
      </div>
    );
  }

  if (parsed.length === 0) {
    return (
      <div className="text-xs text-muted-foreground py-4">
        No messages recorded
      </div>
    );
  }

  return (
    <div className="rounded bg-muted p-3 text-xs max-h-[500px] overflow-y-auto font-mono space-y-2">
      {parsed.map((msg, i) => {
        switch (msg.role) {
          case 'assistant':
            return (
              <div key={i} className="whitespace-pre-wrap text-foreground">
                {msg.content}
              </div>
            );
          case 'tool':
            return <ToolMessage key={i} content={msg.content} />;
          case 'reasoning':
            return (
              <div
                key={i}
                className="text-purple-400/80 italic whitespace-pre-wrap"
              >
                {msg.content}
              </div>
            );
          case 'error':
            return (
              <div key={i} className="text-red-500 whitespace-pre-wrap">
                {msg.content}
              </div>
            );
          default:
            return (
              <div
                key={i}
                className="text-muted-foreground whitespace-pre-wrap"
              >
                {msg.content}
              </div>
            );
        }
      })}
    </div>
  );
}

function ToolMessage({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);

  const firstLine = content.split('\n')[0];
  const rest = content.slice(firstLine.length + 1);
  const hasOutput = rest.trim().length > 0;

  return (
    <div>
      <button
        type="button"
        onClick={() => hasOutput && setExpanded(!expanded)}
        className={`group flex items-center gap-1.5 text-[11px] w-full text-left transition-colors ${
          hasOutput
            ? 'text-muted-foreground hover:text-foreground cursor-pointer'
            : 'text-muted-foreground cursor-default'
        }`}
      >
        {hasOutput &&
          (expanded ? (
            <ChevronDown className="h-3 w-3 shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0" />
          ))}
        <span className="truncate">{firstLine}</span>
      </button>
      {expanded && hasOutput && (
        <pre className="mt-1 rounded bg-background/50 border border-border p-2 text-[10px] text-muted-foreground whitespace-pre-wrap max-h-[300px] overflow-y-auto">
          {rest}
        </pre>
      )}
    </div>
  );
}

function ComparisonDetail({ comparison }: { comparison: Comparison }) {
  const def = getEvalBySlug(comparison.evalName);

  let rankings: ComparisonRanking[] = [];
  try {
    rankings = JSON.parse(comparison.rankings);
    rankings.sort((a, b) => a.rank - b.rank);
  } catch {}

  const winnerShort =
    comparison.winnerModel.split('/').pop() ?? comparison.winnerModel;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="shrink-0 border-b px-6 py-3">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold tracking-tight">
            {def?.name ?? comparison.evalName}
          </h2>
          <Badge variant="outline">Comparison</Badge>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
        <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-4">
          <div className="text-xs text-muted-foreground mb-1">Winner</div>
          <div className="text-lg font-semibold font-mono text-green-500">
            {winnerShort}
          </div>
        </div>

        <div>
          <h3 className="mb-3 text-sm font-medium">Rankings</h3>
          <div className="space-y-2">
            {rankings.map((r) => {
              const shortModel = r.model.split('/').pop() ?? r.model;
              const isWinner = r.model === comparison.winnerModel;
              return (
                <div
                  key={r.model}
                  className={`rounded-lg border p-3 ${
                    isWinner
                      ? 'border-green-500/30 bg-green-500/5'
                      : 'border-border'
                  }`}
                >
                  <div className="flex items-center gap-3 mb-1">
                    <span className="text-xs font-bold text-muted-foreground w-5">
                      #{r.rank}
                    </span>
                    <span className="text-sm font-mono font-medium">
                      {shortModel}
                    </span>
                    <span className="ml-auto text-xs font-mono font-bold text-muted-foreground">
                      {r.score}/10
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground pl-8">
                    {r.reasoning}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <h3 className="mb-1 text-sm font-medium">Reasoning</h3>
          <p className="text-xs text-muted-foreground whitespace-pre-wrap">
            {comparison.reasoning}
          </p>
        </div>
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
        if (line.startsWith('[reasoning] ')) {
          return (
            <div key={i} className="text-purple-400/80 italic">
              {line.slice('[reasoning] '.length)}
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

'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, useCallback, Suspense } from 'react';
import { Terminal, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface RunSummary {
  id: string;
  status: string;
  createdAt: string;
  taskCount: number;
  passedCount: number;
  failedCount: number;
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

function relativeTime(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function HeaderInner() {
  const pathname = usePathname();
  const router = useRouter();
  const pathMatch = pathname.match(/^\/runs\/([^/]+)/);
  const selectedRunId = pathMatch?.[1] ?? '';
  const [runs, setRuns] = useState<RunSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const res = await fetch('/api/runs');
      if (res.ok && !cancelled) {
        const data = await res.json();
        setRuns(data);
      }
    };
    load();
    const interval = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const handleRunChange = useCallback(
    (id: string) => {
      router.push(`/runs/${id}`, { scroll: false });
    },
    [router],
  );

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
      <Link href="/" className="flex items-center gap-2 shrink-0">
        <Terminal className="h-4 w-4" />
        <span className="text-sm font-semibold tracking-tight">
          AI CLI Evals
        </span>
      </Link>

      <div className="mx-2 h-4 w-px bg-border" />

      <Select value={selectedRunId} onValueChange={handleRunChange}>
        <SelectTrigger className="w-[280px] h-8 text-xs">
          <SelectValue placeholder="Select a run..." />
        </SelectTrigger>
        <SelectContent>
          {runs.map((run) => (
            <SelectItem key={run.id} value={run.id}>
              <span className="flex items-center gap-2">
                <Badge
                  variant={statusVariant(run.status)}
                  className="text-[10px] px-1.5 py-0"
                >
                  {run.status}
                </Badge>
                <span className="font-mono">
                  {run.passedCount}P / {run.failedCount}F
                </span>
                <span className="text-muted-foreground">
                  {relativeTime(run.createdAt)}
                </span>
              </span>
            </SelectItem>
          ))}
          {runs.length === 0 && (
            <div className="px-2 py-4 text-center text-xs text-muted-foreground">
              No runs yet
            </div>
          )}
        </SelectContent>
      </Select>

      <div className="ml-auto">
        <Link href="/runs/new">
          <Button variant="outline" size="sm" className="h-8 gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            New Run
          </Button>
        </Link>
      </div>
    </header>
  );
}

export function AppHeader() {
  return (
    <Suspense
      fallback={
        <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
          <Terminal className="h-4 w-4" />
          <span className="text-sm font-semibold tracking-tight">
            AI CLI Evals
          </span>
        </header>
      }
    >
      <HeaderInner />
    </Suspense>
  );
}

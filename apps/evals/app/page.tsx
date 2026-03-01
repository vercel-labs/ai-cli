'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { RunDetail } from '@/components/run-detail';

function DashboardContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const selectedRunId = searchParams.get('run');
  const [checkedLatest, setCheckedLatest] = useState(false);

  useEffect(() => {
    if (selectedRunId) {
      setCheckedLatest(true);
      return;
    }
    let cancelled = false;
    fetch('/api/runs')
      .then((res) => res.json())
      .then((runs: { id: string }[]) => {
        if (cancelled) return;
        if (runs.length > 0) {
          router.replace(`/?run=${runs[0].id}`, { scroll: false });
        }
        setCheckedLatest(true);
      })
      .catch(() => setCheckedLatest(true));
    return () => {
      cancelled = true;
    };
  }, [selectedRunId, router]);

  if (!checkedLatest) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p className="text-sm">Loading...</p>
      </div>
    );
  }

  if (!selectedRunId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
        <p className="text-sm">No runs yet.</p>
        <Link href="/runs/new">
          <Button variant="outline" size="sm">
            Start your first run
          </Button>
        </Link>
      </div>
    );
  }

  return <RunDetail runId={selectedRunId} />;
}

export default function DashboardPage() {
  return (
    <Suspense>
      <DashboardContent />
    </Suspense>
  );
}

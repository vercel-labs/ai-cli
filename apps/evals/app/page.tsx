'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function DashboardPage() {
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/runs')
      .then((res) => res.json())
      .then((runs: { id: string }[]) => {
        if (cancelled) return;
        if (runs.length > 0) {
          router.replace(`/runs/${runs[0].id}`);
        } else {
          setChecked(true);
        }
      })
      .catch(() => setChecked(true));
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!checked) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p className="text-sm">Loading...</p>
      </div>
    );
  }

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

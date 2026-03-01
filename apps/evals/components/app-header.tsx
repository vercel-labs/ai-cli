import Link from 'next/link';
import { Terminal, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function AppHeader() {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
      <Link href="/" className="flex items-center gap-2 shrink-0">
        <Terminal className="h-4 w-4" />
        <span className="text-sm font-semibold tracking-tight">
          AI CLI Evals
        </span>
      </Link>

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

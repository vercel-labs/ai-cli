'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Terminal, Plus, MoreVertical, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

export function AppHeader() {
  const router = useRouter();
  const [showDeleteAll, setShowDeleteAll] = useState(false);

  const handleDeleteAll = useCallback(async () => {
    await fetch('/api/runs', { method: 'DELETE' });
    setShowDeleteAll(false);
    router.push('/');
    router.refresh();
  }, [router]);

  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <Terminal className="h-4 w-4" />
          <span className="text-sm font-semibold tracking-tight">
            AI CLI Evals
          </span>
        </Link>

        <div className="ml-auto flex items-center gap-1">
          <Link href="/runs/new">
            <Button variant="outline" size="sm" className="h-8 gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              New Run
            </Button>
          </Link>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => setShowDeleteAll(true)}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete all runs
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <Dialog open={showDeleteAll} onOpenChange={setShowDeleteAll}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete all runs</DialogTitle>
            <DialogDescription>
              This will permanently delete every run and all associated tasks,
              logs, and comparisons. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteAll(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteAll}>
              Delete all
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import {
  EVAL_REGISTRY,
  EVAL_MODELS,
  EVAL_CATEGORIES,
} from '@/lib/evals/registry';

export default function NewRunPage() {
  const router = useRouter();
  const [selectedModels, setSelectedModels] = useState<Set<string>>(
    new Set([EVAL_MODELS[0]]),
  );
  const [selectedEvals, setSelectedEvals] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const toggleModel = (model: string) => {
    setSelectedModels((prev) => {
      const next = new Set(prev);
      if (next.has(model)) next.delete(model);
      else next.add(model);
      return next;
    });
  };

  const toggleEval = (slug: string) => {
    setSelectedEvals((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  const toggleAllModels = () => {
    if (selectedModels.size === EVAL_MODELS.length) {
      setSelectedModels(new Set());
    } else {
      setSelectedModels(new Set(EVAL_MODELS));
    }
  };

  const toggleAllEvals = () => {
    if (selectedEvals.size === EVAL_REGISTRY.length) {
      setSelectedEvals(new Set());
    } else {
      setSelectedEvals(new Set(EVAL_REGISTRY.map((e) => e.slug)));
    }
  };

  const toggleCategory = (category: string) => {
    const catEvals = EVAL_REGISTRY.filter((e) => e.category === category);
    const allSelected = catEvals.every((e) => selectedEvals.has(e.slug));
    setSelectedEvals((prev) => {
      const next = new Set(prev);
      for (const e of catEvals) {
        if (allSelected) next.delete(e.slug);
        else next.add(e.slug);
      }
      return next;
    });
  };

  const handleSubmit = async () => {
    if (selectedModels.size === 0 || selectedEvals.size === 0) return;
    setSubmitting(true);

    const res = await fetch('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        models: [...selectedModels],
        evals: [...selectedEvals],
      }),
    });

    if (res.ok) {
      const { id } = await res.json();
      router.push(`/runs/${id}`);
    } else {
      setSubmitting(false);
    }
  };

  const taskCount = selectedModels.size * selectedEvals.size;

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">New Eval Run</h1>
      <p className="mt-1 mb-8 text-sm text-muted-foreground">
        Select which models and evals to include in this run.
      </p>

      <Card className="mb-6">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Models</CardTitle>
            <button
              type="button"
              onClick={toggleAllModels}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {selectedModels.size === EVAL_MODELS.length
                ? 'Deselect all'
                : 'Select all'}
            </button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {EVAL_MODELS.map((model) => (
            <label
              key={model}
              className="flex items-center gap-3 cursor-pointer"
            >
              <Checkbox
                checked={selectedModels.has(model)}
                onCheckedChange={() => toggleModel(model)}
              />
              <span className="font-mono text-sm">{model}</span>
            </label>
          ))}
        </CardContent>
      </Card>

      <Card className="mb-8">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Evals</CardTitle>
            <button
              type="button"
              onClick={toggleAllEvals}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {selectedEvals.size === EVAL_REGISTRY.length
                ? 'Deselect all'
                : 'Select all'}
            </button>
          </div>
        </CardHeader>
        <CardContent>
          {EVAL_CATEGORIES.map((cat, idx) => {
            const catEvals = EVAL_REGISTRY.filter(
              (e) => e.category === cat.value,
            );
            const allChecked = catEvals.every((e) => selectedEvals.has(e.slug));
            return (
              <div key={cat.value}>
                {idx > 0 && <Separator className="my-4" />}
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">
                    {cat.label}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleCategory(cat.value)}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    {allChecked ? 'Deselect' : 'Select all'}
                  </button>
                </div>
                <div className="space-y-3">
                  {catEvals.map((evalDef) => (
                    <label
                      key={evalDef.slug}
                      className="flex items-start gap-3 cursor-pointer"
                    >
                      <Checkbox
                        checked={selectedEvals.has(evalDef.slug)}
                        onCheckedChange={() => toggleEval(evalDef.slug)}
                        className="mt-0.5"
                      />
                      <div>
                        <span className="text-sm font-medium">
                          {evalDef.name}
                        </span>
                        <p className="text-xs text-muted-foreground">
                          {evalDef.description}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {taskCount > 0
            ? `${taskCount} task${taskCount === 1 ? '' : 's'} (${selectedEvals.size} eval${selectedEvals.size === 1 ? '' : 's'} × ${selectedModels.size} model${selectedModels.size === 1 ? '' : 's'})`
            : 'Select at least one model and one eval'}
        </p>
        <Button onClick={handleSubmit} disabled={taskCount === 0 || submitting}>
          {submitting ? 'Starting...' : 'Start Run'}
        </Button>
      </div>
    </div>
  );
}

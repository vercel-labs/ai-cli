import type { StopCondition, ToolSet } from 'ai';

/**
 * Build a stable identity key for a tool call.
 * Works regardless of which field the SDK version uses (args / input).
 */
function tcKey(tc: Record<string, unknown>): string {
  const name = tc.toolName ?? tc.name ?? '';
  const args = tc.input ?? tc.args ?? {};
  return `${name}:${JSON.stringify(args)}`;
}

function stepHasTools(step: Record<string, unknown>): boolean {
  const calls = step.toolCalls as unknown[] | undefined;
  return Array.isArray(calls) && calls.length > 0;
}

function getToolCalls(
  step: Record<string, unknown>,
): Record<string, unknown>[] {
  const calls = step.toolCalls;
  return Array.isArray(calls) ? calls : [];
}

function getToolResults(
  step: Record<string, unknown>,
): Record<string, unknown>[] {
  const results = step.toolResults;
  return Array.isArray(results) ? results : [];
}

/**
 * Detects stuck agents. Skips text-only steps so reasoning between tool
 * calls doesn't reset the detection window.
 *
 * 1. Error loops — 3 tool-steps where every tool result has an error field.
 * 2. Repetition — 3 tool-steps where every individual tool call is identical.
 * 3. Cycle — last 6+ tool-steps form a repeating pattern of length 1-3.
 * 4. Hard cap — 75 total steps.
 */
export function smartStop<T extends ToolSet>(): StopCondition<T> {
  return ({ steps }) => {
    if (steps.length >= 75) return true;

    const raw = steps as unknown as Record<string, unknown>[];
    const toolSteps = raw.filter(stepHasTools);

    // --- 1. Error loops ---
    if (toolSteps.length >= 3) {
      const recent = toolSteps.slice(-3);
      const allErrored = recent.every((step) => {
        const results = getToolResults(step);
        if (results.length === 0) return false;
        return results.every((r) => {
          const out = r.output as Record<string, unknown> | undefined;
          return out?.error != null;
        });
      });
      if (allErrored) return true;
    }

    // --- 2. Flat repetition ---
    if (toolSteps.length >= 3) {
      const recent = toolSteps.slice(-3);
      const allCalls = recent.flatMap((s) => getToolCalls(s).map(tcKey));
      if (allCalls.length >= 3 && allCalls.every((k) => k === allCalls[0])) {
        return true;
      }
    }

    // --- 3. Cycle detection ---
    const WINDOW = Math.min(toolSteps.length, 10);
    if (WINDOW >= 6) {
      const sigs = toolSteps.slice(-WINDOW).map((step) => {
        const keys = getToolCalls(step).map(tcKey);
        return [...new Set(keys)].sort().join('|');
      });
      for (const cycleLen of [1, 2, 3]) {
        if (WINDOW < cycleLen * 2) continue;
        const pattern = sigs.slice(0, cycleLen);
        if (
          pattern.every(Boolean) &&
          sigs.every((s, i) => s === pattern[i % cycleLen])
        ) {
          return true;
        }
      }
    }

    return false;
  };
}

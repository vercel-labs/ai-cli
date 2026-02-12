import type { StopCondition } from 'ai';

interface ToolOutput {
  error?: string;
}

/**
 * A stop condition that detects when the agent is stuck in a loop.
 *
 * The agent runs until the model naturally stops (no more tool calls).
 * This condition only fires when 3+ consecutive steps have every tool
 * result returning an error — e.g. repeated "use startProcess" or
 * "No matches found" loops.
 */
export function smartStop(): StopCondition<any> {
  return ({ steps }) => {
    const STUCK_THRESHOLD = 3;
    if (steps.length >= STUCK_THRESHOLD) {
      const recent = steps.slice(-STUCK_THRESHOLD);
      const allErrored = recent.every((step) => {
        const results = step.toolResults;
        if (!results || results.length === 0) return false;
        return results.every((r) => {
          const out = r.output as ToolOutput | undefined;
          return out?.error != null;
        });
      });
      if (allErrored) return true;
    }
    return false;
  };
}

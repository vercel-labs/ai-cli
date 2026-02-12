import type { StopCondition } from 'ai';

interface ToolOutput {
  error?: string;
  message?: string;
}

export type StopReason = 'hard-cap' | 'stuck-loop' | null;

/** Track the reason the last smartStop fired. */
let lastStopReason: StopReason = null;

/** Return the reason the most recent smartStop condition fired, or null. */
export function getStopReason(): StopReason {
  return lastStopReason;
}

/**
 * A stop condition that lets the agent work until it's done while
 * preventing infinite loops.
 *
 * Stops when:
 * 1. A hard step cap is reached (configurable, default 30).
 * 2. The agent appears stuck: 3+ consecutive steps where every tool
 *    result returned an error.
 */
export function smartStop(maxSteps: number): StopCondition<any> {
  // Reset the reason each time a new smartStop is created (new stream).
  lastStopReason = null;

  return ({ steps }) => {
    // Hard cap
    if (steps.length >= maxSteps) {
      lastStopReason = 'hard-cap';
      return true;
    }

    // Stuck-loop detection: 3+ consecutive steps where every tool
    // result was an error (e.g. repeated "use startProcess" or
    // "No matches found" loops).
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
      if (allErrored) {
        lastStopReason = 'stuck-loop';
        return true;
      }
    }

    lastStopReason = null;
    return false;
  };
}

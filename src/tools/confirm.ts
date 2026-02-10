let handler: ((action: string) => Promise<boolean>) | null = null;

// Queue to serialize concurrent confirm() calls so only one prompt
// is visible at a time (the AI SDK fires tool executions in parallel).
let queue: Promise<boolean> = Promise.resolve(true);

export async function confirm(action: string): Promise<boolean> {
  if (!handler) {
    // Default: allow in non-interactive (piped) mode
    return true;
  }

  // Chain onto the queue so prompts appear one at a time
  const prev = queue;
  let resolve!: (v: boolean) => void;
  queue = new Promise<boolean>((r) => {
    resolve = r;
  });

  // Wait for any previous confirm to finish
  await prev;

  try {
    const result = await handler(action);
    resolve(result);
    return result;
  } catch (e) {
    resolve(false);
    throw e;
  }
}

export function setConfirmHandler(
  fn: (action: string) => Promise<boolean>,
): void {
  handler = fn;
}

export function resolveConfirm(_result: boolean): void {
  // kept for compatibility; resolution is handled inside the handler
}

let handler: ((action: string) => Promise<boolean>) | null = null;

export async function confirm(action: string): Promise<boolean> {
  if (handler) {
    return handler(action);
  }
  // Default: allow in non-interactive (piped) mode
  return true;
}

export function setConfirmHandler(
  fn: (action: string) => Promise<boolean>,
): void {
  handler = fn;
}

export function resolveConfirm(_result: boolean): void {
  // kept for compatibility; resolution is handled inside the handler
}

export function isColorEnabled(): boolean {
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.FORCE_COLOR !== undefined) return true;
  return !!process.stderr.isTTY;
}

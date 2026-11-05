export function isColorEnabledForStream(stream: { isTTY?: boolean }): boolean {
  if (process.argv.includes("--no-color")) return false;
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return process.env.FORCE_COLOR !== "0";
  if (process.env.TERM === "dumb") return false;
  return Boolean(stream.isTTY);
}

export function isColorEnabled(): boolean {
  return isColorEnabledForStream(process.stderr);
}

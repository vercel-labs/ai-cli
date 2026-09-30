import type { Command } from "./command.js";
import { parsePositiveInt } from "./parse.js";

// AbortSignal.timeout is backed by a 32-bit timer under Node, so a larger delay
// fires after 1ms instead of the requested duration.
const MAX_TIMEOUT_SECONDS = Math.floor(2_147_483_647 / 1000);

export function parseTimeoutSeconds(value: string): number {
  const seconds = parsePositiveInt(value, "timeout");
  if (seconds > MAX_TIMEOUT_SECONDS) {
    throw new Error(
      `--timeout must be at most ${MAX_TIMEOUT_SECONDS} seconds, got "${value}". The value is in seconds, not milliseconds.`
    );
  }
  return seconds;
}

export function addTimeoutOption(
  command: Command,
  defaultTimeoutMs: number
): Command {
  return command.option(
    "--timeout <seconds>",
    "Request timeout in seconds",
    (value) => parseTimeoutSeconds(value),
    defaultTimeoutMs / 1000
  );
}

export function timeoutMs(seconds: number): number {
  return seconds * 1000;
}

export function parseTimerMs(value: string, name: string): number {
  const ms = parsePositiveInt(value, name);
  if (ms > 2_147_483_647)
    throw new Error(`--${name} must be at most 2147483647 milliseconds`);
  return ms;
}

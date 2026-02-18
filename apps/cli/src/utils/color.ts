/**
 * Central color utilities. Respects NO_COLOR env var and --no-color flag.
 * https://no-color.org/
 */

export function isColorEnabled(): boolean {
  return !process.env.NO_COLOR;
}

function wrap(code: string, s: string): string {
  return isColorEnabled() ? `${code}${s}\x1b[0m` : s;
}

export const dim = (s: string): string => wrap('\x1b[2m', s);
export const dimmer = (s: string): string =>
  isColorEnabled() ? `\x1b[2m\x1b[90m${s}\x1b[0m` : s;
export const bold = (s: string): string => wrap('\x1b[1m', s);
export const green = (s: string): string => wrap('\x1b[32m', s);
export const red = (s: string): string => wrap('\x1b[31m', s);
export const cyan = (s: string): string => wrap('\x1b[36m', s);
export const yellow = (s: string): string => wrap('\x1b[33m', s);
export const magenta = (s: string): string => wrap('\x1b[35m', s);
export const blue = (s: string): string => wrap('\x1b[34m', s);
export const gray = (s: string): string => wrap('\x1b[90m', s);

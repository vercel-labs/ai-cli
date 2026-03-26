/**
 * Central color utilities. Respects NO_COLOR env var and --no-color flag.
 * https://no-color.org/
 */

export function isColorEnabled(): boolean {
	return !process.env.NO_COLOR;
}

function wrap(code: string, s: string): string {
	return isColorEnabled() ? `${code}${s}\x1B[0m` : s;
}

export const dim = (s: string): string => wrap("\u001b[2m", s);
export const dimmer = (s: string): string =>
	isColorEnabled() ? `\x1B[2m\x1B[90m${s}\u001b[0m` : s;
export const bold = (s: string): string => wrap("\x1B[1m", s);
export const green = (s: string): string => wrap("\x1B[32m", s);
export const red = (s: string): string => wrap("\u001b[31m", s);
export const cyan = (s: string): string => wrap("\x1B[36m", s);
export const yellow = (s: string): string => wrap("\x1B[33m", s);
export const magenta = (s: string): string => wrap("\x1B[35m", s);
export const blue = (s: string): string => wrap("\x1B[34m", s);
export const gray = (s: string): string => wrap("\x1B[90m", s);

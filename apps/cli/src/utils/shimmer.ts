import { isColorEnabled } from "./color.js";

/** Half-width of the shimmer glow (characters from center). */
const SHIMMER_RADIUS = 8;
/** 256-color gray shade for text outside the shimmer glow. */
const BASE = 243;
/** 256-color gray shade at the shimmer peak (near white). */
const PEAK = 255;
/** Extra frames of pause between shimmer sweeps. */
const GAP_FRAMES = 6;

/**
 * Compute the 256-color gray shade (232–255) for a character based on its
 * distance from the shimmer center. Uses a cosine falloff so the glow
 * fades smoothly into the uniform base gray on both sides.
 */
function charShade(charIdx: number, shimmerPos: number): number {
	const d = Math.abs(charIdx - shimmerPos);
	if (d >= SHIMMER_RADIUS) {
		return BASE;
	}
	// Cosine interpolation: 1.0 at center → 0.0 at SHIMMER_RADIUS
	const t = (1 + Math.cos((d / SHIMMER_RADIUS) * Math.PI)) / 2;
	return Math.round(BASE + (PEAK - BASE) * t);
}

/**
 * Apply a shimmer highlight effect to text at a given position.
 * Uses 256-color grayscale for a smooth multi-shade gradient.
 *
 * A bright glow centered at `pos` sweeps left-to-right across text that
 * is otherwise rendered in a uniform base gray. Because both sides of the
 * glow share the same base shade, wrapping is seamless — no harsh jump.
 *
 * When NO_COLOR is set, returns the plain text.
 */
export function shimmerText(text: string, pos: number): string {
	if (!isColorEnabled() || text.length === 0) {
		return text;
	}

	let result = "";
	let prevShade = -1;

	for (let i = 0; i < text.length; i++) {
		const shade = charShade(i, pos);
		if (shade !== prevShade) {
			result += `\x1B[38;5;${shade}m`;
			prevShade = shade;
		}
		result += text[i];
	}

	result += "\x1B[0m";
	return result;
}

/** Padding so the shimmer band fully enters / exits the text. */
export const SHIMMER_PADDING = SHIMMER_RADIUS;

/** Compute the next shimmer position, cycling through the full sweep + gap. */
export function nextShimmerPos(pos: number, textLength: number): number {
	const next = pos + 1;
	if (next > textLength + SHIMMER_PADDING + GAP_FRAMES) {
		return -SHIMMER_PADDING;
	}
	return next;
}

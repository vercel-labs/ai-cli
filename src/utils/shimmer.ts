import { isColorEnabled } from './color.js';

/** Half-width of the shimmer glow (characters from center). */
const SHIMMER_RADIUS = 8;
/** 256-color gray shade for text the shimmer has already passed (darker). */
const BASE_LEFT = 240;
/** 256-color gray shade for text the shimmer hasn't reached yet (brighter). */
const BASE_RIGHT = 246;
/** 256-color gray shade at the shimmer peak (near white). */
const PEAK = 255;
/** Extra frames of pause between shimmer sweeps. */
const GAP_FRAMES = 8;

/**
 * Compute the 256-color gray shade (232–255) for a character based on its
 * distance from the shimmer center. Uses a cosine falloff for a smooth
 * gradient. Left of center falls to BASE_LEFT (dark trail), right of
 * center falls to BASE_RIGHT (brighter, not-yet-reached).
 */
function charShade(charIdx: number, shimmerPos: number): number {
  const d = charIdx - shimmerPos;
  const absd = Math.abs(d);
  if (absd >= SHIMMER_RADIUS) {
    return d < 0 ? BASE_LEFT : BASE_RIGHT;
  }
  // Cosine interpolation: 1.0 at center → 0.0 at SHIMMER_RADIUS
  const t = (1 + Math.cos((absd / SHIMMER_RADIUS) * Math.PI)) / 2;
  const base = d <= 0 ? BASE_LEFT : BASE_RIGHT;
  return Math.round(base + (PEAK - base) * t);
}

/**
 * Apply a shimmer highlight effect to text at a given position.
 * Uses 256-color grayscale for a smooth multi-shade gradient.
 *
 * The shimmer sweeps left-to-right. Text the shimmer has already passed
 * fades to a darker gray; text it hasn't reached stays brighter — creating
 * a natural trailing wake.
 *
 * When NO_COLOR is set, returns the plain text.
 */
export function shimmerText(text: string, pos: number): string {
  if (!isColorEnabled() || text.length === 0) return text;

  let result = '';
  let prevShade = -1;

  for (let i = 0; i < text.length; i++) {
    const shade = charShade(i, pos);
    if (shade !== prevShade) {
      result += `\x1b[38;5;${shade}m`;
      prevShade = shade;
    }
    result += text[i];
  }

  result += '\x1b[0m';
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

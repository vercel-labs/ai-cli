import { isColorEnabled } from "./color.js";

const SHIMMER_RADIUS = 8;
const BASE = 243;
const PEAK = 255;
const GAP_FRAMES = 6;

function charShade(charIdx: number, shimmerPos: number): number {
  const d = Math.abs(charIdx - shimmerPos);
  if (d >= SHIMMER_RADIUS) return BASE;
  const t = (1 + Math.cos((d / SHIMMER_RADIUS) * Math.PI)) / 2;
  return Math.round(BASE + (PEAK - BASE) * t);
}

export function shimmerText(text: string, pos: number): string {
  if (!isColorEnabled() || text.length === 0) return text;

  let result = "";
  let prevShade = -1;

  for (let i = 0; i < text.length; i++) {
    const shade = charShade(i, pos);
    if (shade !== prevShade) {
      result += `\x1b[38;5;${shade}m`;
      prevShade = shade;
    }
    result += text[i];
  }

  result += "\x1b[0m";
  return result;
}

export const SHIMMER_PADDING = SHIMMER_RADIUS;

export function nextShimmerPos(pos: number, textLength: number): number {
  const next = pos + 1;
  if (next > textLength + SHIMMER_PADDING + GAP_FRAMES) {
    return -SHIMMER_PADDING;
  }
  return next;
}

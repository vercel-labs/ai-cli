import { isColorEnabled } from "./color.js";
import { kittyPlace } from "./kitty.js";

export const THUMB_COLUMNS = 22;
export const THUMB_ROWS = 10;
export const GAP = 2;
const INDENT = "  ";
const RAMP = ".:-=+*#%";
const BODY_COLUMNS = THUMB_COLUMNS - 2;
const BODY_ROWS = THUMB_ROWS - 2;

/** Returns how many tiles fit on one row of a terminal this wide, at least 1. */
export function gridColumns(width: number): number {
  return Math.max(1, Math.floor((width - 1) / (THUMB_COLUMNS + GAP)));
}

function gray(level: number, text: string): string {
  return `\x1b[38;5;${level}m${text}\x1b[0m`;
}

function wave(x: number, y: number, tick: number, phase: number): number {
  const t = tick * 0.16;
  const v =
    Math.sin(x * 0.42 + t + phase) +
    Math.sin(y * 0.9 - t * 0.7 + phase * 1.7) +
    Math.sin((x * 0.5 + y * 1.1) * 0.6 + t * 0.5 - phase);
  return (v + 3) / 6;
}

function tile(
  index: number,
  tick: number,
  percent: number,
  color: boolean
): string[] {
  const phase = index * 1.9;
  const filled = Math.floor((percent * BODY_ROWS) / 100);
  const label = ` ${percent}% `;
  const left = Math.floor((BODY_COLUMNS - label.length) / 2);
  const edge = (s: string) => (color ? gray(240, s) : s);
  const lines = [edge(`╭${"─".repeat(BODY_COLUMNS)}╮`)];
  for (let y = 0; y < BODY_ROWS; y++) {
    const span =
      2 + 2 * Math.round((y * (BODY_COLUMNS - 4)) / (BODY_ROWS - 1) / 2);
    const start = (BODY_COLUMNS - span) / 2;
    const solid = y >= BODY_ROWS - filled;
    let row = "";
    for (let x = 0; x < BODY_COLUMNS; x++) {
      if (x < start || x >= start + span) {
        row += " ";
        continue;
      }
      if (solid) {
        row += color ? gray(255, "█") : "█";
        continue;
      }
      const v = wave(x, y, tick, phase);
      const ch = RAMP[Math.min(RAMP.length - 1, Math.floor(v * RAMP.length))]!;
      row += color ? gray(238 + Math.round(v * 8), ch) : ch;
    }
    lines.push(`${edge("│")}${row}${edge("│")}`);
  }
  const right = BODY_COLUMNS - left - label.length;
  lines.push(edge(`╰${"─".repeat(left)}${label}${"─".repeat(right)}╯`));
  return lines;
}

/** Returns the lines for animated placeholder tiles laid out in a grid, each within width - 1 columns. */
export function loaderFrame(
  count: number,
  opts: { width: number; tick: number; elapsedMs: number; expectedMs: number }
): string[] {
  const color = isColorEnabled();
  const expected = Math.max(1, opts.expectedMs);
  const percent = Math.min(
    99,
    Math.floor(99 * (1 - Math.exp(-Math.max(0, opts.elapsedMs) / expected)))
  );
  const perRow = gridColumns(opts.width);
  const out: string[] = [];
  for (let start = 0; start < count; start += perRow) {
    const tiles = [];
    for (let i = start; i < Math.min(count, start + perRow); i++) {
      tiles.push(tile(i, opts.tick, percent, color));
    }
    for (let line = 0; line < THUMB_ROWS; line++) {
      out.push(INDENT + tiles.map((t) => t[line]).join(" ".repeat(GAP)));
    }
  }
  return out;
}

function placeholder(column: number): string {
  const label = "no preview";
  const pad = Math.floor((BODY_COLUMNS - label.length) / 2);
  const body = Array.from({ length: BODY_ROWS }, (_, y) =>
    y === Math.floor(BODY_ROWS / 2)
      ? " ".repeat(pad) + label + " ".repeat(BODY_COLUMNS - pad - label.length)
      : " ".repeat(BODY_COLUMNS)
  );
  const bar = "─".repeat(BODY_COLUMNS);
  return [`╭${bar}╮`, ...body.map((b) => `│${b}│`), `╰${bar}╯`]
    .map((line) => `\x1b[${column}G${line}\x1b[1B`)
    .join("");
}

/** Returns scrollback output laying out thumbnails in the loader grid, ending at column 1 below the grid. */
export function thumbnailGrid(
  pngs: Array<Buffer | undefined>,
  width: number
): string {
  const perRow = gridColumns(width);
  let out = "";
  for (let start = 0; start < pngs.length; start += perRow) {
    out += "\n".repeat(THUMB_ROWS) + `\x1b[${THUMB_ROWS}A`;
    pngs.slice(start, start + perRow).forEach((png, i) => {
      const column = INDENT.length + 1 + i * (THUMB_COLUMNS + GAP);
      out += png
        ? `\x1b[${column}G` +
          kittyPlace(png, {
            columns: THUMB_COLUMNS,
            rows: THUMB_ROWS,
            keepCursor: true,
          })
        : placeholder(column) + `\x1b[${THUMB_ROWS}A`;
    });
    out += `\x1b[${THUMB_ROWS}B\x1b[1G`;
  }
  return out;
}

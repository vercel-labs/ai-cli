import { emitKeypressEvents, type Key } from "node:readline";
import { PassThrough } from "node:stream";

import { GAP, THUMB_COLUMNS, THUMB_ROWS } from "./tui-media.js";

const MOUSE_ON = "\x1b[?1000h\x1b[?1006h";
const MOUSE_OFF = "\x1b[?1000l\x1b[?1006l";
const ESC = String.fromCharCode(27);
const REPORT = new RegExp(
  `${ESC}\\[<(\\d+);(\\d+);(\\d+)([Mm])|${ESC}\\[(\\d+);(\\d+)R`,
  "g"
);
interface Grid {
  top: number;
  files: string[];
  perRow: number;
}

export type GridPlacement = Omit<Grid, "top"> & { offset: number };

export class Terminal {
  paused = false;
  private liveRow = 0;
  private liveTop?: number;
  private scrolled = 0;
  private grids: Grid[] = [];
  private onRow?: (row: number) => void;

  async open(
    onKey: (str: string | undefined, key: Key) => void,
    onResize: () => void,
    onClick: (x: number, y: number) => Promise<void>
  ): Promise<() => void> {
    const { stdin, stdout } = process;
    const keys = new PassThrough();
    emitKeypressEvents(keys);
    stdin.setRawMode(true);
    stdin.resume();
    const onKeypress = (str: string | undefined, key: Key) => {
      if (!this.paused) onKey(str, key);
    };
    const onData = (data: Buffer) => {
      const rest = this.terminalReports(data.toString("utf8"), onClick);
      if (rest) keys.write(rest);
    };
    const mouseOff = () => stdout.write(MOUSE_OFF);
    keys.on("keypress", onKeypress);
    stdin.on("data", onData);
    stdout.on("resize", onResize);
    process.once("exit", mouseOff);
    this.liveTop = await this.cursorRow();
    stdout.write(MOUSE_ON);
    return () => {
      mouseOff();
      keys.off("keypress", onKeypress);
      stdin.off("data", onData);
      stdout.off("resize", onResize);
      process.off("exit", mouseOff);
      this.erase();
      stdin.setRawMode(false);
      stdin.pause();
    };
  }

  mouse(enabled: boolean): void {
    process.stdout.write(enabled ? MOUSE_ON : MOUSE_OFF);
  }

  clear(): void {
    process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
    this.liveRow = 0;
    this.liveTop = this.liveTop === undefined ? undefined : 1;
    this.scrolled = 0;
    this.grids = [];
  }

  private terminalReports(
    text: string,
    onClick: (x: number, y: number) => Promise<void>
  ): string {
    return text.replace(REPORT, (match, button, x, y, kind, row) => {
      if (row !== undefined) {
        if (!this.onRow) return match;
        this.onRow(Number(row));
      } else if (kind === "M" && button === "0")
        void onClick(Number(x), Number(y));
      return "";
    });
  }

  private cursorRow(): Promise<number | undefined> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.onRow = undefined;
        resolve(undefined);
      }, 500);
      this.onRow = (row) => {
        clearTimeout(timer);
        this.onRow = undefined;
        resolve(row);
      };
      process.stdout.write("\x1b[6n");
    });
  }

  imageAt(x: number, y: number): string | undefined {
    if (this.paused || this.liveTop === undefined) return;
    const row = y + this.scrolled;
    const step = THUMB_COLUMNS + GAP;
    const column = x - 3;
    const grid = this.grids.find(
      ({ top, files, perRow }) =>
        row >= top && row < top + Math.ceil(files.length / perRow) * THUMB_ROWS
    );
    if (!grid || column < 0 || column % step >= THUMB_COLUMNS) return;
    const tile = Math.floor(column / step);
    if (tile >= grid.perRow) return;
    const file =
      grid.files[
        Math.floor((row - grid.top) / THUMB_ROWS) * grid.perRow + tile
      ];
    return file;
  }

  render({
    lines,
    row,
    col,
  }: {
    lines: string[];
    row: number;
    col: number;
  }): void {
    const up = lines.length - 1 - row;
    process.stdout.write(
      `\x1b[?25l${this.liveRow ? `\x1b[${this.liveRow}A` : ""}\r\x1b[J${lines.join("\n")}${up ? `\x1b[${up}A` : ""}\r\x1b[${col}C\x1b[?25h`
    );
    this.liveRow = row;
    if (this.liveTop !== undefined) this.advance(lines.length - 1, 0);
  }

  private erase(): void {
    process.stdout.write(
      `${this.liveRow ? `\x1b[${this.liveRow}A` : ""}\r\x1b[J`
    );
    this.liveRow = 0;
  }

  print(text: string, grid?: GridPlacement): void {
    this.erase();
    if (grid && this.liveTop !== undefined)
      this.grids.push({
        top: this.liveTop + this.scrolled + grid.offset,
        files: grid.files,
        perRow: grid.perRow,
      });
    process.stdout.write(text);
    const lines = text.split("\n").length - 1;
    if (this.liveTop !== undefined) this.advance(lines, lines);
  }

  /** Records how far the screen scrolled when output reaches `reach` rows below the live top, then moves the live top down by `move`. */
  private advance(reach: number, move: number): void {
    const overflow = Math.max(
      0,
      this.liveTop! + reach - (process.stdout.rows ?? 24)
    );
    this.scrolled += overflow;
    this.liveTop = this.liveTop! + move - overflow;
  }
}

import { isColorEnabled } from "./color.js";
import { nextShimmerPos, SHIMMER_PADDING, shimmerText } from "./shimmer.js";

let cleanupFn: (() => void) | null = null;
let signalHandlersRegistered = false;

function onSignal() {
  if (cleanupFn) cleanupFn();
  process.stderr.write("\x1b[0m\x1b[?25h");
  process.exit(130);
}

function ensureSignalHandlers() {
  if (signalHandlersRegistered) return;
  signalHandlersRegistered = true;
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
}

export function formatElapsed(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  return `${mins}m ${remainSecs}s`;
}

function isTTY(): boolean {
  return !!process.stderr.isTTY;
}

function getColumns(): number {
  return (
    (process.stderr as typeof process.stderr & { columns?: number }).columns ??
    80
  );
}

export class Progress {
  private interval: ReturnType<typeof setInterval> | null = null;
  private pos = -SHIMMER_PADDING;
  private text = "";
  private startTime = 0;
  private quiet: boolean;

  constructor(quiet = false) {
    this.quiet = quiet;
  }

  start(message: string) {
    if (this.quiet) return;
    ensureSignalHandlers();
    this.startTime = Date.now();
    this.text = message;
    this.pos = -SHIMMER_PADDING;
    if (isTTY()) {
      cleanupFn = () => {
        process.stderr.write("\r\x1b[K");
      };
      this.render();
      this.interval = setInterval(() => this.render(), 50);
    }
  }

  stop(message?: string) {
    if (this.quiet) return;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    cleanupFn = null;
    if (isTTY()) {
      process.stderr.write("\r\x1b[K");
    }
    if (message) {
      const elapsed = formatElapsed(Date.now() - this.startTime);
      process.stderr.write(`${message} (${elapsed})\n`);
    }
  }

  private render() {
    const elapsed = formatElapsed(Date.now() - this.startTime);
    const columns = getColumns();
    const suffix = ` (${elapsed})`;
    const maxWidth = columns - 1 - suffix.length;
    const display =
      this.text.length > maxWidth ? this.text.slice(-maxWidth) : this.text;
    const fullText = `${display}${suffix}`;

    if (isColorEnabled()) {
      process.stderr.write(`\r${shimmerText(fullText, this.pos)}\x1b[K`);
    } else {
      process.stderr.write(`\r${fullText}\x1b[K`);
    }

    this.pos = nextShimmerPos(this.pos, fullText.length);
  }
}

type LineState = "queued" | "active" | "done";

interface MultiLine {
  text: string;
  state: LineState;
  startTime: number;
  pos: number;
  finalText: string;
}

export class MultiProgress {
  private lines: MultiLine[] = [];
  private interval: ReturnType<typeof setInterval> | null = null;
  private quiet: boolean;
  private renderedCount = 0;

  constructor(quiet = false) {
    this.quiet = quiet;
  }

  addLine(text: string): number {
    ensureSignalHandlers();
    const idx = this.lines.length;
    this.lines.push({
      text,
      state: "queued",
      startTime: 0,
      pos: -SHIMMER_PADDING,
      finalText: "",
    });
    if (!this.quiet && isTTY() && !this.interval) {
      cleanupFn = () => this.eraseLines();
      this.interval = setInterval(() => this.render(), 50);
    }
    if (isTTY()) this.render();
    return idx;
  }

  startLine(idx: number) {
    if (idx < 0 || idx >= this.lines.length) return;
    const line = this.lines[idx];
    if (line.state !== "queued") return;
    line.state = "active";
    line.startTime = Date.now();
    line.pos = -SHIMMER_PADDING;
    if (isTTY()) this.render();
  }

  completeLine(idx: number, finalText: string) {
    if (idx < 0 || idx >= this.lines.length) return;
    const line = this.lines[idx];
    line.state = "done";
    line.finalText = finalText;

    if (this.lines.every((l) => l.state === "done")) {
      this.stopAll();
    } else if (isTTY()) {
      this.render();
    }
  }

  private stopAll() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    cleanupFn = null;
    if (isTTY()) this.eraseLines();
    if (!this.quiet) {
      for (const line of this.lines) {
        process.stderr.write(`${line.finalText}\n`);
      }
    }
    this.renderedCount = 0;
  }

  private render() {
    if (this.quiet) return;
    this.eraseLines();

    const columns = getColumns();
    const dim = isColorEnabled() ? "\x1b[2m\x1b[90m" : "";
    const reset = isColorEnabled() ? "\x1b[0m" : "";

    for (const line of this.lines) {
      if (line.state === "done") {
        process.stderr.write(`${line.finalText}\x1b[K\n`);
      } else if (line.state === "queued") {
        process.stderr.write(`${dim}${line.text} (queued)${reset}\x1b[K\n`);
      } else {
        const elapsed = formatElapsed(Date.now() - line.startTime);
        const suffix = ` (${elapsed})`;
        const maxWidth = columns - 1 - suffix.length;
        const display =
          line.text.length > maxWidth ? line.text.slice(-maxWidth) : line.text;
        const fullText = `${display}${suffix}`;

        if (isColorEnabled()) {
          process.stderr.write(`${shimmerText(fullText, line.pos)}\x1b[K\n`);
        } else {
          process.stderr.write(`${fullText}\x1b[K\n`);
        }

        line.pos = nextShimmerPos(line.pos, fullText.length);
      }
    }

    this.renderedCount = this.lines.length;
  }

  private eraseLines() {
    if (this.renderedCount === 0) return;
    process.stderr.write(`\x1b[${this.renderedCount}A\r`);
  }
}

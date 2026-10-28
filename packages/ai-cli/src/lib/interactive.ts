import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { emitKeypressEvents, type Key } from "node:readline";
import { PassThrough } from "node:stream";

import { isColorEnabled } from "./color.js";
import type { Command } from "./command.js";
import { supportsKittyGraphics, toPng, videoFramePng } from "./kitty.js";
import { DEFAULTS, fetchGatewayModels } from "./models.js";
import { savedOutputs } from "./output.js";
import { formatElapsed } from "./progress.js";
import { nextShimmerPos, SHIMMER_PADDING, shimmerText } from "./shimmer.js";
import { pickImage } from "./slider.js";
import {
  GAP,
  gridColumns,
  loaderFrame,
  THUMB_COLUMNS,
  THUMB_ROWS,
  thumbnailGrid,
} from "./tui-media.js";

type Mode = "image" | "video" | "text";
type Field = "mode" | "model" | "count" | "ratio" | "duration";

const MODES: Mode[] = ["image", "video", "text"];
const COUNTS = ["1", "2"];
const RATIOS: Record<Exclude<Mode, "text">, string[]> = {
  image: ["auto", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"],
  video: ["auto", "16:9", "9:16", "1:1"],
};
const DURATIONS = ["auto", "4", "5", "6", "8", "10"];
const FIELD_NAMES: Record<Field, string> = {
  mode: "Generate",
  model: "Model",
  count: "How many",
  ratio: "Aspect ratio",
  duration: "Duration (seconds)",
};
const PICKER_ROWS = 8;
const MOUSE_ON = "\x1b[?1000h\x1b[?1006h";
const MOUSE_OFF = "\x1b[?1000l\x1b[?1006l";
const ESC = String.fromCharCode(27);
const REPORT = new RegExp(
  `${ESC}\\[<(\\d+);(\\d+);(\\d+)([Mm])|${ESC}\\[(\\d+);(\\d+)R`,
  "g"
);
const EXPECTED_MS: Record<Mode, number> = {
  image: 20_000,
  video: 90_000,
  text: 5_000,
};
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const PLACEHOLDERS: Record<Mode, string> = {
  image: "Describe an image",
  video: "Describe a video",
  text: "Ask anything",
};

const COMMANDS: Array<{ name: string; usage: string; about: string }> = [
  { name: "image", usage: "/image [prompt]", about: "Switch to images" },
  { name: "video", usage: "/video [prompt]", about: "Switch to videos" },
  { name: "text", usage: "/text [prompt]", about: "Switch to text" },
  { name: "model", usage: "/model", about: "Pick a model for this mode" },
  { name: "n", usage: "/n", about: "Pick how many images or videos" },
  { name: "ratio", usage: "/ratio", about: "Pick an aspect ratio" },
  { name: "duration", usage: "/duration", about: "Pick a video duration" },
  { name: "gallery", usage: "/gallery", about: "Browse this session's images" },
  { name: "clear", usage: "/clear", about: "Clear the screen" },
  { name: "help", usage: "/help", about: "Show keys and commands" },
  { name: "exit", usage: "/exit", about: "Quit" },
];

const HELP = [
  "Type a prompt and press Enter. Everything else is picked, not typed:",
  "Tab              focus the settings below the prompt",
  "←/→  ↑/↓         choose a setting, change its value",
  "Enter            open the full list (type to filter); Esc goes back",
  "/                commands: /image /video /text /model /n /ratio /gallery ...",
  "@last            put it in a prompt to use the last output as input",
  "Ctrl+D           quit",
];

const style = (code: string) => (text: string) =>
  isColorEnabled() ? `\x1b[${code}m${text}\x1b[0m` : text;
const bold = style("1");
const dim = style("2");
const red = style("31");
const inverse = style("7");

interface Busy {
  mode: Mode;
  count: number;
  start: number;
  tick: number;
  shimmer: number;
}

interface Grid {
  top: number;
  files: string[];
  perRow: number;
}

type GridPlacement = Omit<Grid, "top"> & { offset: number };

interface Picker {
  field: Field;
  options: string[];
  filter: string;
  index: number;
  loading: boolean;
}

/** Runs the full-width interactive prompt until the user quits; all output goes to stdout. */
export async function runInteractive(
  program: Command,
  version: string
): Promise<void> {
  await new Tui(program).run(version);
}

class Tui {
  private mode: Mode = "image";
  private models: Partial<Record<Mode, string>> = {};
  private count = 1;
  private ratios = { image: "auto", video: "auto" };
  private duration = "auto";
  private focus: "input" | "settings" = "input";
  private chip = 0;
  private picker?: Picker;
  private input = "";
  private cursor = 0;
  private history: string[] = [];
  private historyIndex = 0;
  private menuIndex = 0;
  private busy?: Busy;
  private last?: string;
  private gallery: string[] = [];
  private liveRow = 0;
  private liveTop?: number;
  private scrolled = 0;
  private grids: Grid[] = [];
  private onRow?: (row: number) => void;
  private paused = false;
  private done?: () => void;

  constructor(private readonly program: Command) {}

  async run(version: string): Promise<void> {
    const { stdin, stdout } = process;
    stdout.write(
      `\n${bold("ai")} ${dim(`v${version} · type a prompt · tab for settings · /help`)}\n\n`
    );
    const keys = new PassThrough();
    emitKeypressEvents(keys);
    stdin.setRawMode(true);
    stdin.resume();
    const onKeypress = (str: string | undefined, key: Key) => {
      if (!this.paused) this.onKey(str, key);
    };
    const onData = (data: Buffer) => {
      const rest = this.terminalReports(data.toString("utf8"));
      if (rest) keys.write(rest);
    };
    const onResize = () => this.render();
    const mouseOff = () => stdout.write(MOUSE_OFF);
    keys.on("keypress", onKeypress);
    stdin.on("data", onData);
    stdout.on("resize", onResize);
    process.once("exit", mouseOff);
    this.liveTop = await this.cursorRow();
    stdout.write(MOUSE_ON);
    this.render();
    await new Promise<void>((resolve) => {
      this.done = resolve;
    });
    mouseOff();
    keys.off("keypress", onKeypress);
    stdin.off("data", onData);
    stdout.off("resize", onResize);
    process.off("exit", mouseOff);
    this.erase();
    stdin.setRawMode(false);
    stdin.pause();
    if (this.busy) process.exit(130);
  }

  private terminalReports(text: string): string {
    return text.replace(REPORT, (match, button, x, y, kind, row) => {
      if (row !== undefined) {
        if (!this.onRow) return match;
        this.onRow(Number(row));
      } else if (kind === "M" && button === "0")
        void this.click(Number(x), Number(y));
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

  private async click(x: number, y: number): Promise<void> {
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
    const start = file ? this.gallery.indexOf(file) : -1;
    if (start >= 0) await this.openGallery(start);
  }

  private onKey(str: string | undefined, key: Key): void {
    if (key.ctrl && key.name === "d" && !this.input) return this.quit();
    if (key.ctrl && key.name === "c") {
      if (this.picker || this.focus === "settings") {
        this.picker = undefined;
        this.focus = "input";
        return this.render();
      }
      return this.input ? this.setInput("") : this.quit();
    }
    if (this.picker) return this.onPickerKey(str, key);
    if (this.focus === "settings") return this.onSettingsKey(str, key);
    this.onInputKey(str, key);
  }

  private onPickerKey(str: string | undefined, key: Key): void {
    const picker = this.picker!;
    const options = this.filtered();
    if (key.name === "escape" || key.name === "tab") this.picker = undefined;
    else if (key.name === "up" || key.name === "down") {
      if (options.length)
        picker.index =
          (picker.index + (key.name === "up" ? -1 : 1) + options.length) %
          options.length;
    } else if (key.name === "return") {
      const value = options[picker.index];
      this.picker = undefined;
      if (value) this.apply(picker.field, value);
    } else if (key.name === "backspace") {
      picker.filter = picker.filter.slice(0, -1);
      picker.index = 0;
    } else if (str && !key.ctrl && !key.meta && str >= " ") {
      picker.filter += str;
      picker.index = 0;
    } else return;
    this.render();
  }

  private onSettingsKey(str: string | undefined, key: Key): void {
    const fields = this.fields();
    const field = fields[this.chip]!;
    if (key.name === "left" || key.name === "right")
      this.chip =
        (this.chip + (key.name === "left" ? -1 : 1) + fields.length) %
        fields.length;
    else if (key.name === "up" || key.name === "down") {
      if (field === "model") return void this.openPicker(field);
      const options = this.optionsFor(field);
      const index = options.indexOf(this.current(field));
      this.apply(
        field,
        options[
          (index + (key.name === "up" ? 1 : -1) + options.length) %
            options.length
        ]!
      );
    } else if (key.name === "return" || key.name === "space")
      return void this.openPicker(field);
    else if (key.name === "escape" || key.name === "tab") this.focus = "input";
    else if (str && !key.ctrl && !key.meta && str > " ") {
      this.focus = "input";
      return this.onInputKey(str, key);
    } else return;
    this.render();
  }

  private onInputKey(str: string | undefined, key: Key): void {
    const menu = this.menu();
    if (key.name === "return") return this.submit(menu);
    if (key.name === "tab") {
      if (menu.length) {
        const command = menu[this.menuIndex]!;
        return this.setInput(
          `/${command.name}${command.usage.includes(" ") ? " " : ""}`
        );
      }
      this.focus = "settings";
      this.chip = Math.min(this.chip, this.fields().length - 1);
      return this.render();
    }
    if (key.name === "up" || key.name === "down") {
      const delta = key.name === "up" ? -1 : 1;
      if (menu.length)
        this.menuIndex = (this.menuIndex + delta + menu.length) % menu.length;
      else this.recall(delta);
      return this.render();
    }
    if (key.name === "left") this.cursor = Math.max(0, this.cursor - 1);
    else if (key.name === "right")
      this.cursor = Math.min(this.input.length, this.cursor + 1);
    else if (key.name === "home" || (key.ctrl && key.name === "a"))
      this.cursor = 0;
    else if (key.name === "end" || (key.ctrl && key.name === "e"))
      this.cursor = this.input.length;
    else if (key.ctrl && key.name === "u") return this.setInput("");
    else if (key.ctrl && key.name === "w") {
      const head = this.input.slice(0, this.cursor).replace(/\S+\s*$/, "");
      this.input = head + this.input.slice(this.cursor);
      this.cursor = head.length;
    } else if (key.name === "backspace") {
      if (this.cursor > 0) {
        this.input =
          this.input.slice(0, this.cursor - 1) + this.input.slice(this.cursor);
        this.cursor--;
      }
    } else if (key.name === "delete")
      this.input =
        this.input.slice(0, this.cursor) + this.input.slice(this.cursor + 1);
    else if (key.name === "escape") return this.setInput("");
    else if (str && !key.ctrl && !key.meta && str >= " ") {
      this.input =
        this.input.slice(0, this.cursor) + str + this.input.slice(this.cursor);
      this.cursor += str.length;
      this.menuIndex = 0;
    } else return;
    this.render();
  }

  private fields(): Field[] {
    if (this.mode === "text") return ["mode", "model"];
    if (this.mode === "image") return ["mode", "model", "count", "ratio"];
    return ["mode", "model", "count", "ratio", "duration"];
  }

  private optionsFor(field: Field): string[] {
    if (field === "mode") return MODES;
    if (field === "count") return COUNTS;
    if (field === "duration") return DURATIONS;
    if (field === "ratio" && this.mode !== "text") return RATIOS[this.mode];
    return [];
  }

  private current(field: Field): string {
    if (field === "mode") return this.mode;
    if (field === "model") return this.model();
    if (field === "count") return String(this.count);
    if (field === "duration") return this.duration;
    return this.mode === "text" ? "auto" : this.ratios[this.mode];
  }

  private label(field: Field): string {
    const value = this.current(field);
    if (field === "model") return truncate(value, 36);
    if (field === "count")
      return `${value} ${this.mode}${value === "1" ? "" : "s"}`;
    if (field === "ratio") return value === "auto" ? "any ratio" : value;
    if (field === "duration")
      return value === "auto" ? "any length" : `${value}s`;
    return value;
  }

  private apply(field: Field, value: string): void {
    if (field === "mode") {
      this.mode = value as Mode;
      this.chip = Math.min(this.chip, this.fields().length - 1);
    } else if (field === "model") this.models[this.mode] = value;
    else if (field === "count") this.count = Number(value);
    else if (field === "duration") this.duration = value;
    else if (this.mode !== "text") this.ratios[this.mode] = value;
  }

  private async openPicker(field: Field): Promise<void> {
    this.focus = "settings";
    this.chip = Math.max(0, this.fields().indexOf(field));
    const current = this.current(field);
    if (field !== "model") {
      const options = this.optionsFor(field);
      this.picker = {
        field,
        options,
        filter: "",
        index: Math.max(0, options.indexOf(current)),
        loading: false,
      };
      return this.render();
    }
    const mode = this.mode;
    this.picker = { field, options: [], filter: "", index: 0, loading: true };
    this.render();
    const catalog = await fetchGatewayModels();
    const ids =
      mode === "image"
        ? [
            ...new Set([
              ...catalog.image.map(({ id }) => id),
              ...catalog.languageImageModelIds,
            ]),
          ]
        : catalog[mode].map(({ id }) => id);
    ids.sort();
    if (this.picker?.field !== "model" || this.mode !== mode) return;
    this.picker.options = ids;
    this.picker.loading = false;
    this.picker.index = Math.max(0, ids.indexOf(current));
    this.render();
  }

  private filtered(): string[] {
    if (!this.picker) return [];
    const filter = this.picker.filter.toLowerCase();
    const rank = (option: string) => {
      const name = option.toLowerCase();
      if (!name.includes(filter)) return 3;
      if ((name.split("/")[1] ?? name).startsWith(filter)) return 0;
      return name.split(/[/.-]/).some((part) => part.startsWith(filter))
        ? 1
        : 2;
    };
    return this.picker.options
      .filter((option) => rank(option) < 3)
      .sort((a, b) => rank(a) - rank(b));
  }

  private setInput(value: string): void {
    this.input = value;
    this.cursor = value.length;
    this.menuIndex = 0;
    this.render();
  }

  private recall(delta: number): void {
    const index = Math.min(
      this.history.length,
      Math.max(0, this.historyIndex + delta)
    );
    this.historyIndex = index;
    this.input = this.history[index] ?? "";
    this.cursor = this.input.length;
  }

  private menu() {
    if (!this.input.startsWith("/") || this.input.includes(" ")) return [];
    const typed = this.input.slice(1);
    return COMMANDS.filter((command) => command.name.startsWith(typed));
  }

  private submit(menu: typeof COMMANDS): void {
    let line = this.input.trim();
    if (menu.length) line = `/${menu[this.menuIndex]!.name}`;
    if (!line) return;
    if (this.busy && !line.startsWith("/")) return;
    this.history = [...this.history.filter((item) => item !== line), line];
    this.historyIndex = this.history.length;
    this.setInput("");
    if (line.startsWith("/")) void this.command(line);
    else void this.generate(this.mode, line);
  }

  private async command(line: string): Promise<void> {
    const [name = "", ...rest] = line.slice(1).split(/\s+/);
    const arg = rest.join(" ").trim();
    if (name === "image" || name === "video" || name === "text") {
      this.apply("mode", name);
      this.render();
      if (arg && !this.busy) await this.generate(name, arg);
    } else if (
      name === "model" ||
      name === "n" ||
      name === "ratio" ||
      name === "duration"
    ) {
      const field: Field = name === "n" ? "count" : name;
      if (!this.fields().includes(field))
        return this.print(
          `  ${red(`/${name} does not apply to ${this.mode}`)}\n\n`
        );
      if (!arg) return this.openPicker(field);
      const options = this.optionsFor(field);
      if (options.length && !options.includes(arg))
        return this.print(
          `  ${red(`/${name} takes one of: ${options.join(", ")}`)}\n\n`
        );
      this.apply(field, arg);
      this.render();
    } else if (name === "gallery") await this.openGallery();
    else if (name === "clear") {
      process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
      this.liveRow = 0;
      this.liveTop = this.liveTop === undefined ? undefined : 1;
      this.scrolled = 0;
      this.grids = [];
      this.render();
    } else if (name === "help")
      this.print(
        `${HELP.map((item) => `  ${dim(truncate(item, (process.stdout.columns ?? 80) - 3))}`).join("\n")}\n\n`
      );
    else if (name === "exit" || name === "quit") this.quit();
    else this.print(`  ${red(`Unknown command /${name}`)}\n\n`);
  }

  private async openGallery(start = this.gallery.length - 1): Promise<void> {
    if (!this.gallery.length)
      return this.print(`  ${dim("No images yet.")}\n\n`);
    if (!supportsKittyGraphics())
      return this.print(
        `${this.gallery.map((file) => `  ${dim(file)}`).join("\n")}\n\n`
      );
    this.paused = true;
    process.stdout.write(MOUSE_OFF);
    const picked = await pickImage(this.gallery, start);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdout.write(MOUSE_ON);
    this.paused = false;
    if (picked) {
      this.last = picked;
      this.print(`  ${dim(`@last is now ${basename(picked)}`)}\n\n`);
    } else this.render();
  }

  private model(mode = this.mode): string {
    return this.models[mode] ?? DEFAULTS[mode];
  }

  private async generate(mode: Mode, raw: string): Promise<void> {
    const usesLast = /(^|\s)@last(?=\s|$)/.test(raw);
    if (usesLast && !this.last)
      return this.print(`  ${red("@last has no file yet")}\n\n`);
    const prompt = raw.replace(/(^|\s)@last(?=\s|$)/g, " ").trim();
    const count = mode === "text" ? 1 : this.count;
    const argv = [mode, "-m", this.model(mode), "--quiet"];
    if (mode !== "text") {
      argv.push("--no-preview", "--n", String(count));
      if (this.ratios[mode] !== "auto")
        argv.push("--aspect-ratio", this.ratios[mode]);
    }
    if (mode === "video" && this.duration !== "auto")
      argv.push("--duration", this.duration);
    if (usesLast)
      argv.push(
        mode === "image" ? "--images" : mode === "video" ? "-i" : "--image",
        this.last!
      );
    if (prompt) argv.push("--", prompt);

    this.print(
      `${wrap(raw, (process.stdout.columns ?? 80) - 3)
        .map((line, index) => `${index ? " " : bold("│")} ${bold(line)}`)
        .join("\n")}\n\n`
    );
    const start = Date.now();
    this.busy = { mode, count, start, tick: 0, shimmer: -SHIMMER_PADDING };
    const timer = setInterval(() => {
      this.busy!.tick++;
      this.render();
    }, 80);
    const errors: string[] = [];
    const notes: string[] = [];
    globalThis.AI_SDK_LOG_WARNINGS = ({ warnings }) => {
      for (const warning of warnings)
        if (warning.type === "unsupported")
          notes.push(
            `${warning.feature} is not supported by this model.${warning.details ? ` ${warning.details}` : ""}`
          );
        else if (warning.type === "other") notes.push(warning.message);
    };
    const write = process.stderr.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      errors.push(String(chunk));
      return true;
    }) as typeof write;
    savedOutputs.length = 0;
    try {
      await this.program.parseAsync(["node", "ai", ...argv]);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    } finally {
      await new Promise((resolve) => setImmediate(resolve));
      process.stderr.write = write;
      clearInterval(timer);
      this.busy = undefined;
      process.exitCode = undefined;
    }
    await this.showResult(mode, Date.now() - start, errors, notes);
  }

  private async showResult(
    mode: Mode,
    elapsedMs: number,
    errors: string[],
    notes: string[]
  ): Promise<void> {
    const outputs = [...savedOutputs];
    const width = process.stdout.columns ?? 80;
    let text = "";
    let grid: GridPlacement | undefined;
    for (const { file, format } of outputs)
      if (format === "md" || format === "txt")
        text += `${wrap(readFileSync(file, "utf8").trim(), width - 4)
          .map((line) => `  ${line}`)
          .join("\n")}\n\n`;
    const media = outputs.filter(
      ({ format }) => format === "image" || format === "video"
    );
    if (media.length && supportsKittyGraphics()) {
      const pngs = await Promise.all(
        media.map(({ file, format }) =>
          (format === "video" ? videoFramePng : toPng)(readFileSync(file))
        )
      );
      grid = {
        offset: text.split("\n").length - 1,
        files: media.map(({ file }) => file),
        perRow: gridColumns(width),
      };
      text += `${thumbnailGrid(pngs, width)}\n`;
    }
    for (const line of errors.join("").split("\n"))
      if (/error/i.test(line) && !/warning/i.test(line))
        for (const part of wrap(line, width - 4)) text += `  ${red(part)}\n`;
    for (const note of notes)
      for (const part of wrap(`! ${note}`, width - 4))
        text += `  ${dim(part)}\n`;
    const files = outputs.map(({ file }) => basename(file)).join("  ");
    text += `  ${dim(truncate(`${formatElapsed(elapsedMs)} · ${this.model(mode)}${files ? ` · ${files}` : ""}`, width - 3))}\n\n`;
    if (outputs.length) this.last = outputs.at(-1)!.file;
    this.gallery.push(
      ...outputs
        .filter(({ format }) => format === "image")
        .map(({ file }) => file)
    );
    this.print(text, grid);
  }

  private liveLines(): { lines: string[]; row: number; col: number } {
    const width = process.stdout.columns ?? 80;
    const lines: string[] = [];
    if (this.busy) {
      const elapsedMs = Date.now() - this.busy.start;
      if (this.busy.mode === "text") {
        const label = `${SPINNER[this.busy.tick % SPINNER.length]} Writing ${formatElapsed(elapsedMs)}`;
        lines.push(`  ${shimmerText(label, this.busy.shimmer)}`);
        this.busy.shimmer = nextShimmerPos(this.busy.shimmer, label.length);
      } else
        lines.push(
          ...loaderFrame(this.busy.count, {
            width,
            tick: this.busy.tick,
            elapsedMs,
            expectedMs: EXPECTED_MS[this.busy.mode],
          })
        );
      lines.push("");
    }
    const room = Math.max(10, width - 4);
    const offset = Math.max(0, this.cursor - room);
    let row = lines.length;
    let col = 2 + this.cursor - offset;
    lines.push(
      `${bold("│")} ${
        this.input
          ? this.input.slice(offset, offset + room)
          : dim(truncate(PLACEHOLDERS[this.mode], width - 4))
      }`
    );
    if (this.picker) {
      const title = `${FIELD_NAMES[this.picker.field]}: `;
      row = lines.length;
      col = 2 + title.length + this.picker.filter.length;
      lines.push(
        `  ${dim(title)}${this.picker.filter}${this.picker.filter ? "" : dim("type to filter")}`
      );
      const options = this.filtered();
      const start = Math.max(
        0,
        Math.min(
          this.picker.index - Math.floor(PICKER_ROWS / 2),
          options.length - PICKER_ROWS
        )
      );
      if (this.picker.loading) lines.push(`  ${dim("Loading models…")}`);
      else if (!options.length) lines.push(`  ${dim("No matches")}`);
      options.slice(start, start + PICKER_ROWS).forEach((option, offset) => {
        const selected = start + offset === this.picker!.index;
        const text = truncate(option, width - 6);
        lines.push(selected ? `  ${inverse(` ${text} `)}` : `   ${text}`);
      });
      if (options.length > PICKER_ROWS)
        lines.push(`  ${dim(`${this.picker.index + 1}/${options.length}`)}`);
    } else
      this.menu().forEach((command, index) => {
        const text = truncate(
          `${command.usage.padEnd(18)} ${command.about}`,
          width - 4
        );
        lines.push(`  ${index === this.menuIndex ? inverse(text) : dim(text)}`);
      });
    lines.push("", this.footer(width), this.hint(width));
    return { lines, row, col };
  }

  private footer(width: number): string {
    const labels = this.fields().map((field) => this.label(field));
    const status = this.busy ? "   generating" : "";
    const chips = labels
      .map((label, index) =>
        this.focus === "settings" && index === this.chip
          ? inverse(` ${label} `)
          : index === 0
            ? bold(label)
            : dim(label)
      )
      .join(dim(" · "));
    return `${labels.join(" · ")}${status}`.length < width - 2
      ? `${chips}${dim(status)}`
      : chips;
  }

  private hint(width: number): string {
    const hint = this.picker
      ? "↑/↓ choose · type to filter · enter apply · esc back"
      : this.focus === "settings"
        ? "←/→ pick · ↑/↓ change · enter list · esc back"
        : "enter generate · tab settings · / commands";
    return dim(truncate(hint, width - 1));
  }

  private render(): void {
    if (this.paused) return;
    const { lines, row, col } = this.liveLines();
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

  private print(text: string, grid?: GridPlacement): void {
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
    this.render();
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

  private quit(): void {
    this.done?.();
  }
}

function truncate(text: string, width: number): string {
  return text.length > width
    ? `${text.slice(0, Math.max(0, width - 1))}…`
    : text;
}

function wrap(text: string, width: number): string[] {
  return text.split("\n").flatMap((paragraph) => {
    const lines: string[] = [];
    let line = "";
    const words = paragraph
      .split(" ")
      .flatMap((word) => word.match(new RegExp(`.{1,${width}}`, "g")) ?? [""]);
    for (const word of words) {
      if (line && line.length + word.length + 1 > width) {
        lines.push(line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    lines.push(line);
    return lines;
  });
}

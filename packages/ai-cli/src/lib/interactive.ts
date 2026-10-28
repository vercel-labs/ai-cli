import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { Key } from "node:readline";

import type { Command } from "./command.js";
import {
  bold,
  captureStderr,
  dim,
  plain,
  red,
  truncate,
  wrap,
} from "./interactive-format.js";
import { Prompt } from "./interactive-input.js";
import { liveLines, type Busy } from "./interactive-render.js";
import {
  Settings,
  filteredOptions,
  modelOptions,
  type Mode,
  type Field,
  type Picker,
} from "./interactive-settings.js";
import { Terminal, type GridPlacement } from "./interactive-terminal.js";
import { supportsKittyGraphics, toPng, videoFramePng } from "./kitty.js";
import { savedOutputs } from "./output.js";
import { formatElapsed } from "./progress.js";
import { SHIMMER_PADDING } from "./shimmer.js";
import { pickImage } from "./slider.js";
import { gridColumns, thumbnailGrid } from "./tui-media.js";

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
  "Tab, Shift+Tab   move through the settings below the prompt, then back",
  "←/→  ↑/↓         choose a setting, change its value",
  "Enter            open the full list (type to filter); Esc goes back",
  "/                commands: /image /video /text /model /n /ratio /gallery ...",
  "@last            put it in a prompt to use the last image as input",
  "Ctrl+D           quit",
];

/** Runs the full-width interactive prompt until the user quits; all output goes to stdout. */
export async function runInteractive(
  program: Command,
  version: string
): Promise<void> {
  await new Tui(program).run(version);
}

class Tui {
  private settings = new Settings();
  private terminal = new Terminal();
  private focus: "input" | "settings" = "input";
  private chip = 0;
  private picker?: Picker;
  private prompt = new Prompt();
  private busy?: Busy;
  private working = false;
  private last?: string;
  private gallery: string[] = [];
  private done?: () => void;

  constructor(private readonly program: Command) {}

  async run(version: string): Promise<void> {
    process.stdout.write(
      `\n${bold("ai")} ${dim(`v${version} · type a prompt · tab for settings · /help`)}\n\n`
    );
    const close = await this.terminal.open(
      (str, key) => this.onKey(str, key),
      () => this.render(),
      (x, y) => this.click(x, y)
    );
    this.render();
    await new Promise<void>((resolve) => {
      this.done = resolve;
    });
    close();
    if (this.working) process.exit(130);
  }

  private safely(work: Promise<void>): void {
    work.catch((error: unknown) =>
      this.print(`  ${red(plain(message(error)))}\n\n`)
    );
  }

  private async click(x: number, y: number): Promise<void> {
    if (this.working) return;
    const file = this.terminal.imageAt(x, y);
    const start = file ? this.gallery.indexOf(file) : -1;
    if (start >= 0) await this.openGallery(start);
  }

  private onKey(str: string | undefined, key: Key): void {
    if (key.ctrl && key.name === "d" && !this.prompt.value) return this.quit();
    if (key.ctrl && key.name === "c") {
      if (this.picker || this.focus === "settings") {
        this.picker = undefined;
        this.focus = "input";
        return this.render();
      }
      return this.prompt.value ? this.setInput("") : this.quit();
    }
    if (this.picker) return this.onPickerKey(str, key);
    if (this.focus === "settings") return this.onSettingsKey(str, key);
    this.onInputKey(str, key);
  }

  private onPickerKey(str: string | undefined, key: Key): void {
    const picker = this.picker!;
    const options = filteredOptions(this.picker);
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
    const fields = this.settings.fields();
    const field = fields[this.chip]!;
    if (key.name === "left" || key.name === "right")
      this.chip =
        (this.chip + (key.name === "left" ? -1 : 1) + fields.length) %
        fields.length;
    else if (key.name === "up" || key.name === "down") {
      if (field === "model") return this.safely(this.openPicker(field));
      const options = this.settings.optionsFor(field);
      const index = options.indexOf(this.settings.current(field));
      this.apply(
        field,
        options[
          (index + (key.name === "up" ? 1 : -1) + options.length) %
            options.length
        ]!
      );
    } else if (key.name === "return" || key.name === "space")
      return this.safely(this.openPicker(field));
    else if (key.name === "tab") {
      const next = this.chip + (key.shift ? -1 : 1);
      if (next < 0 || next >= fields.length) this.focus = "input";
      else this.chip = next;
    } else if (key.name === "escape") this.focus = "input";
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
        const command = menu[this.prompt.menuIndex]!;
        return this.setInput(
          `/${command.name}${command.usage.includes(" ") ? " " : ""}`
        );
      }
      this.focus = "settings";
      this.chip = key.shift ? this.settings.fields().length - 1 : 0;
      return this.render();
    }
    if (key.name === "up" || key.name === "down") {
      const delta = key.name === "up" ? -1 : 1;
      if (menu.length)
        this.prompt.menuIndex =
          (this.prompt.menuIndex + delta + menu.length) % menu.length;
      else this.prompt.recall(delta);
      return this.render();
    }
    if (this.prompt.edit(str, key)) this.render();
  }

  private apply(field: Field, value: string): void {
    this.settings.apply(field, value);
    if (field === "mode")
      this.chip = Math.min(this.chip, this.settings.fields().length - 1);
  }

  private async openPicker(field: Field): Promise<void> {
    this.focus = "settings";
    this.chip = Math.max(0, this.settings.fields().indexOf(field));
    const current = this.settings.current(field);
    if (field !== "model") {
      const options = this.settings.optionsFor(field);
      this.picker = {
        field,
        options,
        filter: "",
        index: Math.max(0, options.indexOf(current)),
        loading: false,
      };
      return this.render();
    }
    const mode = this.settings.mode;
    this.picker = { field, options: [], filter: "", index: 0, loading: true };
    this.render();
    let ids: string[];
    try {
      ids = await modelOptions(mode);
    } catch (error) {
      this.picker = undefined;
      return this.print(`  ${red(message(error))}\n\n`);
    }
    if (this.picker?.field !== "model" || this.settings.mode !== mode) return;
    this.picker.options = ids;
    this.picker.loading = false;
    this.picker.index = Math.max(
      0,
      filteredOptions(this.picker).indexOf(current)
    );
    this.render();
  }

  private setInput(value: string): void {
    this.prompt.set(value);
    this.render();
  }

  private menu() {
    if (!this.prompt.value.startsWith("/") || this.prompt.value.includes(" "))
      return [];
    const typed = this.prompt.value.slice(1);
    const matches = COMMANDS.filter((command) =>
      command.name.startsWith(typed)
    );
    this.prompt.menuIndex = Math.min(
      this.prompt.menuIndex,
      Math.max(0, matches.length - 1)
    );
    return matches;
  }

  private submit(menu: typeof COMMANDS): void {
    let line = this.prompt.value.trim();
    if (menu.length) line = `/${menu[this.prompt.menuIndex]!.name}`;
    if (!line) return;
    if (
      this.working &&
      (!line.startsWith("/") || /^\/(image|video|text)\s+\S/.test(line))
    )
      return;
    this.prompt.remember(line);
    this.setInput("");
    this.safely(
      line.startsWith("/")
        ? this.command(line)
        : this.generate(this.settings.mode, line)
    );
  }

  private async command(line: string): Promise<void> {
    const [name = "", ...rest] = line.slice(1).split(/\s+/);
    const arg = rest.join(" ").trim();
    if (name === "image" || name === "video" || name === "text") {
      this.apply("mode", name);
      this.render();
      if (arg) await this.generate(name, arg);
    } else if (
      name === "model" ||
      name === "n" ||
      name === "ratio" ||
      name === "duration"
    ) {
      const field: Field = name === "n" ? "count" : name;
      if (!this.settings.fields().includes(field))
        return this.print(
          `  ${red(`/${name} does not apply to ${this.settings.mode}`)}\n\n`
        );
      if (!arg) return this.openPicker(field);
      const options = this.settings.optionsFor(field);
      if (options.length && !options.includes(arg))
        return this.print(
          `  ${red(`/${name} takes one of: ${options.join(", ")}`)}\n\n`
        );
      this.apply(field, arg);
      this.render();
    } else if (name === "gallery") {
      if (this.working)
        return this.print(
          `  ${dim("The gallery opens when this generation finishes.")}\n\n`
        );
      await this.openGallery();
    } else if (name === "clear") {
      this.terminal.clear();
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
    this.terminal.paused = true;
    this.terminal.mouse(false);
    let picked: string | undefined;
    try {
      picked = await pickImage(this.gallery, start);
    } finally {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      this.terminal.mouse(true);
      this.terminal.paused = false;
    }
    if (picked) {
      this.last = picked;
      this.print(`  ${dim(`@last is now ${basename(picked)}`)}\n\n`);
    } else this.render();
  }

  private async generate(mode: Mode, raw: string): Promise<void> {
    const usesLast = /(^|\s)@last(?=\s|$)/.test(raw);
    if (usesLast && !this.last)
      return this.print(`  ${red("@last has no image yet")}\n\n`);
    const prompt = raw.replace(/(^|\s)@last(?=\s|$)/g, " ").trim();
    const count = mode === "text" ? 1 : this.settings.count;
    const model = this.settings.model(mode);
    const argv = [mode, "-m", model, "--quiet"];
    if (mode !== "text") {
      argv.push("--no-preview", "--n", String(count));
      if (this.settings.ratios[mode] !== "auto")
        argv.push("--aspect-ratio", this.settings.ratios[mode]);
    }
    if (mode === "video" && this.settings.duration !== "auto")
      argv.push("--duration", this.settings.duration);
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
    this.working = true;
    this.busy = { mode, count, start, tick: 0, shimmer: -SHIMMER_PADDING };
    const timer = setInterval(() => {
      this.busy!.tick++;
      this.render();
    }, 80);
    const errors: string[] = [];
    const captured: string[] = [];
    const notes: string[] = [];
    globalThis.AI_SDK_LOG_WARNINGS = ({ warnings }) => {
      for (const warning of warnings)
        if (warning.type === "unsupported")
          notes.push(
            `${warning.feature} is not supported by this model.${warning.details ? ` ${warning.details}` : ""}`
          );
        else if (warning.type === "other") notes.push(warning.message);
    };
    const release = captureStderr((text) => captured.push(text));
    savedOutputs.length = 0;
    try {
      await this.program.parseAsync(["node", "ai", ...argv]);
    } catch (error) {
      errors.push(message(error));
    } finally {
      await new Promise((resolve) => setImmediate(resolve));
      release();
      clearInterval(timer);
      this.busy = undefined;
      process.exitCode = undefined;
    }
    for (const line of captured.join("").split("\n"))
      if (line.trim() && !/^\(node:\d+\)|^Warning:|--trace-warnings/.test(line))
        errors.push(line);
    try {
      await this.showResult(model, Date.now() - start, errors, notes);
    } finally {
      this.working = false;
    }
  }

  private async showResult(
    model: string,
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
        text += `${wrap(plain(readFileSync(file, "utf8")).trim(), width - 4)
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
    for (const error of errors)
      for (const part of wrap(plain(error), width - 4))
        text += `  ${red(part)}\n`;
    for (const note of notes)
      for (const part of wrap(plain(`! ${note}`), width - 4))
        text += `  ${dim(part)}\n`;
    const files = outputs.map(({ file }) => basename(file)).join("  ");
    text += `  ${dim(truncate(`${formatElapsed(elapsedMs)} · ${model}${files ? ` · ${files}` : ""}`, width - 3))}\n\n`;
    const images = outputs
      .filter(({ format }) => format === "image")
      .map(({ file }) => file);
    this.last = images.at(-1) ?? this.last;
    this.gallery.push(...images);
    this.print(text, grid);
  }

  private render(): void {
    if (this.terminal.paused) return;
    this.terminal.render(
      liveLines(
        {
          settings: this.settings,
          focus: this.focus,
          chip: this.chip,
          picker: this.picker,
          input: this.prompt.value,
          cursor: this.prompt.cursor,
          menuIndex: this.prompt.menuIndex,
          busy: this.busy,
          menu: this.menu(),
        },
        process.stdout.columns ?? 80
      )
    );
  }

  private print(text: string, grid?: GridPlacement): void {
    this.terminal.print(text, grid);
    this.render();
  }

  private quit(): void {
    this.done?.();
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

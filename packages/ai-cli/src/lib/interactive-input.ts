import type { Key } from "node:readline";

export class Prompt {
  value = "";
  cursor = 0;
  menuIndex = 0;
  private history: string[] = [];
  private historyIndex = 0;

  set(value: string): void {
    this.value = value;
    this.cursor = value.length;
    this.menuIndex = 0;
  }

  recall(delta: number): void {
    const index = Math.min(
      this.history.length,
      Math.max(0, this.historyIndex + delta)
    );
    this.historyIndex = index;
    this.set(this.history[index] ?? "");
  }

  remember(line: string): void {
    this.history = [...this.history.filter((item) => item !== line), line];
    this.historyIndex = this.history.length;
  }

  edit(str: string | undefined, key: Key): boolean {
    if (key.name === "left") this.cursor = step(this.value, this.cursor, -1);
    else if (key.name === "right")
      this.cursor = step(this.value, this.cursor, 1);
    else if (key.name === "home" || (key.ctrl && key.name === "a"))
      this.cursor = 0;
    else if (key.name === "end" || (key.ctrl && key.name === "e"))
      this.cursor = this.value.length;
    else if (key.ctrl && key.name === "u") {
      this.set("");
      return true;
    } else if (key.ctrl && key.name === "w") {
      const head = this.value.slice(0, this.cursor).replace(/\S+\s*$/, "");
      this.value = head + this.value.slice(this.cursor);
      this.cursor = head.length;
    } else if (key.name === "backspace") {
      const start = step(this.value, this.cursor, -1);
      this.value = this.value.slice(0, start) + this.value.slice(this.cursor);
      this.cursor = start;
      this.menuIndex = 0;
    } else if (key.name === "delete")
      this.value =
        this.value.slice(0, this.cursor) +
        this.value.slice(step(this.value, this.cursor, 1));
    else if (key.name === "escape") {
      this.set("");
      return true;
    } else if (str && !key.ctrl && !key.meta && str >= " ") {
      this.value =
        this.value.slice(0, this.cursor) + str + this.value.slice(this.cursor);
      this.cursor += str.length;
      this.menuIndex = 0;
    } else return false;
    return true;
  }
}

const graphemes = new Intl.Segmenter();

/** Moves a string offset one user-visible character left or right, so emoji, flags and accents stay whole. */
function step(text: string, index: number, direction: -1 | 1): number {
  const bounds = [
    0,
    ...Array.from(
      graphemes.segment(text),
      ({ index: start, segment }) => start + segment.length
    ),
  ];
  return direction < 0
    ? (bounds.findLast((bound) => bound < index) ?? 0)
    : (bounds.find((bound) => bound > index) ?? text.length);
}

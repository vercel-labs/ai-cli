import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { emitKeypressEvents, type Key } from "node:readline";

import { isColorEnabled } from "./color.js";
import { deleteImage, displayImage } from "./kitty.js";

const IMAGE_ID = 7351;

const dim = (text: string) =>
  isColorEnabled() ? `\x1b[2m${text}\x1b[0m` : text;

/** Shows images one at a time in the alternate screen, starting at `start`, and returns the file picked with Enter or undefined on Esc. */
export async function pickImage(
  files: string[],
  start = 0
): Promise<string | undefined> {
  const { stderr } = process;
  let index = start;
  let rendering = Promise.resolve();
  const render = async () => {
    const rows = stderr.rows ?? 24;
    deleteImage(IMAGE_ID);
    stderr.write("\x1b[2J\x1b[H");
    await displayImage(readFileSync(files[index]!), {
      id: IMAGE_ID,
      columns: stderr.columns ?? 80,
      rows: rows - 2,
    });
    stderr.write(
      `\x1b[${rows};1H\x1b[K◀ ${index + 1}/${files.length} ▶  ${basename(files[index]!)}  ${dim("←/→ browse · enter pick · esc cancel")}`
    );
  };

  stderr.write("\x1b[?1049h\x1b[?25l");
  rendering = rendering.then(render);
  const confirmed = await readArrows((delta) => {
    index = (index + delta + files.length) % files.length;
    rendering = rendering.then(render);
  });
  await rendering;
  deleteImage(IMAGE_ID);
  stderr.write("\x1b[?25h\x1b[?1049l");
  return confirmed ? files[index] : undefined;
}

/** Calls onStep with -1 or 1 for ←/→ and resolves true on Enter, or false on Esc or Ctrl+C. */
async function readArrows(onStep: (delta: number) => void): Promise<boolean> {
  const { stdin } = process;
  emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  stdin.resume();
  const confirmed = await new Promise<boolean>((resolve) => {
    const onKeypress = (_: string, key: Key) => {
      if (key.name === "left") onStep(-1);
      else if (key.name === "right") onStep(1);
      else if (
        key.name === "return" ||
        key.name === "escape" ||
        (key.ctrl && key.name === "c")
      ) {
        stdin.off("keypress", onKeypress);
        resolve(key.name === "return");
      }
    };
    stdin.on("keypress", onKeypress);
  });
  stdin.setRawMode(false);
  stdin.pause();
  return confirmed;
}

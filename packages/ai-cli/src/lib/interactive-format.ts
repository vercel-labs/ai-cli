import { isColorEnabled } from "./color.js";

const style = (code: string) => (text: string) =>
  isColorEnabled() ? `\x1b[${code}m${text}\x1b[0m` : text;
export const bold = style("1");
export const dim = style("2");
export const red = style("31");
export const inverse = style("7");

export function truncate(text: string, width: number): string {
  return text.length > width
    ? `${text.slice(0, Math.max(0, width - 1))}…`
    : text;
}

export function wrap(text: string, width: number): string[] {
  return text.split("\n").flatMap((source) => {
    if (source.length <= width) return [source];
    const indent = source.match(/^\s*/)![0].slice(0, Math.floor(width / 2));
    const paragraph = source.trimStart();
    const room = width - indent.length;
    const lines: string[] = [];
    let line = "";
    const words = paragraph
      .split(" ")
      .flatMap((word) => word.match(new RegExp(`.{1,${room}}`, "g")) ?? [""]);
    for (const word of words) {
      if (line && line.length + word.length + 1 > room) {
        lines.push(line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    lines.push(line);
    return lines.map((item) => indent + item);
  });
}

/** Removes control characters except newlines and tabs, so model output cannot move the cursor, clear the screen or write the clipboard. */
export function plain(text: string): string {
  return Array.from(text)
    .filter((char) => {
      const code = char.codePointAt(0)!;
      return (
        code === 9 || code === 10 || (code >= 32 && (code < 127 || code >= 160))
      );
    })
    .join("");
}

let original: typeof process.stderr.write | undefined;
let sinks: Array<(text: string) => void> = [];

/** Sends stderr writes to `sink` until the returned function runs; overlapping captures restore stderr once the last one ends. */
export function captureStderr(sink: (text: string) => void): () => void {
  if (!original) {
    original = process.stderr.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      for (const each of sinks) each(String(chunk));
      return true;
    }) as typeof original;
  }
  sinks.push(sink);
  return () => {
    sinks = sinks.filter((each) => each !== sink);
    if (!sinks.length && original) {
      process.stderr.write = original;
      original = undefined;
    }
  };
}

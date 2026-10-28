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

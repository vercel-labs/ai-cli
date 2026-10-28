import { expect, test } from "vitest";

import { plain, wrap } from "./interactive-format.js";

test("wrap keeps short lines as they are and indents wrapped code", () => {
  expect(wrap("if ready:\n    run()", 20)).toEqual(["if ready:", "    run()"]);
  expect(wrap("    call(alpha, beta, gamma)", 16)).toEqual([
    "    call(alpha,",
    "    beta, gamma)",
  ]);
  expect(wrap("x".repeat(12), 5)).toEqual(["xxxxx", "xxxxx", "xx"]);
});

test("wrap gives every line the full width after long indented lines", () => {
  const indented = `    ${"word ".repeat(20).trim()}`;
  const lines = wrap(`${indented}\n${indented}\n${"x ".repeat(30).trim()}`, 40);
  expect(lines.at(-2)).toHaveLength(39);
});

test("plain drops terminal control sequences but keeps newlines and tabs", () => {
  expect(plain("a\x1b[2Jb\x1b]52;c;aGk=\x07c\td\r\ne\x9b")).toBe(
    "a[2Jb]52;c;aGk=c\td\ne"
  );
});

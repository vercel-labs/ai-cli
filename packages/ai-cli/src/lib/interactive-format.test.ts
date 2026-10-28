import { expect, test } from "vitest";

import { wrap } from "./interactive-format.js";

test("wrap keeps short lines as they are and indents wrapped code", () => {
  expect(wrap("if ready:\n    run()", 20)).toEqual(["if ready:", "    run()"]);
  expect(wrap("    call(alpha, beta, gamma)", 16)).toEqual([
    "    call(alpha,",
    "    beta, gamma)",
  ]);
  expect(wrap("x".repeat(12), 5)).toEqual(["xxxxx", "xxxxx", "xx"]);
});

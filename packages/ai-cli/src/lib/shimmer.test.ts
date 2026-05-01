import { describe, expect, test } from "bun:test";

import { shimmerText, nextShimmerPos, SHIMMER_PADDING } from "./shimmer.js";

describe("shimmerText", () => {
  test("returns empty string unchanged", () => {
    expect(shimmerText("", 0)).toBe("");
  });

  test("returns plain text when NO_COLOR is set", () => {
    const prev = process.env.NO_COLOR;
    process.env.NO_COLOR = "1";
    try {
      expect(shimmerText("hello", 2)).toBe("hello");
    } finally {
      if (prev === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = prev;
    }
  });
});

describe("nextShimmerPos", () => {
  test("increments position by 1", () => {
    expect(nextShimmerPos(0, 20)).toBe(1);
    expect(nextShimmerPos(5, 20)).toBe(6);
  });

  test("wraps around after passing text length + padding + gap", () => {
    const textLen = 10;
    const wrapPoint = textLen + SHIMMER_PADDING + 6;
    expect(nextShimmerPos(wrapPoint, textLen)).toBe(-SHIMMER_PADDING);
  });

  test("does not wrap before threshold", () => {
    const textLen = 10;
    const beforeWrap = textLen + SHIMMER_PADDING + 5;
    expect(nextShimmerPos(beforeWrap, textLen)).toBe(beforeWrap + 1);
  });
});

import { describe, expect, test } from "bun:test";

import {
  parsePositiveInt,
  parseNonNegativeFloat,
  parseSize,
  parseAspectRatio,
  parseTemperature,
} from "./parse.js";

describe("parsePositiveInt", () => {
  test("parses valid positive integers", () => {
    expect(parsePositiveInt("1", "count")).toBe(1);
    expect(parsePositiveInt("42", "count")).toBe(42);
    expect(parsePositiveInt("1000", "count")).toBe(1000);
  });

  test("throws on zero", () => {
    expect(() => parsePositiveInt("0", "count")).toThrow("positive integer");
  });

  test("throws on negative", () => {
    expect(() => parsePositiveInt("-1", "count")).toThrow("positive integer");
  });

  test("throws on non-numeric", () => {
    expect(() => parsePositiveInt("abc", "count")).toThrow("positive integer");
  });

  test("rejects float string", () => {
    expect(() => parsePositiveInt("1.5", "count")).toThrow("positive integer");
  });

  test("rejects string with trailing non-digits", () => {
    expect(() => parsePositiveInt("10px", "count")).toThrow("positive integer");
  });

  test("includes flag name in error", () => {
    expect(() => parsePositiveInt("bad", "max-tokens")).toThrow("--max-tokens");
  });
});

describe("parseNonNegativeFloat", () => {
  test("parses valid non-negative floats", () => {
    expect(parseNonNegativeFloat("0", "temperature")).toBe(0);
    expect(parseNonNegativeFloat("1.5", "temperature")).toBe(1.5);
    expect(parseNonNegativeFloat("2", "temperature")).toBe(2);
  });

  test("throws on negative", () => {
    expect(() => parseNonNegativeFloat("-0.1", "temperature")).toThrow(
      "non-negative"
    );
  });

  test("throws on non-numeric", () => {
    expect(() => parseNonNegativeFloat("abc", "temperature")).toThrow(
      "non-negative"
    );
  });

  test("includes flag name in error", () => {
    expect(() => parseNonNegativeFloat("bad", "temperature")).toThrow(
      "--temperature"
    );
  });
});

describe("parseSize", () => {
  test("parses valid sizes", () => {
    expect(parseSize("1024x1024")).toBe("1024x1024");
    expect(parseSize("512x768")).toBe("512x768");
  });

  test("rejects invalid formats", () => {
    expect(() => parseSize("abc")).toThrow("WxH format");
    expect(() => parseSize("1024")).toThrow("WxH format");
    expect(() => parseSize("1024x")).toThrow("WxH format");
    expect(() => parseSize("16:9")).toThrow("WxH format");
  });
});

describe("parseAspectRatio", () => {
  test("parses valid ratios", () => {
    expect(parseAspectRatio("16:9")).toBe("16:9");
    expect(parseAspectRatio("1:1")).toBe("1:1");
    expect(parseAspectRatio("4:3")).toBe("4:3");
  });

  test("rejects invalid formats", () => {
    expect(() => parseAspectRatio("abc")).toThrow("W:H format");
    expect(() => parseAspectRatio("16")).toThrow("W:H format");
    expect(() => parseAspectRatio("16x9")).toThrow("W:H format");
    expect(() => parseAspectRatio("16:")).toThrow("W:H format");
  });
});

describe("parseTemperature", () => {
  test("parses valid temperatures", () => {
    expect(parseTemperature("0")).toBe(0);
    expect(parseTemperature("1")).toBe(1);
    expect(parseTemperature("1.5")).toBe(1.5);
    expect(parseTemperature("2")).toBe(2);
  });

  test("rejects out of range", () => {
    expect(() => parseTemperature("-0.1")).toThrow("between 0 and 2");
    expect(() => parseTemperature("2.1")).toThrow("between 0 and 2");
  });

  test("rejects non-numeric", () => {
    expect(() => parseTemperature("abc")).toThrow("between 0 and 2");
  });
});

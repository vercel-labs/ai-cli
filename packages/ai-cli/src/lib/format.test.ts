import { describe, expect, test } from "bun:test";

import {
  formatLatency,
  formatPerUnitPrice,
  formatPricePerMillion,
  formatReleaseDate,
  formatThroughput,
  formatTokenCount,
  formatUptime,
  formatWebSearchPrice,
} from "./format.js";

describe("formatTokenCount", () => {
  test("formats millions", () => {
    expect(formatTokenCount(1_000_000)).toBe("1M");
    expect(formatTokenCount(2_000_000)).toBe("2M");
    expect(formatTokenCount(1_500_000)).toBe("1.5M");
  });

  test("formats thousands rounded to nearest K", () => {
    expect(formatTokenCount(128_000)).toBe("128K");
    expect(formatTokenCount(262_144)).toBe("262K");
    expect(formatTokenCount(40_960)).toBe("41K");
    expect(formatTokenCount(16_384)).toBe("16K");
  });

  test("passes through sub-thousand counts", () => {
    expect(formatTokenCount(512)).toBe("512");
  });
});

describe("formatPricePerMillion", () => {
  test("converts per-token price to per-million", () => {
    expect(formatPricePerMillion("0.00001")).toBe("$10/M");
    expect(formatPricePerMillion("0.00005")).toBe("$50/M");
    expect(formatPricePerMillion("0.000005")).toBe("$5/M");
  });

  test("trims trailing zeros", () => {
    expect(formatPricePerMillion("0.000001")).toBe("$1/M");
    expect(formatPricePerMillion("0.0000125")).toBe("$12.5/M");
    expect(formatPricePerMillion("0.0000005")).toBe("$0.5/M");
  });

  test("keeps small prices precise", () => {
    expect(formatPricePerMillion("0.00000012")).toBe("$0.12/M");
    expect(formatPricePerMillion("0.000000075")).toBe("$0.075/M");
  });

  test("formats zero", () => {
    expect(formatPricePerMillion("0")).toBe("$0/M");
  });

  test("returns non-numeric input unchanged", () => {
    expect(formatPricePerMillion("n/a")).toBe("n/a");
  });
});

describe("formatWebSearchPrice", () => {
  test("formats per-thousand-searches price", () => {
    expect(formatWebSearchPrice("10")).toBe("$10/K + input costs");
    expect(formatWebSearchPrice("35")).toBe("$35/K + input costs");
    expect(formatWebSearchPrice("12.50")).toBe("$12.5/K + input costs");
  });
});

describe("formatPerUnitPrice", () => {
  test("formats per-unit prices", () => {
    expect(formatPerUnitPrice("0.02", "image")).toBe("$0.02/image");
    expect(formatPerUnitPrice("0.04", "image")).toBe("$0.04/image");
  });
});

describe("formatLatency", () => {
  test("formats milliseconds as seconds with one decimal", () => {
    expect(formatLatency(1433.5)).toBe("1.4s");
    expect(formatLatency(6500)).toBe("6.5s");
    expect(formatLatency(940)).toBe("0.9s");
    expect(formatLatency(2000)).toBe("2s");
  });
});

describe("formatThroughput", () => {
  test("rounds to whole tokens per second", () => {
    expect(formatThroughput(48.5)).toBe("49tps");
    expect(formatThroughput(95)).toBe("95tps");
  });
});

describe("formatUptime", () => {
  test("floors to one decimal and trims", () => {
    expect(formatUptime(100)).toBe("100%");
    expect(formatUptime(99.9904)).toBe("99.9%");
    expect(formatUptime(99.95)).toBe("99.9%");
  });
});

describe("formatReleaseDate", () => {
  test("formats unix seconds as UTC date", () => {
    expect(formatReleaseDate(1770249600)).toBe("2026-02-05");
    expect(formatReleaseDate(1745798400)).toBe("2025-04-28");
  });
});

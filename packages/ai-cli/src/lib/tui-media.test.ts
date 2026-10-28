import { afterEach, describe, expect, test, vi } from "vitest";

import { png } from "../test/media.js";
import {
  THUMB_ROWS,
  gridColumns,
  loaderFrame,
  thumbnailGrid,
} from "./tui-media.js";

const ESC = String.fromCharCode(27);
const strip = (s: string) =>
  s.replaceAll(new RegExp(`${ESC}\\[[0-9;]*m`, "g"), "");
const opts = { width: 60, tick: 3, elapsedMs: 5000, expectedMs: 20000 };

afterEach(() => vi.unstubAllEnvs());

describe("loaderFrame", () => {
  test("wraps tiles into rows that fit the width", () => {
    expect(gridColumns(60)).toBe(2);
    expect(loaderFrame(1, opts)).toHaveLength(THUMB_ROWS);
    expect(loaderFrame(2, opts)).toHaveLength(THUMB_ROWS);
    expect(loaderFrame(5, opts)).toHaveLength(THUMB_ROWS * 3);
    expect(loaderFrame(2, { ...opts, width: 10 })).toHaveLength(THUMB_ROWS * 2);
  });

  test("keeps lines within width - 1, with and without color", () => {
    for (const force of ["1", undefined]) {
      if (force) vi.stubEnv("FORCE_COLOR", force);
      else vi.stubEnv("NO_COLOR", "1");
      for (const width of [10, 60, 120]) {
        for (const line of loaderFrame(5, { ...opts, width })) {
          expect(strip(line).length).toBeLessThanOrEqual(
            Math.max(width - 1, 24)
          );
        }
      }
    }
  });

  test("never shows 100% and is deterministic", () => {
    vi.stubEnv("NO_COLOR", "1");
    const late = { ...opts, elapsedMs: 1e9 };
    const frame = loaderFrame(2, late).join("\n");
    expect(frame).toContain("99%");
    expect(frame).not.toContain("100%");
    expect(loaderFrame(2, late).join("\n")).toBe(frame);
  });
});

describe("loaderFrame triangle", () => {
  test("fills solid rows from the bottom as time passes", () => {
    vi.stubEnv("NO_COLOR", "1");
    const solid = (elapsedMs: number) =>
      (
        loaderFrame(1, { ...opts, elapsedMs })
          .join("")
          .match(/█/g) ?? []
      ).length;
    expect(solid(0)).toBe(0);
    expect(solid(2000)).toBeLessThan(solid(10000));
    expect(solid(10000)).toBeLessThan(solid(1e9));
  });
});

describe("thumbnailGrid", () => {
  test("places one image per png and a placeholder for missing ones", () => {
    const out = thumbnailGrid([png, undefined, png], 60);
    expect(out.match(new RegExp(`${ESC}_Ga=T`, "g"))).toHaveLength(2);
    expect(out).toContain("no preview");
    expect(out.match(/\n/g)).toHaveLength(THUMB_ROWS * 2);
    expect(out.endsWith(`\x1b[${THUMB_ROWS}B\x1b[1G`)).toBe(true);
  });
});

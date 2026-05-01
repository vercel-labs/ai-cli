import { describe, expect, test } from "bun:test";

import { pMap } from "./p-map.js";

describe("pMap", () => {
  test("maps items with fulfilled results", async () => {
    const results = await pMap([1, 2, 3], async (x) => x * 2, 2);
    expect(results).toEqual([
      { status: "fulfilled", value: 2 },
      { status: "fulfilled", value: 4 },
      { status: "fulfilled", value: 6 },
    ]);
  });

  test("captures rejections without stopping others", async () => {
    const results = await pMap(
      [1, 2, 3],
      async (x) => {
        if (x === 2) throw new Error("fail");
        return x;
      },
      3
    );
    expect(results[0]).toEqual({ status: "fulfilled", value: 1 });
    expect(results[1].status).toBe("rejected");
    expect(results[2]).toEqual({ status: "fulfilled", value: 3 });
  });

  test("handles empty input", async () => {
    const results = await pMap([], async (x: number) => x, 4);
    expect(results).toEqual([]);
  });

  test("respects concurrency limit", async () => {
    let active = 0;
    let maxActive = 0;

    await pMap(
      [1, 2, 3, 4, 5, 6],
      async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 10));
        active--;
      },
      2
    );

    expect(maxActive).toBeLessThanOrEqual(2);
  });

  test("passes correct indices to callback", async () => {
    const indices: number[] = [];
    await pMap(
      ["a", "b", "c"],
      async (_, i) => {
        indices.push(i);
      },
      1
    );
    expect(indices).toEqual([0, 1, 2]);
  });
});

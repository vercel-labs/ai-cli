import { describe, expect, test } from "bun:test";
import { Readable } from "node:stream";
import { setTimeout } from "node:timers/promises";

import { readStdin, stdinAsText } from "./stdin.js";

describe("stdin", () => {
  test("waits for a slow upstream command instead of discarding input after one second", async () => {
    const input = Readable.from(
      (async function* () {
        await setTimeout(1100);
        yield "first";
        yield " second";
      })()
    );
    expect(stdinAsText((await readStdin(input))!)).toBe("first second");
  });

  test("empty input is null and binary chunks remain intact", async () => {
    expect(await readStdin(Readable.from([]))).toBeNull();
    expect(await readStdin(Readable.from([Buffer.from([0, 255])]))).toEqual(
      new Uint8Array([0, 255])
    );
  });

  test("input errors propagate instead of appearing to be empty input", async () => {
    const input = Readable.from(
      (async function* () {
        yield "partial";
        throw new Error("upstream failed");
      })()
    );
    await expect(readStdin(input)).rejects.toThrow("upstream failed");
  });
});

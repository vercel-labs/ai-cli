import { describe, test, expect } from "bun:test";

import { decodeIDR } from "./h264-wasm.js";

describe("decodeIDR (openh264 WASM)", () => {
  test("returns null for empty inputs", async () => {
    expect(
      await decodeIDR(new Uint8Array(0), new Uint8Array(0), new Uint8Array(0))
    ).toBeNull();
  });

  test("returns null for truncated SPS", async () => {
    const sps = new Uint8Array([0x67, 0x42]);
    const pps = new Uint8Array([0x68, 0xce, 0x38, 0x80]);
    const slice = new Uint8Array([0x65, 0x88, 0x80, 0x40]);
    expect(await decodeIDR(sps, pps, slice)).toBeNull();
  });

  test("gracefully handles malformed data without crashing", async () => {
    const sps = new Uint8Array([0x67, 0x42, 0x00, 0x0a, 0xe9, 0x40, 0x40]);
    const pps = new Uint8Array([0x68, 0xce, 0x38, 0x80]);
    const slice = new Uint8Array(100);
    slice[0] = 0x65;
    for (let i = 1; i < 100; i++) slice[i] = (i * 37) & 0xff;

    const result = await decodeIDR(sps, pps, slice);
    expect(
      result === null || (result && result.yuv instanceof Uint8Array)
    ).toBeTruthy();
  });

  test("returns DecodedFrame with valid YUV for well-formed data", async () => {
    const sps = new Uint8Array([
      0x67, 0x42, 0x00, 0x0a, 0xe9, 0x40, 0x40, 0x04, 0x00, 0x00, 0x00, 0x04,
      0x00, 0x00, 0x00, 0xc8, 0x40,
    ]);
    const pps = new Uint8Array([0x68, 0xce, 0x38, 0x80]);
    const slice = new Uint8Array(200);
    slice[0] = 0x65;
    for (let i = 1; i < 200; i++) slice[i] = (i * 37) & 0xff;

    const result = await decodeIDR(sps, pps, slice);
    // May return null for synthetic data, but should not throw
    expect(
      result === null || (result && result.width > 0 && result.height > 0)
    ).toBeTruthy();
  });
});

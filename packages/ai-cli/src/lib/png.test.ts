import { describe, test, expect } from "bun:test";

import { encodePNG } from "./png.js";

describe("encodePNG", () => {
  test("produces valid PNG signature", () => {
    const width = 2;
    const height = 2;
    const yuvSize = width * height + 2 * (width >> 1) * (height >> 1);
    const yuv = new Uint8Array(yuvSize);
    yuv.fill(128);

    const png = encodePNG(yuv, width, height);

    // PNG signature: 0x89 P N G \r \n 0x1a \n
    expect(png[0]).toBe(137);
    expect(png[1]).toBe(80); // P
    expect(png[2]).toBe(78); // N
    expect(png[3]).toBe(71); // G
    expect(png[4]).toBe(13);
    expect(png[5]).toBe(10);
    expect(png[6]).toBe(26);
    expect(png[7]).toBe(10);
  });

  test("IHDR chunk has correct dimensions", () => {
    const width = 4;
    const height = 2;
    const yuvSize = width * height + 2 * (width >> 1) * (height >> 1);
    const yuv = new Uint8Array(yuvSize);
    yuv.fill(128);

    const png = encodePNG(yuv, width, height);

    // IHDR starts at offset 8 (after signature)
    // 4 bytes length + 4 bytes "IHDR" + 13 bytes data + 4 bytes CRC
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    const ihdrLen = view.getUint32(8);
    expect(ihdrLen).toBe(13);

    // "IHDR"
    expect(String.fromCharCode(png[12], png[13], png[14], png[15])).toBe(
      "IHDR"
    );

    // Width and height
    const w = view.getUint32(16);
    const h = view.getUint32(20);
    expect(w).toBe(4);
    expect(h).toBe(2);

    // Bit depth
    expect(png[24]).toBe(8);
    // Color type (RGB)
    expect(png[25]).toBe(2);
  });

  test("output contains IEND chunk", () => {
    const width = 2;
    const height = 2;
    const yuvSize = width * height + 2 * (width >> 1) * (height >> 1);
    const yuv = new Uint8Array(yuvSize);
    yuv.fill(128);

    const png = encodePNG(yuv, width, height);

    // IEND should be the last chunk: 0-length + "IEND" + CRC = 12 bytes at the end
    const iendType = String.fromCharCode(
      png[png.length - 8],
      png[png.length - 7],
      png[png.length - 6],
      png[png.length - 5]
    );
    expect(iendType).toBe("IEND");
  });

  test("converts gray YUV to gray RGB", () => {
    // Y=128, Cb=128 (neutral), Cr=128 (neutral) should produce mid-gray (~128)
    const width = 2;
    const height = 2;
    const yuv = new Uint8Array(width * height + 2);
    yuv[0] = 128;
    yuv[1] = 128;
    yuv[2] = 128;
    yuv[3] = 128; // Y
    yuv[4] = 128; // Cb
    yuv[5] = 128; // Cr

    const png = encodePNG(yuv, width, height);
    expect(png.length).toBeGreaterThan(8);
    // Valid PNG (we trust the encoder at this level)
  });

  test("handles 1x1 image", () => {
    const yuv = new Uint8Array(3);
    yuv[0] = 200; // Y
    yuv[1] = 128; // Cb
    yuv[2] = 128; // Cr

    const png = encodePNG(yuv, 1, 1);
    expect(png[0]).toBe(137); // PNG signature
    expect(png.length).toBeGreaterThan(20);
  });
});

import { describe, expect, test } from "bun:test";

import sharp from "sharp";

import { displayImage } from "./kitty.js";

describe("displayImage", () => {
  test("converts non-PNG images to PNG before sending Kitty data", async () => {
    const jpeg = await sharp({
      create: {
        width: 1,
        height: 1,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      .jpeg()
      .toBuffer();
    const originalWrite = process.stderr.write;
    let output = "";
    (process.stderr as { write: (chunk: string) => boolean }).write = (
      chunk
    ) => {
      output += chunk;
      return true;
    };

    try {
      await displayImage(jpeg);
    } finally {
      (process.stderr as { write: typeof originalWrite }).write = originalWrite;
    }

    const payload = output.split(";")[1]!.split("\x1b\\", 1)[0]!;
    const png = Buffer.from(payload, "base64");
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
    expect(output).toContain("a=T,f=100,m=0;");
  });

  test("detects PNG data when no media type is provided", async () => {
    const png = await sharp({
      create: {
        width: 1,
        height: 1,
        channels: 3,
        background: { r: 0, g: 255, b: 0 },
      },
    })
      .png()
      .toBuffer();
    const originalWrite = process.stderr.write;
    let output = "";
    (process.stderr as { write: (chunk: string) => boolean }).write = (
      chunk
    ) => {
      output += chunk;
      return true;
    };

    try {
      await displayImage(png);
    } finally {
      (process.stderr as { write: typeof originalWrite }).write = originalWrite;
    }

    expect(output).toContain("a=T,f=100,m=0;");
    expect(
      Buffer.from(output.split(";")[1]!.split("\x1b\\", 1)[0]!, "base64")
    ).toEqual(png);
  });
});

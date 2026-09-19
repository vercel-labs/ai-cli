import { describe, expect, test } from "bun:test";

import sharp from "sharp";

import { displayImage } from "./kitty.js";

async function capturePreview(buf: Buffer): Promise<{
  output: string;
  png: Buffer;
}> {
  const originalWrite = process.stderr.write;
  let output = "";
  (process.stderr as { write: (chunk: string) => boolean }).write = (chunk) => {
    output += chunk;
    return true;
  };

  try {
    await displayImage(buf);
  } finally {
    (process.stderr as { write: typeof originalWrite }).write = originalWrite;
  }

  const payload = output
    .split("\x1b_G")
    .slice(1)
    .map((chunk) => {
      const payloadStart = chunk.indexOf(";") + 1;
      const payloadEnd = chunk.indexOf("\x1b\\");
      return chunk.slice(payloadStart, payloadEnd);
    })
    .join("");

  return { output, png: Buffer.from(payload, "base64") };
}

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
    const { output, png } = await capturePreview(jpeg);

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
    const preview = await capturePreview(png);

    expect(preview.output).toContain("a=T,f=100,m=0;");
    expect(preview.png).toEqual(png);
  });

  test("renders SVG previews larger on an opaque white background", async () => {
    const svg = Buffer.from(`
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="8" viewBox="0 0 16 8">
        <rect x="6" y="2" width="4" height="4" fill="black" />
      </svg>
    `);

    const { png } = await capturePreview(svg);
    const rendered = await sharp(png)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    expect(rendered.info.width).toBe(512);
    expect(rendered.info.height).toBe(256);
    expect([...rendered.data.subarray(0, 4)]).toEqual([255, 255, 255, 255]);
  });
});

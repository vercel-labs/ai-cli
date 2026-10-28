import sharp from "sharp";
import { describe, expect, test } from "vitest";

import { png as fixturePng } from "../test/media.js";
import { displayImage, kittyPlace, type ImageBox } from "./kitty.js";

async function capturePreview(
  buf: Buffer,
  box?: ImageBox
): Promise<{
  output: string;
  png: Buffer;
  writes: string[];
}> {
  const originalWrite = process.stderr.write;
  let output = "";
  const writes: string[] = [];
  (process.stderr as { write: (chunk: string) => boolean }).write = (chunk) => {
    writes.push(chunk);
    output += chunk;
    return true;
  };

  try {
    await displayImage(buf, box);
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

  return { output, png: Buffer.from(payload, "base64"), writes };
}

describe("displayImage", () => {
  test.each([
    { size: 3069, packets: [["a=T,f=100,m=0", 0, 4092]] },
    { size: 3072, packets: [["a=T,f=100,m=0", 0, 4096]] },
    {
      size: 3075,
      packets: [
        ["a=T,f=100,m=1", 0, 4096],
        ["m=0", 4096, 4100],
      ],
    },
    {
      size: 6144,
      packets: [
        ["a=T,f=100,m=1", 0, 4096],
        ["m=0", 4096, 8192],
      ],
    },
    {
      size: 6147,
      packets: [
        ["a=T,f=100,m=1", 0, 4096],
        ["m=1", 4096, 8192],
        ["m=0", 8192, 8196],
      ],
    },
  ] as const)(
    "preserves packets and write order for $size bytes",
    async ({ size, packets }) => {
      const input = Buffer.concat([
        fixturePng,
        Buffer.alloc(size - fixturePng.length),
      ]);
      const encoded = input.toString("base64");
      const expected = packets
        .map(
          ([control, start, end]) =>
            `\x1b_G${control};${encoded.slice(start, end)}\x1b\\`
        )
        .join("");
      const preview = await capturePreview(input);

      expect(preview.writes).toEqual([expected, "\n"]);
      expect(preview.png).toEqual(input);
    }
  );

  test.each([
    { columns: 22, rows: 10, fit: "r=10" },
    { columns: 20, rows: 10, fit: "r=10" },
    { columns: 10, rows: 10, fit: "c=10" },
  ])(
    "preserves boxed placement for $columns columns and $rows rows",
    async ({ columns, rows, fit }) => {
      const preview = await capturePreview(fixturePng, {
        id: 0,
        columns,
        rows,
      });

      expect(preview.writes).toEqual([
        `\x1b_Ga=T,f=100,i=0,q=2,${fit},m=0;${fixturePng.toString("base64")}\x1b\\`,
        "\n",
      ]);
    }
  );

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

describe("kittyPlace", () => {
  test("preserves cursor placement without an image id or trailing newline", () => {
    expect(
      kittyPlace(fixturePng, { columns: 22, rows: 10, keepCursor: true })
    ).toBe(
      `\x1b_Ga=T,f=100,q=2,C=1,r=10,m=0;${fixturePng.toString("base64")}\x1b\\`
    );
  });
});

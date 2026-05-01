import { deflateSync } from "zlib";

export function encodePNG(
  yuv: Uint8Array,
  width: number,
  height: number
): Buffer {
  const chromaW = width >> 1;

  const lumaOffset = 0;
  const cbOffset = width * height;
  const crOffset = cbOffset + chromaW * (height >> 1);

  // YUV420 -> RGB, with PNG filter byte per row
  const rowSize = width * 3 + 1;
  const raw = Buffer.alloc(rowSize * height);

  for (let y = 0; y < height; y++) {
    raw[y * rowSize] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const yVal = yuv[lumaOffset + y * width + x];
      const cb = yuv[cbOffset + (y >> 1) * chromaW + (x >> 1)] - 128;
      const cr = yuv[crOffset + (y >> 1) * chromaW + (x >> 1)] - 128;

      const r = yVal + 1.402 * cr;
      const g = yVal - 0.344136 * cb - 0.714136 * cr;
      const b = yVal + 1.772 * cb;

      const off = y * rowSize + 1 + x * 3;
      raw[off] = clamp(r);
      raw[off + 1] = clamp(g);
      raw[off + 2] = clamp(b);
    }
  }

  const compressed = deflateSync(raw);

  // Build PNG file
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const ihdrChunk = makeChunk("IHDR", ihdr);
  const idatChunk = makeChunk("IDAT", compressed);
  const iendChunk = makeChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function makeChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);

  const crcInput = Buffer.concat([typeBytes, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);

  return Buffer.concat([len, typeBytes, data, crc]);
}

const CRC_TABLE = new Uint32Array(256);
{
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    CRC_TABLE[n] = c;
  }
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function clamp(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

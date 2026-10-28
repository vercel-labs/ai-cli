const SUPPORTED_TERMS = new Set(["xterm-kitty"]);

const SUPPORTED_TERM_PROGRAMS = new Set([
  "kitty",
  "ghostty",
  "wezterm",
  "warpterminal",
]);

export function supportsKittyGraphics(): boolean {
  if (process.env.AI_CLI_PREVIEW === "0") return false;
  if (process.env.AI_CLI_PREVIEW === "1") return true;

  const term = process.env.TERM ?? "";
  if (SUPPORTED_TERMS.has(term)) return true;

  const termProgram = (process.env.TERM_PROGRAM ?? "").toLowerCase();
  if (SUPPORTED_TERM_PROGRAMS.has(termProgram)) return true;

  const lcTerminal = (process.env.LC_TERMINAL ?? "").toLowerCase();
  if (lcTerminal === "iterm2") return true;

  return false;
}

import { decodeIDR } from "./h264-wasm.js";
import { extractKeyframe } from "./mp4.js";
import { encodePNG } from "./png.js";

const CHUNK_SIZE = 4096;
const SVG_PREVIEW_SIZE = 512;
const SVG_BASE_DENSITY = 72;
const SVG_FALLBACK_DENSITY = 300;

/** Decodes the first keyframe of an MP4 into a PNG, or undefined on failure. */
export async function videoFramePng(buf: Buffer): Promise<Buffer | undefined> {
  try {
    const kf = extractKeyframe(new Uint8Array(buf));
    if (!kf) return undefined;
    const frame = await decodeIDR(kf.sps, kf.pps, kf.sliceData);
    if (!frame) return undefined;
    return encodePNG(frame.yuv, frame.width, frame.height);
  } catch {
    return undefined;
  }
}

export async function displayVideoFrame(buf: Buffer): Promise<void> {
  const png = await videoFramePng(buf);
  if (png) await displayImage(png);
}

/** A Kitty image id and the cell box the preview must fit inside. */
export interface ImageBox {
  id: number;
  columns: number;
  rows: number;
}

/** Converts any sharp-readable image (including SVG) to PNG, or undefined on failure. */
export async function toPng(buf: Buffer): Promise<Buffer | undefined> {
  if (hasPngSignature(buf)) return buf;
  try {
    const { default: sharp } = await import("sharp");
    const image = sharp(buf);
    const metadata = await image.metadata();
    if (metadata.format !== "svg") return await image.png().toBuffer();
    const longestSide = Math.max(metadata.width ?? 0, metadata.height ?? 0);
    const density =
      longestSide > 0
        ? Math.max(
            SVG_BASE_DENSITY,
            Math.ceil((SVG_BASE_DENSITY * SVG_PREVIEW_SIZE) / longestSide)
          )
        : SVG_FALLBACK_DENSITY;
    return await sharp(buf, { density })
      .resize({
        width: SVG_PREVIEW_SIZE,
        height: SVG_PREVIEW_SIZE,
        fit: "inside",
      })
      .flatten({ background: "#ffffff" })
      .png()
      .toBuffer();
  } catch {
    return undefined;
  }
}

function chunked(png: Buffer, params: string): string {
  const encoded = png.toString("base64");
  let out = "";
  for (let i = 0; i < encoded.length; i += CHUNK_SIZE) {
    const chunk = encoded.slice(i, i + CHUNK_SIZE);
    const isLast = i + CHUNK_SIZE >= encoded.length;
    const control =
      i === 0 ? `${params},m=${isLast ? 0 : 1}` : `m=${isLast ? 0 : 1}`;
    out += `\x1b_G${control};${chunk}\x1b\\`;
  }
  return out;
}

/** Returns the Kitty escape sequence that shows a PNG fitted inside a cell box. */
export function kittyPlace(
  png: Buffer,
  box: { columns: number; rows: number; id?: number; keepCursor?: boolean }
): string {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const fit =
    box.rows * 2 * width <= box.columns * height
      ? `r=${box.rows}`
      : `c=${box.columns}`;
  const id = box.id === undefined ? "" : `,i=${box.id}`;
  const keep = box.keepCursor ? ",C=1" : "";
  return chunked(png, `a=T,f=100${id},q=2${keep},${fit}`);
}

export async function displayImage(buf: Buffer, box?: ImageBox): Promise<void> {
  const preview = await toPng(buf);
  if (!preview) return;
  process.stderr.write(
    box ? kittyPlace(preview, box) : chunked(preview, "a=T,f=100")
  );
  process.stderr.write("\n");
}

/** Removes a Kitty image placed with an id and frees its data. */
export function deleteImage(id: number): void {
  process.stderr.write(`\x1b_Ga=d,d=I,i=${id},q=2\x1b\\`);
}

function hasPngSignature(buf: Buffer): boolean {
  return (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  );
}

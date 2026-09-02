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

export async function displayVideoFrame(buf: Buffer): Promise<void> {
  try {
    const kf = extractKeyframe(new Uint8Array(buf));
    if (!kf) return;
    const frame = await decodeIDR(kf.sps, kf.pps, kf.sliceData);
    if (!frame) return;
    const png = encodePNG(frame.yuv, frame.width, frame.height);
    await displayImage(png);
  } catch {
    // Preview is best-effort; skip silently on any failure
  }
}

export async function displayImage(buf: Buffer): Promise<void> {
  let preview = buf;
  const isPng = hasPngSignature(buf);
  if (!isPng) {
    try {
      const { default: sharp } = await import("sharp");
      preview = await sharp(buf).png().toBuffer();
    } catch {
      // Preview is best-effort; skip unsupported or invalid image formats.
      return;
    }
  }

  const encoded = preview.toString("base64");
  for (let i = 0; i < encoded.length; i += CHUNK_SIZE) {
    const chunk = encoded.slice(i, i + CHUNK_SIZE);
    const isLast = i + CHUNK_SIZE >= encoded.length;
    const control =
      i === 0 ? `a=T,f=100,m=${isLast ? 0 : 1}` : `m=${isLast ? 0 : 1}`;
    process.stderr.write(`\x1b_G${control};${chunk}\x1b\\`);
  }
  process.stderr.write("\n");
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

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
    displayImage(png);
  } catch {
    // Preview is best-effort; skip silently on any failure
  }
}

export function displayImage(buf: Buffer): void {
  const encoded = buf.toString("base64");
  for (let i = 0; i < encoded.length; i += CHUNK_SIZE) {
    const chunk = encoded.slice(i, i + CHUNK_SIZE);
    const isLast = i + CHUNK_SIZE >= encoded.length;
    const control =
      i === 0 ? `a=T,f=100,m=${isLast ? 0 : 1}` : `m=${isLast ? 0 : 1}`;
    process.stderr.write(`\x1b_G${control};${chunk}\x1b\\`);
  }
  process.stderr.write("\n");
}

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export type ImageReference = string | Uint8Array;

export function collectImageReference(
  value: string,
  previous: string[] = []
): string[] {
  return [...previous, value];
}

export async function loadImageReferences(
  references: string[]
): Promise<ImageReference[]> {
  return Promise.all(references.map(loadImageReference));
}

export function isLikelyImage(data: Uint8Array): boolean {
  if (hasPrefix(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return true;
  }

  if (hasPrefix(data, [0xff, 0xd8, 0xff])) return true;
  if (startsWithAscii(data, "GIF87a") || startsWithAscii(data, "GIF89a")) {
    return true;
  }

  if (
    startsWithAscii(data, "RIFF") &&
    data.length >= 12 &&
    asciiAt(data, 8, 4) === "WEBP"
  ) {
    return true;
  }

  if (startsWithAscii(data, "BM")) return true;
  if (hasPrefix(data, [0x49, 0x49, 0x2a, 0x00])) return true;
  if (hasPrefix(data, [0x4d, 0x4d, 0x00, 0x2a])) return true;
  if (hasIsoImageBrand(data)) return true;
  if (looksLikeSvg(data)) return true;

  return false;
}

async function loadImageReference(reference: string): Promise<ImageReference> {
  const trimmed = reference.trim();
  if (!trimmed) {
    throw new Error("--image cannot be empty");
  }

  const url = parseReferenceUrl(trimmed);
  if (url) {
    if (url.protocol === "http:" || url.protocol === "https:")
      return url.toString();
    if (url.protocol === "data:") return url.toString();
    if (url.protocol === "file:") return readReferenceFile(fileURLToPath(url));

    throw new Error(
      `unsupported reference image URL scheme "${url.protocol}"; use a file path, file:// URL, http(s) URL, or data URL`
    );
  }

  return readReferenceFile(trimmed);
}

async function readReferenceFile(path: string): Promise<Uint8Array> {
  try {
    return new Uint8Array(await readFile(path));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`could not read reference image "${path}": ${message}`);
  }
}

function parseReferenceUrl(input: string): URL | null {
  if (/^[a-zA-Z]:[\\/]/.test(input)) return null;
  const lowerInput = input.toLowerCase();
  if (
    !lowerInput.startsWith("data:") &&
    !/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(input)
  ) {
    return null;
  }

  try {
    return new URL(input);
  } catch {
    return null;
  }
}

function hasPrefix(data: Uint8Array, prefix: number[]): boolean {
  return prefix.every((byte, index) => data[index] === byte);
}

function startsWithAscii(data: Uint8Array, value: string): boolean {
  return asciiAt(data, 0, value.length) === value;
}

function asciiAt(data: Uint8Array, offset: number, length: number): string {
  if (data.length < offset + length) return "";
  return String.fromCharCode(...data.slice(offset, offset + length));
}

function hasIsoImageBrand(data: Uint8Array): boolean {
  if (data.length < 12 || asciiAt(data, 4, 4) !== "ftyp") return false;

  const brands = new Set([
    "avif",
    "avis",
    "heic",
    "heix",
    "hevc",
    "hevx",
    "mif1",
    "msf1",
  ]);

  for (let offset = 8; offset + 4 <= Math.min(data.length, 64); offset += 4) {
    if (brands.has(asciiAt(data, offset, 4))) return true;
  }

  return false;
}

function looksLikeSvg(data: Uint8Array): boolean {
  const prefix = new TextDecoder()
    .decode(data.slice(0, Math.min(data.length, 512)))
    .trimStart()
    .toLowerCase();

  return (
    prefix.startsWith("<svg") ||
    (prefix.startsWith("<?xml") && prefix.includes("<svg"))
  );
}

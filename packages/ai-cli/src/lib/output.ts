import { randomBytes } from "crypto";
import { writeFileSync, mkdirSync, statSync } from "fs";
import { resolve, join, dirname } from "path";

import {
  supportsKittyGraphics,
  displayImage,
  displayVideoFrame,
} from "./kitty.js";

export type OutputFormat = "md" | "txt" | "image" | "video" | "audio";

const DEFAULT_EXTENSIONS: Record<OutputFormat, string> = {
  md: ".md",
  txt: ".txt",
  image: ".png",
  video: ".mp4",
  audio: ".mp3",
};

export interface WriteOutputOptions {
  data: Buffer | string;
  format: OutputFormat;
  outputPath?: string;
  outputId?: string;
  suffix?: string;
  extension?: string;
  mediaType?: string;
  forceFile?: boolean;
  quiet?: boolean;
  display?: boolean;
}

function defaultFilename(
  format: OutputFormat,
  outputId?: string,
  extension?: string,
  mediaType?: string
): string {
  return `${filenameStem(outputId)}${
    extension ?? defaultExtension(format, mediaType)
  }`;
}

function defaultExtension(format: OutputFormat, mediaType?: string): string {
  if (!mediaType) return DEFAULT_EXTENSIONS[format];

  const extension = MEDIA_EXTENSIONS[mediaType.toLowerCase().split(";", 1)[0]!];
  return extension ?? DEFAULT_EXTENSIONS[format];
}

const MEDIA_EXTENSIONS: Record<string, string> = {
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
  "video/ogg": ".ogv",
  "image/avif": ".avif",
  "image/bmp": ".bmp",
  "image/gif": ".gif",
  "image/heic": ".heic",
  "image/jpg": ".jpg",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/svg+xml": ".svg",
  "image/tiff": ".tiff",
  "image/webp": ".webp",
};

function filenameStem(outputId?: string): string {
  return sanitizeFilenameStem(outputId) ?? randomBytes(4).toString("hex");
}

function sanitizeFilenameStem(outputId?: string): string | undefined {
  const trimmed = outputId?.trim();
  if (!trimmed) return undefined;

  const sanitized = trimmed.replace(/[^A-Za-z0-9._-]+/g, "-");
  if (!sanitized || sanitized === "." || sanitized === "..") return undefined;

  return sanitized;
}

function isDirectory(p: string): boolean {
  if (p.endsWith("/") || p.endsWith("\\")) return true;
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function outputDirError(dir: string): Error {
  return new Error(
    `AI_CLI_OUTPUT_DIR must be a directory, but "${dir}" is not a directory. ` +
      "Remove the file or point AI_CLI_OUTPUT_DIR at a directory."
  );
}

function ensureOutputDirectory(dir: string): void {
  let stats;
  try {
    stats = statSync(dir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return;
    if (code === "ENOTDIR") throw outputDirError(dir);
    throw error;
  }

  if (!stats.isDirectory()) throw outputDirError(dir);
}

/**
 * Throws when AI_CLI_OUTPUT_DIR is set to a path that is not a directory.
 * Callers run this before starting work so a bad value fails before any
 * generation request. An explicit output path takes priority over the
 * environment variable, so it skips the check.
 */
export function assertOutputDirectory(outputPath?: string): void {
  if (outputPath !== undefined) return;
  const dir = process.env.AI_CLI_OUTPUT_DIR;
  if (dir) ensureOutputDirectory(dir);
}

export async function writeOutput(
  opts: WriteOutputOptions
): Promise<string | null> {
  const {
    data,
    format,
    outputId,
    suffix,
    extension,
    mediaType,
    forceFile,
    quiet,
    display,
  } = opts;
  const outputPath = opts.outputPath;
  // `--output` always wins, even when it is an empty string.
  const envOutputDir =
    outputPath === undefined ? process.env.AI_CLI_OUTPUT_DIR : undefined;
  const filename = addSuffix(
    defaultFilename(format, outputId, extension, mediaType),
    suffix
  );
  const buf =
    typeof data === "string"
      ? new TextEncoder().encode(data)
      : new Uint8Array(data);
  const shouldDisplay =
    display !== false &&
    (format === "image" || format === "video") &&
    process.stdout.isTTY &&
    supportsKittyGraphics();

  if (outputPath || envOutputDir) {
    let filePath: string;
    if (outputPath) {
      // An existing directory (or a trailing slash) collects auto-named files;
      // any other value is an explicit filename.
      filePath = isDirectory(outputPath)
        ? join(outputPath, filename)
        : addSuffix(outputPath, suffix);
    } else {
      // AI_CLI_OUTPUT_DIR is always a directory, even before it exists.
      const dir = envOutputDir!;
      ensureOutputDirectory(dir);
      filePath = join(dir, filename);
    }
    filePath = resolve(filePath);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, buf);
    if (!quiet) process.stderr.write(`Saved to ${filePath}\n`);
    if (shouldDisplay) await showPreview(format, buf);
    return filePath;
  }

  if (!process.stdout.isTTY && !forceFile) {
    process.stdout.write(buf);
    return null;
  }

  const path = resolve(filename);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buf);
  if (!quiet) process.stderr.write(`Saved to ${path}\n`);
  if (shouldDisplay) await showPreview(format, buf);
  return path;
}

async function showPreview(
  format: OutputFormat,
  buf: Uint8Array
): Promise<void> {
  const preview = Buffer.from(buf);
  if (format === "video") {
    await displayVideoFrame(preview);
  } else {
    await displayImage(preview);
  }
}

function addSuffix(filename: string, suffix?: string): string {
  if (!suffix) return filename;
  const dot = filename.lastIndexOf(".");
  if (dot === -1) return `${filename}-${suffix}`;
  return `${filename.slice(0, dot)}-${suffix}${filename.slice(dot)}`;
}

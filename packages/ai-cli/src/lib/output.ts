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
  quiet?: boolean;
  display?: boolean;
}

function defaultFilename(
  format: OutputFormat,
  outputId?: string,
  extension?: string
): string {
  return `${filenameStem(outputId)}${extension ?? DEFAULT_EXTENSIONS[format]}`;
}

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
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export async function writeOutput(
  opts: WriteOutputOptions
): Promise<string | null> {
  const { data, format, outputId, suffix, extension, quiet, display } = opts;
  const effectiveOutput = opts.outputPath ?? process.env.AI_CLI_OUTPUT_DIR;
  const buf = typeof data === "string" ? Buffer.from(data, "utf-8") : data;
  const shouldDisplay =
    display !== false &&
    (format === "image" || format === "video") &&
    process.stdout.isTTY &&
    supportsKittyGraphics();

  if (effectiveOutput) {
    let filePath: string;
    if (isDirectory(effectiveOutput)) {
      filePath = join(
        effectiveOutput,
        addSuffix(defaultFilename(format, outputId, extension), suffix)
      );
    } else {
      filePath = addSuffix(effectiveOutput, suffix);
    }
    filePath = resolve(filePath);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, buf);
    if (!quiet) process.stderr.write(`Saved to ${filePath}\n`);
    if (shouldDisplay) await showPreview(format, buf);
    return filePath;
  }

  if (!process.stdout.isTTY) {
    process.stdout.write(buf);
    return null;
  }

  const filename = addSuffix(
    defaultFilename(format, outputId, extension),
    suffix
  );
  const path = resolve(filename);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buf);
  if (!quiet) process.stderr.write(`Saved to ${path}\n`);
  if (shouldDisplay) await showPreview(format, buf);
  return path;
}

async function showPreview(format: OutputFormat, buf: Buffer): Promise<void> {
  if (format === "video") {
    await displayVideoFrame(buf);
  } else {
    displayImage(buf);
  }
}

function addSuffix(filename: string, suffix?: string): string {
  if (!suffix) return filename;
  const dot = filename.lastIndexOf(".");
  if (dot === -1) return `${filename}-${suffix}`;
  return `${filename.slice(0, dot)}-${suffix}${filename.slice(dot)}`;
}

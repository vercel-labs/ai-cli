import { writeFileSync, mkdirSync, statSync } from "fs";
import { resolve, join, dirname } from "path";

import {
  supportsKittyGraphics,
  displayImage,
  displayVideoFrame,
} from "./kitty.js";

export type OutputFormat = "md" | "txt" | "image" | "video";

const DEFAULT_EXTENSIONS: Record<OutputFormat, string> = {
  md: ".md",
  txt: ".txt",
  image: ".png",
  video: ".mp4",
};

export interface WriteOutputOptions {
  data: Buffer | string;
  format: OutputFormat;
  outputPath?: string;
  suffix?: string;
  quiet?: boolean;
  display?: boolean;
}

function defaultFilename(format: OutputFormat): string {
  return `output${DEFAULT_EXTENSIONS[format]}`;
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
  const { data, format, suffix, quiet, display } = opts;
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
        addSuffix(defaultFilename(format), suffix)
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

  const filename = addSuffix(defaultFilename(format), suffix);
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

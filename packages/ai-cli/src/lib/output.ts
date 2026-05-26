import { randomBytes } from "crypto";
import { writeFileSync, mkdirSync, statSync } from "fs";
import { homedir } from "os";
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

const DEFAULT_GENERATIONS_DIR = join(homedir(), ".ai-cli", "generations");
const SLUG_MAX_LENGTH = 40;

export interface WriteOutputOptions {
  data: Buffer | string;
  format: OutputFormat;
  outputPath?: string;
  prompt?: string;
  index?: number;
  quiet?: boolean;
  display?: boolean;
}

export function slugify(input: string, maxLength = SLUG_MAX_LENGTH): string {
  let slug = input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (slug.length <= maxLength) return slug;

  const truncated = slug.slice(0, maxLength);
  const lastDash = truncated.lastIndexOf("-");
  if (lastDash > 0) return truncated.slice(0, lastDash);
  return truncated;
}

export function generateFilename(
  format: OutputFormat,
  prompt?: string,
  index?: number
): string {
  const hex = randomBytes(2).toString("hex");
  const slug = (prompt && slugify(prompt)) || "output";
  const suffix = index != null ? `-${index}` : "";
  return `${slug}-${hex}${suffix}${DEFAULT_EXTENSIONS[format]}`;
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function writeToDir(
  dir: string,
  buf: Buffer,
  format: OutputFormat,
  prompt?: string,
  index?: number,
  maxAttempts = 5
): string {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const name = generateFilename(format, prompt, index);
    const filePath = resolve(dir, name);
    try {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, buf, { flag: "wx" });
      return filePath;
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        "code" in err &&
        (err as NodeJS.ErrnoException).code === "EEXIST"
      )
        continue;
      throw err;
    }
  }
  throw new Error("Failed to generate a unique filename after 5 attempts");
}

export async function writeOutput(
  opts: WriteOutputOptions
): Promise<string | null> {
  const { data, format, prompt, index, quiet, display } = opts;
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
      filePath = writeToDir(effectiveOutput, buf, format, prompt, index);
    } else if (index != null) {
      const dot = effectiveOutput.lastIndexOf(".");
      if (dot === -1) {
        filePath = resolve(`${effectiveOutput}-${index}`);
      } else {
        filePath = resolve(
          `${effectiveOutput.slice(0, dot)}-${index}${effectiveOutput.slice(dot)}`
        );
      }
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, buf);
    } else {
      filePath = resolve(effectiveOutput);
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, buf);
    }
    if (!quiet) process.stderr.write(`Saved to ${filePath}\n`);
    if (shouldDisplay) await showPreview(format, buf);
    return filePath;
  }

  if (!process.stdout.isTTY) {
    process.stdout.write(buf);
    return null;
  }

  const filePath = writeToDir(DEFAULT_GENERATIONS_DIR, buf, format, prompt, index);
  if (!quiet) process.stderr.write(`Saved to ${filePath}\n`);
  if (shouldDisplay) await showPreview(format, buf);
  return filePath;
}

async function showPreview(format: OutputFormat, buf: Buffer): Promise<void> {
  if (format === "video") {
    await displayVideoFrame(buf);
  } else {
    displayImage(buf);
  }
}

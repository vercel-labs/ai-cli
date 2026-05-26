import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { basename, join } from "path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { slugify, generateFilename, writeOutput } from "./output.js";

describe("slugify", () => {
  test("lowercases and replaces non-alphanumeric with hyphens", () => {
    expect(slugify("A Sunset Over Mountains")).toBe(
      "a-sunset-over-mountains"
    );
  });

  test("collapses consecutive hyphens", () => {
    expect(slugify("hello   world!!!  test")).toBe("hello-world-test");
  });

  test("trims leading and trailing hyphens", () => {
    expect(slugify("---hello---")).toBe("hello");
    expect(slugify("!!!start end???")).toBe("start-end");
  });

  test("truncates at word boundary", () => {
    const long = "this is a very long prompt that exceeds the maximum length allowed";
    const result = slugify(long, 30);
    expect(result.length).toBeLessThanOrEqual(30);
    expect(result).toBe("this-is-a-very-long-prompt");
    expect(result).not.toEndWith("-");
  });

  test("truncates without word boundary if single long word", () => {
    const long = "abcdefghijklmnopqrstuvwxyz1234567890abcdefghijklmnop";
    const result = slugify(long, 40);
    expect(result.length).toBe(40);
    expect(result).toBe("abcdefghijklmnopqrstuvwxyz1234567890abcd");
  });

  test("returns empty string for empty input", () => {
    expect(slugify("")).toBe("");
  });

  test("returns empty string for all-whitespace input", () => {
    expect(slugify("   ")).toBe("");
  });

  test("returns empty string for all-special-chars input", () => {
    expect(slugify("!@#$%^&*()")).toBe("");
  });

  test("handles unicode by normalizing accented characters", () => {
    expect(slugify("café résumé")).toBe("cafe-resume");
  });

  test("preserves digits", () => {
    expect(slugify("photo 1024x768")).toBe("photo-1024x768");
  });

  test("respects default max length of 40", () => {
    const long = "a ".repeat(50).trim();
    const result = slugify(long);
    expect(result.length).toBeLessThanOrEqual(40);
  });
});

describe("generateFilename", () => {
  test("produces slug-hex.ext format with prompt", () => {
    const name = generateFilename("image", "a sunset");
    expect(name).toMatch(/^a-sunset-[0-9a-f]{4}\.png$/);
  });

  test("uses 'output' as slug when no prompt", () => {
    const name = generateFilename("image");
    expect(name).toMatch(/^output-[0-9a-f]{4}\.png$/);
  });

  test("uses correct extension for each format", () => {
    expect(generateFilename("md", "test")).toMatch(/\.md$/);
    expect(generateFilename("txt", "test")).toMatch(/\.txt$/);
    expect(generateFilename("image", "test")).toMatch(/\.png$/);
    expect(generateFilename("video", "test")).toMatch(/\.mp4$/);
  });

  test("produces unique names on repeated calls", () => {
    const names = new Set(
      Array.from({ length: 20 }, () => generateFilename("image", "same prompt"))
    );
    expect(names.size).toBeGreaterThan(1);
  });

  test("handles empty prompt like undefined", () => {
    const name = generateFilename("image", "");
    expect(name).toMatch(/^output-[0-9a-f]{4}\.png$/);
  });

  test("falls back to 'output' when prompt slugifies to empty", () => {
    const name = generateFilename("image", "!!!");
    expect(name).toMatch(/^output-[0-9a-f]{4}\.png$/);
  });

  test("appends index when provided", () => {
    const name = generateFilename("image", "a sunset", 3);
    expect(name).toMatch(/^a-sunset-[0-9a-f]{4}-3\.png$/);
  });

  test("omits index when not provided", () => {
    const name = generateFilename("image", "a sunset");
    expect(name).toMatch(/^a-sunset-[0-9a-f]{4}\.png$/);
  });
});

describe("writeOutput", () => {
  let tmpDir: string;
  let savedTTY: boolean | undefined;
  let savedOutputDir: string | undefined;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `ai-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    savedTTY = process.stdout.isTTY;
    savedOutputDir = process.env.AI_CLI_OUTPUT_DIR;
    delete process.env.AI_CLI_OUTPUT_DIR;
    Object.defineProperty(process.stdout, "isTTY", { value: true, writable: true, configurable: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    Object.defineProperty(process.stdout, "isTTY", { value: savedTTY, writable: true, configurable: true });
    if (savedOutputDir !== undefined) {
      process.env.AI_CLI_OUTPUT_DIR = savedOutputDir;
    } else {
      delete process.env.AI_CLI_OUTPUT_DIR;
    }
  });

  test("writes to explicit output directory with prompt-derived name", async () => {
    const data = Buffer.from("image-data");
    const result = await writeOutput({
      data,
      format: "image",
      outputPath: tmpDir,
      prompt: "a sunset",
      quiet: true,
      display: false,
    });

    expect(result).not.toBeNull();
    expect(result!.startsWith(tmpDir)).toBe(true);
    expect(basename(result!)).toMatch(/^a-sunset-[0-9a-f]{4}\.png$/);
    expect(readFileSync(result!).toString()).toBe("image-data");
  });

  test("writes to explicit file path", async () => {
    const filePath = join(tmpDir, "my-file.png");
    const data = Buffer.from("image-data");
    const result = await writeOutput({
      data,
      format: "image",
      outputPath: filePath,
      quiet: true,
      display: false,
    });

    expect(result).toBe(filePath);
    expect(readFileSync(filePath).toString()).toBe("image-data");
  });

  test("inserts index into explicit file path with extension", async () => {
    const filePath = join(tmpDir, "foo.png");
    const data = Buffer.from("data");
    const result = await writeOutput({
      data,
      format: "image",
      outputPath: filePath,
      index: 2,
      quiet: true,
      display: false,
    });

    expect(result).not.toBeNull();
    expect(basename(result!)).toBe("foo-2.png");
    expect(existsSync(result!)).toBe(true);
  });

  test("inserts index into extensionless path", async () => {
    const filePath = join(tmpDir, "foo");
    const data = Buffer.from("data");
    const result = await writeOutput({
      data,
      format: "image",
      outputPath: filePath,
      index: 3,
      quiet: true,
      display: false,
    });

    expect(result).not.toBeNull();
    expect(basename(result!)).toBe("foo-3");
    expect(existsSync(result!)).toBe(true);
  });

  test("retries on filename collision via wx flag", async () => {
    const allNames = Array.from({ length: 200 }, () =>
      generateFilename("image", "collision")
    );
    const uniqueNames = new Set(allNames);
    for (const name of uniqueNames) {
      writeFileSync(join(tmpDir, name), "taken");
    }

    const data = Buffer.from("new-data");
    const result = await writeOutput({
      data,
      format: "image",
      outputPath: tmpDir,
      prompt: "collision",
      quiet: true,
      display: false,
    });

    expect(result).not.toBeNull();
    expect(result!.startsWith(tmpDir)).toBe(true);
    expect(readFileSync(result!).toString()).toBe("new-data");
  });

  test("pipes to stdout when not a TTY", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, writable: true, configurable: true });

    const chunks: Buffer[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: Uint8Array | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return true;
    }) as typeof process.stdout.write;

    try {
      const data = Buffer.from("piped-content");
      const result = await writeOutput({
        data,
        format: "md",
        quiet: true,
        display: false,
      });

      expect(result).toBeNull();
      expect(Buffer.concat(chunks).toString()).toBe("piped-content");
    } finally {
      process.stdout.write = origWrite;
    }
  });

  test("accepts string data and writes as utf-8", async () => {
    const filePath = join(tmpDir, "text-output.md");
    const result = await writeOutput({
      data: "hello world",
      format: "md",
      outputPath: filePath,
      quiet: true,
      display: false,
    });

    expect(result).toBe(filePath);
    expect(readFileSync(filePath, "utf-8")).toBe("hello world");
  });
});

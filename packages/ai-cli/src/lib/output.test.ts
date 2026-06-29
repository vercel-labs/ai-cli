import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { basename, join } from "path";

import { writeOutput } from "./output.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "ai-cli-output-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("writeOutput", () => {
  test("uses output id when writing to a directory", async () => {
    await withTempDir(async (dir) => {
      const path = await writeOutput({
        data: "hello",
        format: "md",
        outputPath: dir,
        outputId: "resp_123",
        quiet: true,
      });

      expect(path).not.toBeNull();
      expect(basename(path!)).toBe("resp_123.md");
      expect(readFileSync(path!, "utf8")).toBe("hello");
    });
  });

  test("sanitizes output ids before using them as filenames", async () => {
    await withTempDir(async (dir) => {
      const path = await writeOutput({
        data: Buffer.from([1, 2, 3]),
        format: "image",
        outputPath: dir,
        outputId: "gateway/resp 123",
        quiet: true,
        display: false,
      });

      expect(path).not.toBeNull();
      expect(basename(path!)).toBe("gateway-resp-123.png");
      expect(existsSync(path!)).toBe(true);
    });
  });

  test("uses random 8-character names without an output id", async () => {
    await withTempDir(async (dir) => {
      const path = await writeOutput({
        data: "hello",
        format: "txt",
        outputPath: dir,
        quiet: true,
      });

      expect(path).not.toBeNull();
      expect(basename(path!)).toMatch(/^[0-9a-f]{8}\.txt$/);
    });
  });

  test("keeps explicit output filenames", async () => {
    await withTempDir(async (dir) => {
      const explicitPath = join(dir, "custom.md");
      const path = await writeOutput({
        data: "hello",
        format: "md",
        outputPath: explicitPath,
        outputId: "resp_123",
        quiet: true,
      });

      expect(path).toBe(explicitPath);
      expect(readFileSync(path!, "utf8")).toBe("hello");
    });
  });

  test("supports custom audio extensions when writing to a directory", async () => {
    await withTempDir(async (dir) => {
      const path = await writeOutput({
        data: Buffer.from([1, 2, 3]),
        format: "audio",
        extension: ".wav",
        outputPath: dir,
        outputId: "speech_123",
        quiet: true,
      });

      expect(path).not.toBeNull();
      expect(basename(path!)).toBe("speech_123.wav");
      expect(readFileSync(path!)).toEqual(Buffer.from([1, 2, 3]));
    });
  });
});

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { basename, join } from "path";

import { describe, expect, test } from "vitest";

import { writeOutput } from "./output.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "ai-cli-output-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function withOutputDirEnv<T>(
  value: string | undefined,
  fn: () => Promise<T>
): Promise<T> {
  const previous = process.env.AI_CLI_OUTPUT_DIR;
  if (value === undefined) {
    delete process.env.AI_CLI_OUTPUT_DIR;
  } else {
    process.env.AI_CLI_OUTPUT_DIR = value;
  }
  try {
    return await fn();
  } finally {
    if (previous === undefined) {
      delete process.env.AI_CLI_OUTPUT_DIR;
    } else {
      process.env.AI_CLI_OUTPUT_DIR = previous;
    }
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

  test("uses the generated image media type for directory filenames", async () => {
    await withTempDir(async (dir) => {
      const path = await writeOutput({
        data: Buffer.from([1, 2, 3]),
        format: "image",
        outputPath: dir,
        outputId: "resp_123",
        mediaType: "image/jpeg",
        quiet: true,
        display: false,
      });

      expect(path).not.toBeNull();
      expect(basename(path!)).toBe("resp_123.jpg");
    });
  });

  test("uses an svg extension for generated SVG images", async () => {
    await withTempDir(async (dir) => {
      const path = await writeOutput({
        data: '<svg xmlns="http://www.w3.org/2000/svg" />',
        format: "image",
        outputPath: dir,
        outputId: "resp_123",
        mediaType: "image/svg+xml",
        quiet: true,
        display: false,
      });

      expect(path).not.toBeNull();
      expect(basename(path!)).toBe("resp_123.svg");
    });
  });

  test("prefers an explicit image extension over the media type", async () => {
    await withTempDir(async (dir) => {
      const path = await writeOutput({
        data: Buffer.from([1, 2, 3]),
        format: "image",
        extension: ".png",
        outputPath: dir,
        outputId: "resp_123",
        mediaType: "image/jpeg",
        quiet: true,
        display: false,
      });

      expect(path).not.toBeNull();
      expect(basename(path!)).toBe("resp_123.png");
    });
  });

  test("creates a nonexistent AI_CLI_OUTPUT_DIR and writes separate files", async () => {
    await withTempDir(async (dir) => {
      const outputDir = join(dir, "output");

      await withOutputDirEnv(outputDir, async () => {
        const first = await writeOutput({
          data: "first",
          format: "md",
          outputId: "resp_1",
          quiet: true,
        });
        const second = await writeOutput({
          data: "second",
          format: "md",
          outputId: "resp_2",
          quiet: true,
        });

        expect(first).toBe(join(outputDir, "resp_1.md"));
        expect(second).toBe(join(outputDir, "resp_2.md"));
        expect(readdirSync(outputDir).sort()).toEqual([
          "resp_1.md",
          "resp_2.md",
        ]);
        expect(readFileSync(first!, "utf8")).toBe("first");
        expect(readFileSync(second!, "utf8")).toBe("second");
      });
    });
  });

  test("creates nested AI_CLI_OUTPUT_DIR paths", async () => {
    await withTempDir(async (dir) => {
      const outputDir = join(dir, "nested", "deeper", "output");

      await withOutputDirEnv(`${outputDir}/`, async () => {
        const path = await writeOutput({
          data: Buffer.from([1, 2, 3]),
          format: "image",
          outputId: "resp_123",
          quiet: true,
          display: false,
        });

        expect(path).toBe(join(outputDir, "resp_123.png"));
        expect(readFileSync(path!)).toEqual(Buffer.from([1, 2, 3]));
      });
    });
  });

  test("fails without writing when AI_CLI_OUTPUT_DIR is an existing file", async () => {
    await withTempDir(async (dir) => {
      const envFile = join(dir, "not-a-dir.md");
      writeFileSync(envFile, "keep me");

      await withOutputDirEnv(envFile, async () => {
        const error = await writeOutput({
          data: "hello",
          format: "md",
          outputId: "resp_123",
          quiet: true,
        }).then(
          () => undefined,
          (reason: Error) => reason
        );

        expect(error).toBeInstanceOf(Error);
        expect(error!.message).toContain("AI_CLI_OUTPUT_DIR");
        expect(error!.message).toContain(envFile);
      });

      expect(readFileSync(envFile, "utf8")).toBe("keep me");
      expect(readdirSync(dir)).toEqual(["not-a-dir.md"]);
    });
  });

  test("keeps --output behavior when AI_CLI_OUTPUT_DIR is set", async () => {
    await withTempDir(async (dir) => {
      const envDir = join(dir, "env-output");
      const explicitPath = join(dir, "custom.md");

      await withOutputDirEnv(envDir, async () => {
        const path = await writeOutput({
          data: "hello",
          format: "md",
          outputPath: explicitPath,
          outputId: "resp_123",
          quiet: true,
        });

        expect(path).toBe(explicitPath);
        expect(existsSync(envDir)).toBe(false);
      });

      expect(readFileSync(explicitPath, "utf8")).toBe("hello");
    });
  });

  test("writes into an existing AI_CLI_OUTPUT_DIR directory", async () => {
    await withTempDir(async (dir) => {
      const envDir = join(dir, "env-output");
      mkdirSync(envDir);

      await withOutputDirEnv(envDir, async () => {
        await writeOutput({
          data: "first",
          format: "md",
          outputId: "resp_1",
          quiet: true,
        });
        const second = await writeOutput({
          data: "second",
          format: "md",
          outputId: "resp_2",
          quiet: true,
        });

        expect(second).toBe(join(envDir, "resp_2.md"));
        expect(readFileSync(join(envDir, "resp_1.md"), "utf8")).toBe("first");
        expect(readFileSync(second!, "utf8")).toBe("second");
      });
    });
  });
});

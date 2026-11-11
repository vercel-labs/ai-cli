import { existsSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { describe, expect, test } from "vitest";

import { runMediaJobs } from "./media-jobs.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "ai-cli-media-jobs-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function withOutputDirEnv<T>(
  value: string,
  fn: () => Promise<T>
): Promise<T> {
  const previous = process.env.AI_CLI_OUTPUT_DIR;
  process.env.AI_CLI_OUTPUT_DIR = value;
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

describe("runMediaJobs", () => {
  test("fails before generating when AI_CLI_OUTPUT_DIR is a file", async () => {
    await withTempDir(async (dir) => {
      const envFile = join(dir, "not-a-dir.md");
      writeFileSync(envFile, "keep me");
      let generated = 0;

      await withOutputDirEnv(envFile, async () => {
        await expect(
          runMediaJobs(
            ["openai/gpt-image-2"],
            async () => {
              generated++;
              return { artifacts: [] };
            },
            { n: 1, concurrency: 1, format: "image", quiet: true }
          )
        ).rejects.toThrow("AI_CLI_OUTPUT_DIR must be a directory");
      });

      expect(generated).toBe(0);
    });
  });

  test("writes to an explicit output path when AI_CLI_OUTPUT_DIR is a file", async () => {
    await withTempDir(async (dir) => {
      const envFile = join(dir, "not-a-dir.md");
      writeFileSync(envFile, "keep me");
      const outputPath = join(dir, "image.png");
      let generated = 0;

      await withOutputDirEnv(envFile, async () => {
        await runMediaJobs(
          ["openai/gpt-image-2"],
          async () => {
            generated++;
            return {
              artifacts: [
                { data: Buffer.from([1, 2, 3]), mediaType: "image/png" },
              ],
            };
          },
          {
            n: 1,
            concurrency: 1,
            format: "image",
            output: outputPath,
            quiet: true,
          }
        );
      });

      expect(generated).toBe(1);
      expect(existsSync(outputPath)).toBe(true);
    });
  });
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test, vi } from "vitest";

import { runMediaJobs } from "./media-jobs.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = undefined;
});

test("JSON media jobs suppress progress on stderr", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ai-cli-media-"));
  const stderr = vi
    .spyOn(process.stderr, "write")
    .mockImplementation(() => true);
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  try {
    await runMediaJobs(
      ["model"],
      async () => ({ artifacts: [{ data: "data", mediaType: "image/png" }] }),
      {
        n: 1,
        concurrency: 1,
        format: "image",
        output: dir,
        json: true,
      }
    );
    expect(stderr).not.toHaveBeenCalled();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("quiet media failures are redacted and printed on one line", async () => {
  vi.stubEnv("AI_GATEWAY_API_KEY", "secret12345");
  const stderr = vi
    .spyOn(process.stderr, "write")
    .mockImplementation(() => true);
  await runMediaJobs(
    ["model"],
    async () => {
      throw new Error("secret12345\nBearer other-token");
    },
    { n: 1, concurrency: 1, format: "image", quiet: true }
  );
  expect(stderr).toHaveBeenCalledOnce();
  expect(stderr).toHaveBeenCalledWith("Error (model): [redacted] [redacted]\n");
  expect(process.exitCode).toBe(1);
});

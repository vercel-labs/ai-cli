import { describe, expect, test } from "vitest";

import { Command } from "./command.js";
import { addTimeoutOption, timeoutMs } from "./timeout.js";

async function parseTimeout(args: string[]): Promise<number | undefined> {
  let timeout: number | undefined;
  const program = new Command().name("ai");
  addTimeoutOption(
    program.command("image").action((_argument, options) => {
      timeout = (options as { timeout: number }).timeout;
    }),
    300_000
  );

  await program.parseAsync(["node", "ai", "image", ...args]);
  return timeout;
}

describe("timeout option", () => {
  test("parses seconds", async () => {
    expect(await parseTimeout(["--timeout", "600"])).toBe(600);
  });

  test("applies the command default when absent", async () => {
    expect(await parseTimeout([])).toBe(300);
  });

  test.each(["abc", "0", "-1"])("rejects invalid value %s", async (value) => {
    await expect(parseTimeout(["--timeout", value])).rejects.toThrow(
      `--timeout must be a positive integer, got "${value}"`
    );
  });

  test("accepts the largest delay a 32-bit timer can hold", async () => {
    expect(await parseTimeout(["--timeout", "2147483"])).toBe(2_147_483);
  });

  test.each(["2147484", "3600000", "4294968"])(
    "rejects %s seconds, which would overflow the timer",
    async (value) => {
      await expect(parseTimeout(["--timeout", value])).rejects.toThrow(
        "The value is in seconds, not milliseconds."
      );
    }
  );
});

describe("timeoutMs", () => {
  test("converts seconds to milliseconds", () => {
    expect(timeoutMs(600)).toBe(600_000);
  });

  test("keeps the largest accepted timeout inside a 32-bit signed integer", () => {
    expect(timeoutMs(2_147_483)).toBeLessThanOrEqual(2_147_483_647);
  });
});

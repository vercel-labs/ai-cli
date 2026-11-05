import { afterEach, describe, expect, test, vi } from "vitest";

import { isColorEnabledForStream } from "./color.js";

const tty = { isTTY: true };
const pipe = { isTTY: false };
const originalArgv = process.argv;

afterEach(() => {
  process.argv = originalArgv;
  vi.unstubAllEnvs();
});

describe("color precedence", () => {
  test("no-color overrides the environment", () => {
    process.argv = [...originalArgv, "--no-color"];
    vi.stubEnv("FORCE_COLOR", "1");
    expect(isColorEnabledForStream(tty)).toBe(false);
  });

  test("nonempty NO_COLOR overrides FORCE_COLOR, but empty NO_COLOR does not", () => {
    vi.stubEnv("FORCE_COLOR", "1");
    vi.stubEnv("NO_COLOR", "1");
    expect(isColorEnabledForStream(tty)).toBe(false);
    vi.stubEnv("NO_COLOR", "");
    expect(isColorEnabledForStream(pipe)).toBe(true);
  });

  test("FORCE_COLOR overrides TERM and TTY, including explicit zero", () => {
    vi.stubEnv("NO_COLOR", "");
    vi.stubEnv("TERM", "dumb");
    vi.stubEnv("FORCE_COLOR", "1");
    expect(isColorEnabledForStream(pipe)).toBe(true);
    vi.stubEnv("FORCE_COLOR", "0");
    expect(isColorEnabledForStream(tty)).toBe(false);
  });

  test("uses TERM and the individual stream when no override is set", () => {
    vi.stubEnv("NO_COLOR", "");
    vi.stubEnv("FORCE_COLOR", "");
    vi.stubEnv("TERM", "dumb");
    expect(isColorEnabledForStream(tty)).toBe(false);
    vi.stubEnv("TERM", "xterm");
    expect(isColorEnabledForStream(tty)).toBe(true);
    expect(isColorEnabledForStream(pipe)).toBe(false);
  });
});

import { afterEach, expect, test, vi } from "vitest";

import { redact } from "./redact.js";

afterEach(() => vi.unstubAllEnvs());

test("redacts repeated environment secrets and bearer tokens", () => {
  vi.stubEnv("AI_GATEWAY_API_KEY", "abcdefgh");
  vi.stubEnv("VERCEL_OIDC_TOKEN", "abcdefgh-longer");
  expect(
    redact("abcdefgh-longer abcdefgh abcdefgh Bearer token123 bearer another")
  ).toBe("[redacted] [redacted] [redacted] [redacted] [redacted]");
});

test("does not replace short environment values", () => {
  vi.stubEnv("AI_GATEWAY_API_KEY", "short");
  vi.stubEnv("VERCEL_OIDC_TOKEN", "");
  expect(redact("short value")).toBe("short value");
});

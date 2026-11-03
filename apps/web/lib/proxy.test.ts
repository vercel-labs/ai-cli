import { NextRequest, type NextFetchEvent } from "next/server";
import { describe, expect, test } from "vitest";

import proxy from "../proxy";

const event = {} as NextFetchEvent;

function request(pathname: string, headers: Record<string, string> = {}) {
  return new NextRequest(new URL(pathname, "https://ai-cli.dev"), { headers });
}

function rewriteTarget(response: Response): string | null {
  const target = response.headers.get("x-middleware-rewrite");
  return target ? new URL(target).pathname : null;
}

describe("proxy", () => {
  test.each([
    ["/", "/api/docs-md"],
    ["/missing-page", "/api/docs-md/missing-page"],
  ])("rewrites %s to Markdown for agents", async (pathname, target) => {
    const response = await proxy(
      request(pathname, { "user-agent": "ClaudeBot/1.0" }),
      event
    );

    expect(rewriteTarget(response)).toBe(target);
  });

  test("rewrites docs pages to Markdown for Accept: text/markdown", async () => {
    const response = await proxy(
      request("/docs/decide", { accept: "text/markdown" }),
      event
    );

    expect(rewriteTarget(response)).toBe("/api/docs-md/docs/decide");
    expect(response.headers.get("vary")).toContain("Accept");
  });

  test("keeps browsers and prefetches on HTML", async () => {
    const browser = await proxy(request("/", { accept: "text/html" }), event);
    const prefetch = await proxy(
      request("/", { "user-agent": "ClaudeBot/1.0", rsc: "1" }),
      event
    );

    expect(rewriteTarget(browser)).toBeNull();
    expect(rewriteTarget(prefetch)).toBeNull();
    expect(browser.headers.get("vary")).toContain("User-Agent");
  });

  test("redirects the localized docs prefix", async () => {
    const response = await proxy(request("/en/docs/decide"), event);

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "https://ai-cli.dev/docs/decide"
    );
  });
});

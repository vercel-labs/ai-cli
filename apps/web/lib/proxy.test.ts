import { NextRequest, type NextFetchEvent } from "next/server";
import { describe, expect, test } from "vitest";

import { GET as docsMarkdown } from "../app/api/docs-md/[[...slug]]/route";
import proxy from "../proxy";

const event = {} as NextFetchEvent;
const agent = { "user-agent": "ClaudeBot/1.0" };
const browser = {
  accept: "text/html,application/xhtml+xml",
  "user-agent": "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/140.0",
};

function request(pathname: string, headers: Record<string, string> = {}) {
  return new NextRequest(new URL(pathname, "https://ai-cli.dev"), { headers });
}

function rewriteTarget(response: Response): string | null {
  const target = response.headers.get("x-middleware-rewrite");
  return target ? new URL(target, "https://ai-cli.dev").pathname : null;
}

describe("proxy Markdown negotiation", () => {
  test.each([
    ["/", agent, "/api/docs-md"],
    ["/missing-page", agent, "/api/docs-md/missing-page"],
    ["/docs/decide", agent, "/api/docs-md/docs/decide"],
    ["/docs/missing-page", agent, "/api/docs-md/docs/missing-page"],
    ["/", { accept: "text/markdown" }, "/api/docs-md"],
    ["/docs/decide", { accept: "text/markdown" }, "/api/docs-md/docs/decide"],
    ["/", { accept: "text/plain" }, "/api/docs-md"],
    ["/docs/decide", { accept: "text/plain" }, "/api/docs-md/docs/decide"],
  ])("rewrites %s for %o to %s", async (pathname, headers, target) => {
    const response = await proxy(request(pathname, headers), event);

    expect(rewriteTarget(response)).toBe(target);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toContain("User-Agent");
  });

  test.each([
    ["/", null],
    ["/docs/decide", "/en/docs/decide"],
  ])(
    "keeps browsers on cacheable HTML for %s",
    async (pathname, htmlTarget) => {
      const response = await proxy(request(pathname, browser), event);

      expect(rewriteTarget(response)).toBe(htmlTarget);
      expect(response.headers.get("cache-control")).toBeNull();
      expect(response.headers.get("vary")).toContain("Accept");
    }
  );

  test.each([
    ["/", { rsc: "1" }, null],
    ["/docs/decide", { rsc: "1" }, "/en/docs/decide"],
    ["/docs/decide", { "next-router-prefetch": "1" }, "/en/docs/decide"],
    ["/docs/decide", { "sec-purpose": "prefetch" }, "/en/docs/decide"],
  ])(
    "keeps agent prefetches of %s on HTML (%o)",
    async (pathname, headers, htmlTarget) => {
      const response = await proxy(
        request(pathname, { ...agent, ...headers }),
        event
      );

      expect(rewriteTarget(response)).toBe(htmlTarget);
      expect(response.headers.get("cache-control")).toBeNull();
    }
  );

  test("returns 404 for malformed percent-encoding", async () => {
    const response = await proxy(request("/docs/%E0%A4%A"), event);

    expect(response.status).toBe(404);
  });

  test("redirects the localized docs prefix", async () => {
    const response = await proxy(request("/en/docs/decide"), event);

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "https://ai-cli.dev/docs/decide"
    );
  });
});

describe("docs Markdown route", () => {
  test("answers a missing docs page with a Markdown 404", async () => {
    const response = await docsMarkdown(new Request("https://ai-cli.dev"), {
      params: Promise.resolve({ slug: ["docs", "missing-page"] }),
    });

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe(
      "text/markdown; charset=utf-8"
    );
    expect(await response.text()).toContain("# Page Not Found");
  });
});

import { describe, expect, test } from "vitest";

import { GET } from "../app/api/docs-md/[[...slug]]/route";
import { isSafePathSegments } from "./docs-pages";
import { markdownForPathname } from "./page-markdown";

describe("isSafePathSegments", () => {
  test.each([
    ["parent segment", ["docs", ".."]],
    ["slash segment", ["docs/installation"]],
    ["backslash segment", ["docs", String.raw`..\installation`]],
  ])("rejects a decoded %s", (_name, segments) => {
    expect(isSafePathSegments(segments)).toBe(false);
  });

  test("accepts ordinary nested segments", () => {
    expect(isSafePathSegments(["docs", "guides", "installation"])).toBe(true);
  });
});

describe("markdownForPathname", () => {
  test("rejects a slash contained in a decoded route segment", async () => {
    const page = await markdownForPathname("/docs/installation", [
      "docs/installation",
    ]);

    expect(page.found).toBe(false);
  });

  test("keeps ordinary docs paths working", async () => {
    const page = await markdownForPathname("/docs/installation", [
      "docs",
      "installation",
    ]);

    expect(page.found).toBe(true);
    expect(page.canonicalUrl).toBe("https://ai-cli.dev/docs/installation");
  });
});

describe("docs Markdown route", () => {
  test.each([
    ["slash", ["docs/installation"]],
    ["parent", ["docs", ".."]],
    ["backslash", ["docs", String.raw`..\installation`]],
  ])("rejects a decoded %s segment", async (_name, slug) => {
    const response = await GET(new Request("https://ai-cli.dev"), {
      params: Promise.resolve({ slug }),
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/markdown; charset=utf-8"
    );
    expect(body).toContain("# Page Not Found");
    expect(body).not.toContain("# Installation");
  });

  test("serves an ordinary docs path", async () => {
    const response = await GET(new Request("https://ai-cli.dev"), {
      params: Promise.resolve({ slug: ["docs", "installation"] }),
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("# Installation");
  });
});

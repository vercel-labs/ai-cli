import { shouldServeMarkdown } from "@vercel/agent-readability";
import { createProxy } from "@vercel/geistdocs/proxy";
import { createI18nMiddleware } from "fumadocs-core/i18n/middleware";
import {
  type NextFetchEvent,
  type NextRequest,
  NextResponse,
} from "next/server";

import { applyDocsResponseHeaders } from "@/lib/docs-response-headers";
import { config as geistdocsConfig } from "@/lib/geistdocs/config";

// Same media types geistdocs uses for /docs, so every path negotiates alike.
const MARKDOWN_MEDIA_TYPES = ["text/markdown", "text/x-markdown", "text/plain"];

function wantsMarkdown(request: NextRequest): boolean {
  return shouldServeMarkdown(request, { mediaTypes: MARKDOWN_MEDIA_TYPES })
    .serve;
}

function isMarkdownRewrite(response: Response): boolean {
  const target = response.headers.get("x-middleware-rewrite");
  return target !== null && new URL(target, "https://ai-cli.dev").pathname.startsWith("/api/docs-md");
}

const localeProxy = createI18nMiddleware({
  defaultLanguage: "en",
  languages: ["en"],
  hideLocale: "default-locale",
});

function isPrefetch(request: NextRequest): boolean {
  return (
    request.headers.get("rsc") === "1" ||
    request.headers.has("next-router-prefetch") ||
    request.headers.has("next-router-segment-prefetch") ||
    /\bprefetch\b/i.test(request.headers.get("purpose") ?? "") ||
    /\bprefetch\b/i.test(request.headers.get("sec-purpose") ?? "")
  );
}

const geistdocsProxy = createProxy({
  config: geistdocsConfig,
  markdownRoutes: [{ from: "/docs/*path", to: "/api/docs-md/docs/*path" }],
  before: async ({ request, context }) => {
    // RSC and prefetch requests always get the HTML payload, never negotiated Markdown.
    if (isPrefetch(request)) {
      return (await localeProxy(request, context)) ?? NextResponse.next();
    }
  },
});

export default async function proxy(
  request: NextRequest,
  event: NextFetchEvent
) {
  const { pathname } = request.nextUrl;
  try {
    decodeURIComponent(pathname);
  } catch (error) {
    if (!(error instanceof URIError)) {
      throw error;
    }
    return new NextResponse("Not Found", { status: 404 });
  }

  let response: Response;
  if (pathname === "/en/docs" || pathname.startsWith("/en/docs/")) {
    const destination = request.nextUrl.clone();
    destination.pathname = pathname.slice(3);
    response = NextResponse.redirect(destination, 308);
  } else if (
    (pathname === "/docs" || pathname.startsWith("/docs/")) &&
    !pathname.includes(".")
  ) {
    response = await geistdocsProxy(request, event);
  } else if (pathname === "/" || wantsMarkdown(request)) {
    // The home page and unknown paths answer agents with Markdown (or a Markdown 404).
    response =
      !isPrefetch(request) && wantsMarkdown(request)
        ? NextResponse.rewrite(
            new URL(
              `/api/docs-md${pathname === "/" ? "" : pathname}`,
              request.url
            )
          )
        : NextResponse.next();
  } else {
    return NextResponse.next();
  }
  applyDocsResponseHeaders(response.headers, {
    markdown: isMarkdownRewrite(response),
  });
  return response;
}

export const config = {
  matcher: [
    "/((?!_next|api|og|.*\\..*|favicon|manifest|robots|health|status).*)",
    "/(.*%.*)",
  ],
};

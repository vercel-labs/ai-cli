import { applyMarkdownHeaders } from "@vercel/agent-readability";

import { markdownForPathname } from "@/lib/page-markdown";

interface Props {
  params: Promise<{ slug?: string[] }>;
}

export async function GET(_request: Request, { params }: Props) {
  const { slug } = await params;
  const pathname = slug && slug.length > 0 ? `/${slug.join("/")}` : "/";
  const page = await markdownForPathname(pathname, slug ?? []);
  const headers = new Headers({
    "Content-Type": "text/markdown; charset=utf-8",
  });
  applyMarkdownHeaders(headers, { canonicalUrl: page.canonicalUrl });

  return new Response(page.body, {
    status: page.found ? 200 : 404,
    headers,
  });
}

const negotiationHeaders = [
  "Accept",
  "User-Agent",
  "Signature-Agent",
  "Sec-Fetch-Mode",
  "Sec-Fetch-Dest",
  "RSC",
  "Next-Router-Prefetch",
  "Next-Router-Segment-Prefetch",
  "Purpose",
  "Sec-Purpose",
];

/**
 * Marks a response as varying on every header that selects HTML or Markdown.
 * Only negotiated Markdown opts out of caching: Routing Middleware runs before
 * the CDN cache, so cached HTML is never served to a Markdown client.
 */
export function applyDocsResponseHeaders(
  headers: Headers,
  { markdown }: { markdown: boolean }
) {
  const tokens = new Map<string, string>();
  for (const token of [
    ...(headers.get("Vary") ?? "").split(/\s*,\s*/),
    ...negotiationHeaders,
  ]) {
    if (token) {
      tokens.set(token.toLowerCase(), token);
    }
  }
  headers.set("Vary", [...tokens.values()].join(", "));
  if (!markdown) {
    return;
  }
  headers.set("Cache-Control", "private, no-store");
  headers.set("CDN-Cache-Control", "no-store");
  headers.set("Vercel-CDN-Cache-Control", "no-store");
}

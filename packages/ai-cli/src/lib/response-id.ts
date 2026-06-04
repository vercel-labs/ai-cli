const RESPONSE_ID_HEADERS = [
  "x-ai-gateway-response-id",
  "x-ai-gateway-request-id",
  "x-vercel-id",
  "x-request-id",
  "request-id",
];

export function responseIdFromHeaders(
  headers?: Record<string, string>
): string | undefined {
  if (!headers) return undefined;

  const normalized = new Map(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );

  for (const header of RESPONSE_ID_HEADERS) {
    const value = normalized.get(header)?.trim();
    if (value) return value;
  }

  return undefined;
}

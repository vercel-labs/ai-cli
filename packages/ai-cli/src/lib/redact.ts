export function redact(message: string): string {
  let result = message.replace(/\bBearer\s+[^\s,;"']+/gi, "[redacted]");
  const secrets = [
    process.env.AI_GATEWAY_API_KEY,
    process.env.VERCEL_OIDC_TOKEN,
  ]
    .filter((value): value is string => Boolean(value && value.length >= 8))
    .sort((a, b) => b.length - a.length);
  for (const secret of secrets)
    result = result.split(secret).join("[redacted]");
  return result;
}

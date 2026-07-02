function trimNumber(value: number, decimals: number): string {
  const rounded = value.toFixed(decimals);
  return rounded.includes(".")
    ? rounded.replace(/0+$/, "").replace(/\.$/, "")
    : rounded;
}

export function formatTokenCount(count: number): string {
  if (count >= 1_000_000) return `${trimNumber(count / 1_000_000, 1)}M`;
  if (count >= 1_000) return `${Math.round(count / 1_000)}K`;
  return String(count);
}

export function formatPricePerMillion(perToken: string): string {
  const value = Number.parseFloat(perToken);
  if (!Number.isFinite(value)) return perToken;
  return `$${trimNumber(value * 1_000_000, 4)}/M`;
}

// The gateway reports web_search pricing in dollars per 1K searches
export function formatWebSearchPrice(perThousand: string): string {
  const value = Number.parseFloat(perThousand);
  if (!Number.isFinite(value)) return perThousand;
  return `$${trimNumber(value, 4)}/K + input costs`;
}

export function formatPerUnitPrice(perUnit: string, unit: string): string {
  const value = Number.parseFloat(perUnit);
  if (!Number.isFinite(value)) return perUnit;
  return `$${trimNumber(value, 4)}/${unit}`;
}

export function formatLatency(ms: number): string {
  return `${trimNumber(ms / 1_000, 1)}s`;
}

export function formatThroughput(tokensPerSecond: number): string {
  return `${Math.round(tokensPerSecond)}tps`;
}

export function formatUptime(percent: number): string {
  return `${trimNumber(Math.floor(percent * 10) / 10, 1)}%`;
}

export function formatReleaseDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1_000).toISOString().slice(0, 10);
}

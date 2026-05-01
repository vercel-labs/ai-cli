export function parsePositiveInt(value: string, name: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`--${name} must be a positive integer, got "${value}"`);
  }
  const n = parseInt(value, 10);
  if (n <= 0) {
    throw new Error(`--${name} must be a positive integer, got "${value}"`);
  }
  return n;
}

export function parseNonNegativeFloat(value: string, name: string): number {
  const n = parseFloat(value);
  if (isNaN(n) || n < 0) {
    throw new Error(`--${name} must be a non-negative number, got "${value}"`);
  }
  return n;
}

export function parseSize(value: string): `${number}x${number}` {
  if (!/^\d+x\d+$/.test(value)) {
    throw new Error(
      `--size must be in WxH format (e.g. 1024x1024), got "${value}"`
    );
  }
  return value as `${number}x${number}`;
}

export function parseAspectRatio(value: string): `${number}:${number}` {
  if (!/^\d+:\d+$/.test(value)) {
    throw new Error(
      `--aspect-ratio must be in W:H format (e.g. 16:9), got "${value}"`
    );
  }
  return value as `${number}:${number}`;
}

export function parseTemperature(value: string): number {
  const n = parseFloat(value);
  if (isNaN(n) || n < 0 || n > 2) {
    throw new Error(`--temperature must be between 0 and 2, got "${value}"`);
  }
  return n;
}

export function parsePositiveInt(value: string, name: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`--${name} must be a positive integer, got "${value}"`);
  }
  const n = parseInt(value, 10);
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new Error(`--${name} must be a positive integer, got "${value}"`);
  }
  return n;
}

export function parseNonNegativeFloat(value: string, name: string): number {
  const n = Number(value);
  if (
    !/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value) ||
    !Number.isFinite(n) ||
    n < 0
  ) {
    throw new Error(`--${name} must be a non-negative number, got "${value}"`);
  }
  return n;
}

export function parseSize(value: string, name = "size"): `${number}x${number}` {
  if (
    !/^\d+x\d+$/.test(value) ||
    !value.split("x").every(positiveSafeInteger)
  ) {
    throw new Error(
      `--${name} must be in WxH format (e.g. 1024x1024), got "${value}"`
    );
  }
  return value as `${number}x${number}`;
}

export function parseAspectRatio(value: string): `${number}:${number}` {
  if (
    !/^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(value) ||
    !value
      .split(":")
      .every((part) => Number.isFinite(Number(part)) && Number(part) > 0)
  ) {
    throw new Error(
      `--aspect-ratio must be in W:H format (e.g. 16:9), got "${value}"`
    );
  }
  return value as `${number}:${number}`;
}

export function parseTemperature(value: string): number {
  const n = Number(value);
  if (
    !/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value) ||
    !Number.isFinite(n) ||
    n < 0 ||
    n > 2
  ) {
    throw new Error(`--temperature must be between 0 and 2, got "${value}"`);
  }
  return n;
}

function positiveSafeInteger(value: string): boolean {
  return Number.isSafeInteger(Number(value)) && Number(value) > 0;
}

export function parseInteger(value: string, name: string): number {
  if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error(`--${name} must be a safe integer, got "${value}"`);
  }
  return Number(value);
}

export function parseNonNegativeInt(value: string, name: string): number {
  const n = parseInteger(value, name);
  if (n < 0) throw new Error(`--${name} must be a non-negative integer`);
  return n;
}

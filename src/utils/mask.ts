const keyPrefixes = [
  'sk-',
  'pk-',
  'sk_',
  'pk_',
  'ghp_',
  'gho_',
  'ghu_',
  'ghs_',
  'ghr_',
  'xoxb-',
  'xoxp-',
  'xoxa-',
  'xoxr-',
  'eyJ',
  'Bearer ',
  'AKIA',
  'ABIA',
  'ACCA',
  'AGPA',
  'AIDA',
  'AIPA',
  'ANPA',
  'ANVA',
  'AROA',
  'APKA',
  'ASCA',
  'ASIA',
  'npm_',
  'pypi-',
  'glpat-',
  'glsa-',
  'vck_',
  'vcka_',
];

const keyValuePatterns = [
  /([A-Z_]*(?:KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|AUTH|PRIVATE)[A-Z_]*)[=:]["']?([^"'\s\n]{8,})["']?/gi,
  /([a-z_]*(?:key|secret|token|password|credential|auth|private)[a-z_]*)[=:]["']?([^"'\s\n]{8,})["']?/gi,
  /(bearer)\s+([^\s\n]{10,})/gi,
  /(authorization)[=:\s]["']?([^\s"'\n]{10,})["']?/gi,
];

function maskValue(value: string): string {
  if (value.length <= 4) return '****';
  return value.slice(0, 4) + '*'.repeat(Math.min(value.length - 4, 16));
}

export function mask(text: string): string {
  let result = text;

  for (const pattern of keyValuePatterns) {
    result = result.replace(pattern, (match, _key, value) => {
      return match.replace(value, maskValue(value));
    });
  }

  for (const prefix of keyPrefixes) {
    const regex = new RegExp(
      `(${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})([A-Za-z0-9_-]{8,})`,
      'g',
    );
    result = result.replace(regex, (_match, p, value) => {
      return p + maskValue(value);
    });
  }

  return result;
}

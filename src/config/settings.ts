import { type Config, getConfig, setConfig } from './index.js';

export type Settings = Pick<
  Config,
  'spacing' | 'markdown' | 'model' | 'search' | 'steps'
>;

let cached: Settings | null = null;

export function loadSettings(): Settings {
  if (cached) return cached;
  const config = getConfig();
  cached = {
    spacing: config.spacing ?? 1,
    markdown: config.markdown ?? true,
    model: config.model ?? '',
    search: config.search ?? 'perplexity',
    steps: config.steps ?? 30,
  };
  return cached;
}

export function getSetting<K extends keyof Settings>(key: K): Settings[K] {
  return loadSettings()[key];
}

export function setSetting<K extends keyof Settings>(
  key: K,
  value: Settings[K],
): void {
  setConfig({ [key]: value });
  cached = null;
}

export function invalidateSettingsCache(): void {
  cached = null;
}

import { getConfig, setConfig, type Config } from './index.js';

export type Settings = Pick<Config, 'spacing' | 'markdown' | 'model' | 'search' | 'steps'>;

export function loadSettings(): Settings {
  const config = getConfig();
  return {
    spacing: config.spacing ?? 1,
    markdown: config.markdown ?? true,
    model: config.model ?? '',
    search: config.search ?? 'perplexity',
    steps: config.steps ?? 10,
  };
}

export function getSetting<K extends keyof Settings>(key: K): Settings[K] {
  return loadSettings()[key];
}

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  setConfig({ [key]: value });
}

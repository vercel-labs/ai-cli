import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CONFIG_FILE, ensureBaseDir } from './paths.js';

export interface Config {
  apiKey?: string;
  model?: string;
  aliases?: Record<string, string>;
  spacing?: number;
  markdown?: boolean;
  search?: 'perplexity' | 'parallel';
  steps?: number;
}

const defaults: Config = {
  spacing: 1,
  markdown: true,
  search: 'perplexity',
  steps: 10,
};

function migrateOldConfig(): Config | null {
  const home = os.homedir();
  const oldRc = path.join(home, '.airc');
  const oldSettings = path.join(home, '.ai-settings');

  let migrated: Config = {};

  try {
    if (fs.existsSync(oldRc)) {
      const content = fs.readFileSync(oldRc, 'utf-8');
      const keyMatch = content.match(/AI_GATEWAY_API_KEY=(.+)/);
      if (keyMatch) migrated.apiKey = keyMatch[1].trim();
      const modelMatch = content.match(/model=(.+)/);
      if (modelMatch) migrated.model = modelMatch[1].trim();
      fs.unlinkSync(oldRc);
    }
  } catch {}

  try {
    if (fs.existsSync(oldSettings)) {
      const data = JSON.parse(fs.readFileSync(oldSettings, 'utf-8'));
      migrated = { ...migrated, ...data };
      fs.unlinkSync(oldSettings);
    }
  } catch {}

  if (Object.keys(migrated).length > 0) {
    return migrated;
  }
  return null;
}

export function getConfig(): Config {
  ensureBaseDir();
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
      return { ...defaults, ...data };
    }

    const migrated = migrateOldConfig();
    if (migrated) {
      const merged = { ...defaults, ...migrated };
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), 'utf-8');
      return merged;
    }
  } catch {}
  return { ...defaults };
}

export function setConfig(config: Partial<Config>): void {
  ensureBaseDir();
  const current = getConfig();
  const merged = { ...current, ...config };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), 'utf-8');
}

export function getAliases(): Record<string, string> {
  return getConfig().aliases || {};
}

export function setAlias(shortcut: string, command: string): void {
  const aliases = getAliases();
  aliases[shortcut] = command;
  setConfig({ aliases });
}

export function removeAlias(shortcut: string): boolean {
  const aliases = getAliases();
  if (aliases[shortcut]) {
    delete aliases[shortcut];
    setConfig({ aliases });
    return true;
  }
  return false;
}

export function getApiKey(): string | null {
  return process.env.AI_GATEWAY_API_KEY || getConfig().apiKey || null;
}

export function setApiKey(apiKey: string): void {
  setConfig({ apiKey });
}

export function getModel(): string | null {
  return getConfig().model || null;
}

export function setModel(model: string): void {
  setConfig({ model });
}

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { logError } from '../utils/errorlog.js';
import { CONFIG_FILE, ensureBaseDir } from './paths.js';

export interface Config {
  apiKey?: string;
  model?: string;
  aliases?: Record<string, string>;
  spacing?: number;
  markdown?: boolean;
  search?: 'perplexity' | 'parallel';
}

const defaults: Config = {
  spacing: 1,
  markdown: true,
  search: 'perplexity',
};

let cachedConfig: Config | null = null;
let cachedMtimeMs: number | null = null;

function configFileChanged(): boolean {
  try {
    const stat = fs.statSync(CONFIG_FILE);
    return stat.mtimeMs !== cachedMtimeMs;
  } catch {
    return true;
  }
}

function snapshotMtime(): void {
  try {
    cachedMtimeMs = fs.statSync(CONFIG_FILE).mtimeMs;
  } catch {
    cachedMtimeMs = null;
  }
}

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
  } catch (e) {
    logError(e);
  }

  try {
    if (fs.existsSync(oldSettings)) {
      const data = JSON.parse(fs.readFileSync(oldSettings, 'utf-8'));
      migrated = { ...migrated, ...data };
      fs.unlinkSync(oldSettings);
    }
  } catch (e) {
    logError(e);
  }

  if (Object.keys(migrated).length > 0) {
    return migrated;
  }
  return null;
}

export function getConfig(): Config {
  if (cachedConfig && !configFileChanged()) return cachedConfig;
  ensureBaseDir();
  let result: Config;
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));

      // Migrate: steps setting has been removed — clean it from persisted config.
      if ('steps' in data) {
        delete data.steps;
        try {
          fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2), 'utf-8');
        } catch {
          // best-effort cleanup
        }
      }

      result = { ...defaults, ...data };
      cachedConfig = result;
      snapshotMtime();
      return result;
    }

    const migrated = migrateOldConfig();
    if (migrated) {
      result = { ...defaults, ...migrated };
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(result, null, 2), 'utf-8');
      cachedConfig = result;
      snapshotMtime();
      return result;
    }
  } catch (e) {
    logError(e);
  }
  result = { ...defaults };
  cachedConfig = result;
  cachedMtimeMs = null;
  return result;
}

export function setConfig(config: Partial<Config>): void {
  ensureBaseDir();
  const current = getConfig();
  const merged = { ...current, ...config };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), 'utf-8');
  cachedConfig = null;
  cachedMtimeMs = null;
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

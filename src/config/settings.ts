import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const settingsFile = path.join(os.homedir(), '.ai-settings');

export interface Settings {
  spacing: number;
  markdown: boolean;
  yolo: boolean;
}

const defaults: Settings = {
  spacing: 1,
  markdown: true,
  yolo: false,
};

export function loadSettings(): Settings {
  try {
    if (fs.existsSync(settingsFile)) {
      const data = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
      return { ...defaults, ...data };
    }
  } catch {}
  return { ...defaults };
}

export function saveSettings(settings: Settings): void {
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf-8');
}

export function getSetting<K extends keyof Settings>(key: K): Settings[K] {
  return loadSettings()[key];
}

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  const settings = loadSettings();
  settings[key] = value;
  saveSettings(settings);
}

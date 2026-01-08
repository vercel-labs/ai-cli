import { readUser, updateUser } from 'rc9';

export interface Config {
  AI_GATEWAY_API_KEY?: string;
  model?: string;
  aliases?: Record<string, string>;
}

export function getConfig(): Config {
  return readUser('.airc');
}

export function setConfig(config: Partial<Config>): void {
  updateUser(config, '.airc');
}

export function getAliases(): Record<string, string> {
  const config = getConfig();
  return config.aliases || {};
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
  const config = getConfig();
  return process.env.AI_GATEWAY_API_KEY || config.AI_GATEWAY_API_KEY || null;
}

export function setApiKey(apiKey: string): void {
  setConfig({ AI_GATEWAY_API_KEY: apiKey });
}

export function getModel(): string | null {
  const config = getConfig();
  return config.model || null;
}

export function setModel(model: string): void {
  setConfig({ model });
}

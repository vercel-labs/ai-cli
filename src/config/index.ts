import { readUser, updateUser } from 'rc9';

export interface Config {
  AI_GATEWAY_API_KEY?: string;
}

export function getConfig(): Config {
  return readUser('.airc');
}

export function setConfig(config: Partial<Config>): void {
  updateUser(config, '.airc');
}

export function getApiKey(): string | null {
  const config = getConfig();
  return process.env.AI_GATEWAY_API_KEY || config.AI_GATEWAY_API_KEY || null;
}

export function setApiKey(apiKey: string): void {
  setConfig({ AI_GATEWAY_API_KEY: apiKey });
}

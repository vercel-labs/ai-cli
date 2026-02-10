import * as fs from 'node:fs';
import { ensureBaseDir, MCP_FILE } from './paths.js';

export interface McpServerConfig {
  type: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export interface McpConfig {
  servers: Record<string, McpServerConfig>;
}

function expandEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, expr) => {
    const [name, fallback] = expr.split(':-');
    return process.env[name] || fallback || '';
  });
}

function expandConfig(config: McpServerConfig): McpServerConfig {
  const expanded = { ...config };
  if (expanded.url) expanded.url = expandEnvVars(expanded.url);
  if (expanded.command) expanded.command = expandEnvVars(expanded.command);
  if (expanded.args) expanded.args = expanded.args.map(expandEnvVars);
  if (expanded.env) {
    expanded.env = Object.fromEntries(
      Object.entries(expanded.env).map(([k, v]) => [k, expandEnvVars(v)]),
    );
  }
  if (expanded.headers) {
    expanded.headers = Object.fromEntries(
      Object.entries(expanded.headers).map(([k, v]) => [k, expandEnvVars(v)]),
    );
  }
  return expanded;
}

export function getMcpConfig(): McpConfig {
  ensureBaseDir();
  try {
    if (fs.existsSync(MCP_FILE)) {
      const data = JSON.parse(fs.readFileSync(MCP_FILE, 'utf-8'));
      return { servers: data.servers || {} };
    }
  } catch {}
  return { servers: {} };
}

export function saveMcpConfig(config: McpConfig): void {
  ensureBaseDir();
  fs.writeFileSync(MCP_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

export function getMcpServers(): Record<string, McpServerConfig> {
  const config = getMcpConfig();
  const expanded: Record<string, McpServerConfig> = {};
  for (const [name, server] of Object.entries(config.servers)) {
    expanded[name] = expandConfig(server);
  }
  return expanded;
}

export function addMcpServer(name: string, config: McpServerConfig): void {
  const current = getMcpConfig();
  current.servers[name] = config;
  saveMcpConfig(current);
}

export function removeMcpServer(name: string): boolean {
  const current = getMcpConfig();
  if (current.servers[name]) {
    delete current.servers[name];
    saveMcpConfig(current);
    return true;
  }
  return false;
}

export function listMcpServers(): string[] {
  return Object.keys(getMcpConfig().servers);
}

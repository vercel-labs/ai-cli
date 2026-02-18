import {
  addMcpServer,
  getMcpServers,
  listMcpServers,
  type McpServerConfig,
  removeMcpServer,
} from '../../config/mcp.js';
import { clearMcpCache } from '../../tools/index.js';
import { getMcpStatus, reconnectMcp } from '../../utils/mcp.js';
import type { CommandHandler } from './types.js';

export const mcp: CommandHandler = async (_ctx, args = '') => {
  const parts = args.split(' ').filter(Boolean);
  const sub = parts[0]?.toLowerCase();

  if (!sub || sub === 'list') {
    const servers = listMcpServers();
    if (servers.length === 0) {
      return { output: 'no mcp servers configured' };
    }
    const status = getMcpStatus();
    const lines = status.map((s) => `${s.connected ? '●' : '○'} ${s.name}`);
    return { output: lines.join('\n') };
  }

  if (sub === 'add') {
    const name = parts[1];
    const transport = parts[2];
    const target = parts[3];

    if (!name || !transport || !target) {
      return {
        output:
          'usage: /mcp add <name> <stdio|http|sse> <command|url> [args...]',
      };
    }

    let config: McpServerConfig;

    if (transport === 'stdio') {
      const cmdArgs = parts.slice(4);
      config = { type: 'stdio', command: target, args: cmdArgs };
    } else if (transport === 'http' || transport === 'sse') {
      config = { type: transport, url: target };
    } else {
      return { output: 'transport must be stdio, http, or sse' };
    }

    addMcpServer(name, config);
    clearMcpCache();
    await reconnectMcp();
    return { output: `added ${name}` };
  }

  if (sub === 'remove' || sub === 'rm') {
    const name = parts[1];
    if (!name) {
      return { output: 'usage: /mcp remove <name>' };
    }
    if (removeMcpServer(name)) {
      clearMcpCache();
      await reconnectMcp();
      return { output: `removed ${name}` };
    }
    return { output: `server ${name} not found` };
  }

  if (sub === 'reload') {
    clearMcpCache();
    await reconnectMcp();
    return { output: 'reloaded mcp servers' };
  }

  if (sub === 'get') {
    const name = parts[1];
    if (!name) {
      return { output: 'usage: /mcp get <name>' };
    }
    const servers = getMcpServers();
    const server = servers[name];
    if (!server) {
      return { output: `server ${name} not found` };
    }
    return { output: JSON.stringify(server, null, 2) };
  }

  return { output: 'commands: list, add, remove, reload, get' };
};

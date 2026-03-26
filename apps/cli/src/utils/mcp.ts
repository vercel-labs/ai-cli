import { createMCPClient } from "@ai-sdk/mcp";
import type { MCPClient } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport as StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";

import { getMcpServers } from "../config/mcp.js";
import type { McpServerConfig } from "../config/mcp.js";
import { log as debug } from "./debug.js";

interface McpConnection {
	client: MCPClient;
	name: string;
}

const connections = new Map<string, McpConnection>();
let initialized = false;

async function connectServer(
	name: string,
	config: McpServerConfig,
): Promise<McpConnection | null> {
	try {
		let client: MCPClient;

		if (config.type === "stdio" && config.command) {
			const transport = new StdioMCPTransport({
				command: config.command,
				args: config.args || [],
				env: { ...process.env, ...config.env } as Record<string, string>,
			});
			client = await createMCPClient({ transport });
		} else if (
			(config.type === "http" || config.type === "sse") &&
			config.url
		) {
			client = await createMCPClient({
				transport: {
					type: config.type,
					url: config.url,
					headers: config.headers,
				},
			});
		} else {
			debug(`mcp: invalid config for ${name}`);
			return null;
		}

		debug(`mcp: connected to ${name}`);
		return { client, name };
	} catch (error) {
		debug(`mcp: failed to connect to ${name}: ${error}`);
		return null;
	}
}

export async function initMcp(): Promise<void> {
	if (initialized) {
		return;
	}
	initialized = true;

	const servers = getMcpServers();
	const names = Object.keys(servers);

	if (names.length === 0) {
		return;
	}

	debug(`mcp: connecting to ${names.length} server(s)`);

	await Promise.allSettled(
		names.map(async (name) => {
			const conn = await connectServer(name, servers[name]);
			if (conn) {
				connections.set(name, conn);
			}
		}),
	);

	debug(`mcp: ${connections.size}/${names.length} connected`);
}

export async function getMcpTools(): Promise<Record<string, unknown>> {
	await initMcp();

	const allTools: Record<string, unknown> = {};

	for (const [name, conn] of connections) {
		try {
			const tools = await conn.client.tools();
			for (const [toolName, tool] of Object.entries(tools)) {
				const prefixedName = `${name}_${toolName}`;
				allTools[prefixedName] = tool;
			}
			debug(`mcp: loaded ${Object.keys(tools).length} tools from ${name}`);
		} catch (error) {
			debug(`mcp: failed to get tools from ${name}: ${error}`);
		}
	}

	return allTools;
}

export async function closeMcp(): Promise<void> {
	for (const [name, conn] of connections) {
		try {
			await conn.client.close();
			debug(`mcp: closed ${name}`);
		} catch (error) {
			debug(`mcp: error closing ${name}: ${error}`);
		}
	}
	connections.clear();
	initialized = false;
}

export function getMcpStatus(): { name: string; connected: boolean }[] {
	const servers = getMcpServers();
	return Object.keys(servers).map((name) => ({
		name,
		connected: connections.has(name),
	}));
}

export async function reconnectMcp(): Promise<void> {
	await closeMcp();
	await initMcp();
}

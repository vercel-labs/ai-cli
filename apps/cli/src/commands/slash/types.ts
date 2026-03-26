import type * as readline from "node:readline";

import type { ModelMessage } from "ai";

import type { Chat } from "../../config/chats.js";
import type { TokenUsage } from "../../hooks/chat.js";

export interface Context {
	model: string;
	version: string;
	chat: Chat | null;
	history: ModelMessage[];
	tokens: number;
	cost: number;
	tokenUsage: TokenUsage;
	rl: readline.Interface;
	createRl: () => readline.Interface;
	printHeader: () => void;
}

export interface CommandResult {
	model?: string;
	chat?: Chat | null;
	tokens?: number;
	cost?: number;
	rl?: readline.Interface;
	clearHistory?: boolean;
	clearScreen?: boolean;
	summary?: string;
	output?: string;
	planMode?: boolean;
}

export type CommandHandler = (
	ctx: Context,
	args?: string,
) => Promise<CommandResult | undefined> | CommandResult | undefined;

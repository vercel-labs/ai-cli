import * as fs from "node:fs";
import * as path from "node:path";

import { listChats } from "../../config/chats.js";
import { getApiKey } from "../../config/index.js";
import { CHATS_DIR, CONFIG_FILE } from "../../config/paths.js";
import { GATEWAY_URL } from "../../utils/models.js";
import type { CommandHandler } from "./types.js";

function formatBytes(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)} KB`;
	}
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getDirSize(dirPath: string): number {
	if (!fs.existsSync(dirPath)) {
		return 0;
	}
	let size = 0;
	const entries = fs.readdirSync(dirPath, { withFileTypes: true });
	for (const entry of entries) {
		const fullPath = path.join(dirPath, entry.name);
		if (entry.isDirectory()) {
			size += getDirSize(fullPath);
		} else {
			size += fs.statSync(fullPath).size;
		}
	}
	return size;
}

export const info: CommandHandler = async (ctx) => {
	const configSize = fs.existsSync(CONFIG_FILE)
		? fs.statSync(CONFIG_FILE).size
		: 0;
	const chatsSize = getDirSize(CHATS_DIR);
	const chatCount = listChats().length;

	let balance = "...";
	try {
		const res = await fetch(`${GATEWAY_URL}/v1/credits`, {
			headers: {
				Authorization: `Bearer ${getApiKey()}`,
			},
		});
		if (res.ok) {
			const data = (await res.json()) as { balance: string };
			balance = `$${Number.parseFloat(data.balance).toFixed(2)}`;
		}
	} catch {}

	const link = "\x1B]8;;https://x.com/nishimiya\x07x.com/nishimiya\x1B]8;;\x07";
	const lines = [
		`ai v${ctx.version}`,
		`model: ${ctx.model}`,
		`balance: ${balance}`,
		"",
		"storage:",
		`  config: ${formatBytes(configSize)}`,
		`  chats:  ${formatBytes(chatsSize)} (${chatCount} chats)`,
		"",
		`feedback: ${link}`,
	];

	return { output: lines.join("\n") };
};

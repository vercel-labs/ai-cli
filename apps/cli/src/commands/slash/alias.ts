import { getAliases, removeAlias, setAlias } from "../../config/index.js";
import type { CommandHandler } from "./types.js";

export const alias: CommandHandler = (_ctx, args) => {
	const aliases = getAliases();
	const arg = args?.trim();

	if (!arg) {
		if (Object.keys(aliases).length === 0) {
			return { output: "no aliases set\nusage: /alias <shortcut> <command>" };
		}
		const lines = ["aliases:"];
		for (const [k, v] of Object.entries(aliases)) {
			lines.push(`  /${k} → /${v}`);
		}
		lines.push("\n/alias <shortcut> <command> to add");
		lines.push("/alias -d <shortcut> to remove");
		return { output: lines.join("\n") };
	}

	if (arg.startsWith("-d ")) {
		const shortcut = arg.slice(3).trim();
		if (removeAlias(shortcut)) {
			return { output: `removed /${shortcut}` };
		}
		return { output: `alias /${shortcut} not found` };
	}

	const parts = arg.split(/\s+/);
	if (parts.length < 2) {
		return { output: "usage: /alias <shortcut> <command>" };
	}

	const shortcut = parts[0].replace(/^\//, "");
	const command = parts[1].replace(/^\//, "");

	setAlias(shortcut, command);
	return { output: `/${shortcut} → /${command}` };
};

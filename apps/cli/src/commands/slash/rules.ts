import { spawnSync } from "node:child_process";
import * as fs from "node:fs";

import { ensureBaseDir, RULES_FILE } from "../../config/paths.js";
import type { CommandHandler } from "./types.js";

export const rules: CommandHandler = (_ctx, args) => {
	ensureBaseDir();

	if (!args || args === "show") {
		if (!fs.existsSync(RULES_FILE)) {
			return { output: "no global rules\nuse: /rules edit" };
		}
		const content = fs.readFileSync(RULES_FILE, "utf8");
		return { output: `~/.ai-cli/AGENTS.md:\n\n${content}` };
	}

	if (args === "edit") {
		const editor = process.env.EDITOR || "nano";
		if (!fs.existsSync(RULES_FILE)) {
			fs.writeFileSync(RULES_FILE, "# Global Rules\n\n", "utf8");
		}
		spawnSync(editor, [RULES_FILE], { stdio: "inherit" });
		return { output: "rules updated" };
	}

	if (args === "clear") {
		if (fs.existsSync(RULES_FILE)) {
			fs.unlinkSync(RULES_FILE);
		}
		return { output: "rules cleared" };
	}

	if (args === "path") {
		return { output: RULES_FILE };
	}

	return { output: "use: /rules [show|edit|clear|path]" };
};

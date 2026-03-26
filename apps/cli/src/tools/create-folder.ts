import * as fs from "node:fs";

import { tool } from "ai";
import { z } from "zod";

import { resolveAnyPath, safePath } from "../utils/safe-path.js";
import { confirm } from "./confirm.js";

export const createFolder = tool({
	description: "Create a new folder/directory.",
	inputSchema: z.object({
		folderPath: z.string().describe("Absolute or relative path to create"),
	}),
	execute: async ({ folderPath }) => {
		try {
			let fullPath = safePath(folderPath);
			if (!fullPath) {
				const allowed = await confirm(
					`create folder outside project: ${folderPath}`,
					{ tool: "createFolder", noAlways: true },
				);
				if (!allowed) {
					return { error: "User denied access to path outside project." };
				}
				fullPath = resolveAnyPath(folderPath);
			}

			if (fs.existsSync(fullPath)) {
				return { error: `exists: ${folderPath}` };
			}

			fs.mkdirSync(fullPath, { recursive: true });
			return { message: `created ${folderPath}`, silent: true };
		} catch {
			return { error: `create failed: ${folderPath}` };
		}
	},
});

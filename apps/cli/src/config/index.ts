import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { z } from "zod";

import { logError } from "../utils/errorlog.js";
import { CONFIG_FILE, ensureBaseDir } from "./paths.js";

const reviewSchema = z
	.object({
		enabled: z.boolean().optional(),
		maxIterations: z.number().int().min(1).max(10).optional(),
	})
	.optional();

const configSchema = z
	.object({
		apiKey: z.string().optional(),
		model: z.string().optional(),
		aliases: z.record(z.string(), z.string()).optional(),
		spacing: z.number().int().min(0).max(4).optional(),
		markdown: z.boolean().optional(),
		search: z.enum(["perplexity", "parallel"]).optional(),
		review: reviewSchema,
	})
	.strip();

export type Config = z.infer<typeof configSchema>;

const defaults: Config = {
	spacing: 1,
	markdown: true,
	search: "perplexity",
};

let cachedConfig: Config | null = null;
let cachedMtimeMs: number | null = null;

function checkConfigFile(): { changed: boolean; mtimeMs: number | null } {
	try {
		const mtimeMs = fs.statSync(CONFIG_FILE).mtimeMs;
		return { changed: mtimeMs !== cachedMtimeMs, mtimeMs };
	} catch {
		return { changed: true, mtimeMs: null };
	}
}

function migrateOldConfig(): Config | null {
	const home = os.homedir();
	const oldRc = path.join(home, ".airc");
	const oldSettings = path.join(home, ".ai-settings");

	let migrated: Config = {};

	try {
		if (fs.existsSync(oldRc)) {
			const content = fs.readFileSync(oldRc, "utf8");
			const keyMatch = content.match(/AI_GATEWAY_API_KEY=(.+)/);
			if (keyMatch) {
				migrated.apiKey = keyMatch[1].trim();
			}
			const modelMatch = content.match(/model=(.+)/);
			if (modelMatch) {
				migrated.model = modelMatch[1].trim();
			}
			fs.unlinkSync(oldRc);
		}
	} catch (error) {
		logError(error);
	}

	try {
		if (fs.existsSync(oldSettings)) {
			const data = JSON.parse(fs.readFileSync(oldSettings, "utf8"));
			migrated = { ...migrated, ...data };
			fs.unlinkSync(oldSettings);
		}
	} catch (error) {
		logError(error);
	}

	if (Object.keys(migrated).length > 0) {
		return migrated;
	}
	return null;
}

export function getConfig(): Config {
	const check = checkConfigFile();
	if (cachedConfig && !check.changed) {
		return cachedConfig;
	}
	ensureBaseDir();
	let result: Config;
	try {
		if (fs.existsSync(CONFIG_FILE)) {
			const data = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));

			if ("steps" in data) {
				delete data.steps;
				try {
					fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2), "utf8");
				} catch {
					// best-effort cleanup
				}
			}

			const parsed = configSchema.safeParse(data);
			result = { ...defaults, ...(parsed.success ? parsed.data : data) };
			cachedConfig = result;
			cachedMtimeMs = check.mtimeMs;
			return result;
		}

		const migrated = migrateOldConfig();
		if (migrated) {
			const parsed = configSchema.safeParse(migrated);
			result = { ...defaults, ...(parsed.success ? parsed.data : migrated) };
			fs.writeFileSync(CONFIG_FILE, JSON.stringify(result, null, 2), "utf8");
			cachedConfig = result;
			cachedMtimeMs = check.mtimeMs;
			return result;
		}
	} catch (error) {
		logError(error);
	}
	result = { ...defaults };
	cachedConfig = result;
	cachedMtimeMs = null;
	return result;
}

export function setConfig(config: Partial<Config>): void {
	ensureBaseDir();
	const current = getConfig();
	const merged = { ...current, ...config };
	fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), "utf8");
	cachedConfig = null;
	cachedMtimeMs = null;
}

export function getAliases(): Record<string, string> {
	return getConfig().aliases || {};
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
	return process.env.AI_GATEWAY_API_KEY || getConfig().apiKey || null;
}

export function setApiKey(apiKey: string): void {
	setConfig({ apiKey });
}

export function getModel(): string | null {
	return getConfig().model || null;
}

export function setModel(model: string): void {
	setConfig({ model });
}

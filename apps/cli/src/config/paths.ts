import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const BASE_DIR = path.join(os.homedir(), ".ai-cli");
export const CONFIG_FILE = path.join(BASE_DIR, "config.json");
export const CHATS_DIR = path.join(BASE_DIR, "chats");
export const MEMORIES_FILE = path.join(BASE_DIR, "memories.json");
export const RULES_FILE = path.join(BASE_DIR, "AGENTS.md");
export const SKILLS_DIR = path.join(BASE_DIR, "skills");
export const MCP_FILE = path.join(BASE_DIR, "mcp.json");

export function ensureBaseDir(): void {
	if (!fs.existsSync(BASE_DIR)) {
		fs.mkdirSync(BASE_DIR, { recursive: true });
	}
}

export function ensureChatsDir(): void {
	ensureBaseDir();
	if (!fs.existsSync(CHATS_DIR)) {
		fs.mkdirSync(CHATS_DIR, { recursive: true });
	}
}

export function ensureSkillsDir(): void {
	ensureBaseDir();
	if (!fs.existsSync(SKILLS_DIR)) {
		fs.mkdirSync(SKILLS_DIR, { recursive: true });
	}
}

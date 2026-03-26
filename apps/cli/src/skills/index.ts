import * as fs from "node:fs";
import * as path from "node:path";

import { ensureSkillsDir, SKILLS_DIR } from "../config/paths.js";

export interface Skill {
	name: string;
	description: string;
	allowedTools?: string[];
	content: string;
	path: string;
}

interface SkillFrontmatter {
	name?: string;
	description?: string;
	"allowed-tools"?: string[];
}

function parseFrontmatter(content: string): {
	frontmatter: SkillFrontmatter;
	body: string;
} {
	const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
	if (!match) {
		return { frontmatter: {}, body: content };
	}

	const yaml = match[1];
	const body = match[2].trim();
	const frontmatter: SkillFrontmatter = {};

	for (const line of yaml.split("\n")) {
		const colonIdx = line.indexOf(":");
		if (colonIdx === -1) {
			continue;
		}

		const key = line.slice(0, colonIdx).trim();
		const value = line.slice(colonIdx + 1).trim();

		if (value.startsWith("[") && value.endsWith("]")) {
			const arr = value
				.slice(1, -1)
				.split(",")
				.map((s) => s.trim());
			if (key === "allowed-tools") {
				frontmatter["allowed-tools"] = arr;
			}
		} else {
			if (key === "name") {
				frontmatter.name = value;
			}
			if (key === "description") {
				frontmatter.description = value;
			}
		}
	}

	return { frontmatter, body };
}

export function loadSkill(skillPath: string): Skill | null {
	const skillMd = path.join(skillPath, "SKILL.md");
	if (!fs.existsSync(skillMd)) {
		return null;
	}

	try {
		const content = fs.readFileSync(skillMd, "utf8");
		const { frontmatter, body } = parseFrontmatter(content);

		const name = frontmatter.name || path.basename(skillPath);
		const description = frontmatter.description || "";

		return {
			name,
			description,
			allowedTools: frontmatter["allowed-tools"],
			content: body,
			path: skillPath,
		};
	} catch {
		return null;
	}
}

export function loadAllSkills(): Skill[] {
	ensureSkillsDir();
	const skills: Skill[] = [];

	try {
		const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory()) {
				continue;
			}
			const skill = loadSkill(path.join(SKILLS_DIR, entry.name));
			if (skill) {
				skills.push(skill);
			}
		}
	} catch {}

	return skills;
}

export function matchSkills(prompt: string, skills: Skill[]): Skill[] {
	const lower = prompt.toLowerCase();
	return skills.filter((skill) => {
		if (!skill.description) {
			return false;
		}
		const words = skill.description.toLowerCase().split(/\s+/);
		return words.some((word) => word.length > 3 && lower.includes(word));
	});
}

export function getSkillByName(name: string): Skill | null {
	const skillPath = path.join(SKILLS_DIR, name);
	if (!fs.existsSync(skillPath)) {
		return null;
	}
	return loadSkill(skillPath);
}

export function listSkills(): string[] {
	ensureSkillsDir();
	try {
		const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
		return entries.filter((e) => e.isDirectory()).map((e) => e.name);
	} catch {
		return [];
	}
}

export function removeSkill(name: string): boolean {
	const skillPath = path.join(SKILLS_DIR, name);
	if (!fs.existsSync(skillPath)) {
		return false;
	}
	try {
		fs.rmSync(skillPath, { recursive: true });
		return true;
	} catch {
		return false;
	}
}

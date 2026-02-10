import * as fs from 'node:fs';
import * as path from 'node:path';
import { SKILLS_DIR, AGENTS_SKILLS_DIR, ensureSkillsDir } from '../config/paths.js';

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
  'allowed-tools'?: string[];
}

function parseFrontmatter(content: string): { frontmatter: SkillFrontmatter; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const yaml = match[1];
  const body = match[2].trim();
  const frontmatter: SkillFrontmatter = {};

  for (const line of yaml.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();

    if (value.startsWith('[') && value.endsWith(']')) {
      const arr = value.slice(1, -1).split(',').map(s => s.trim());
      if (key === 'allowed-tools') {
        frontmatter['allowed-tools'] = arr;
      }
    } else {
      if (key === 'name') frontmatter.name = value;
      if (key === 'description') frontmatter.description = value;
    }
  }

  return { frontmatter, body };
}

export function loadSkill(skillPath: string): Skill | null {
  const skillMd = path.join(skillPath, 'SKILL.md');
  if (!fs.existsSync(skillMd)) return null;

  try {
    const content = fs.readFileSync(skillMd, 'utf-8');
    const { frontmatter, body } = parseFrontmatter(content);

    const name = frontmatter.name || path.basename(skillPath);
    const description = frontmatter.description || '';

    return {
      name,
      description,
      allowedTools: frontmatter['allowed-tools'],
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
  const loadedNames = new Set<string>();

  // Load from ~/.ai-cli/skills first (takes precedence)
  try {
    const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skill = loadSkill(path.join(SKILLS_DIR, entry.name));
      if (skill) {
        skills.push(skill);
        loadedNames.add(skill.name);
      }
    }
  } catch {}

  // Load from ~/.agents/skills (skip if already loaded)
  try {
    if (fs.existsSync(AGENTS_SKILLS_DIR)) {
      const entries = fs.readdirSync(AGENTS_SKILLS_DIR, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (loadedNames.has(entry.name)) continue; // Skip duplicates
        const skill = loadSkill(path.join(AGENTS_SKILLS_DIR, entry.name));
        if (skill) skills.push(skill);
      }
    }
  } catch {}

  return skills;
}

export function matchSkills(prompt: string, skills: Skill[]): Skill[] {
  const lower = prompt.toLowerCase();
  return skills.filter(skill => {
    if (!skill.description) return false;
    const words = skill.description.toLowerCase().split(/\s+/);
    return words.some(word => word.length > 3 && lower.includes(word));
  });
}

export function getSkillByName(name: string): Skill | null {
  // Check ~/.ai-cli/skills first
  const skillPath = path.join(SKILLS_DIR, name);
  if (fs.existsSync(skillPath)) {
    return loadSkill(skillPath);
  }
  
  // Check ~/.agents/skills
  const agentsSkillPath = path.join(AGENTS_SKILLS_DIR, name);
  if (fs.existsSync(agentsSkillPath)) {
    return loadSkill(agentsSkillPath);
  }
  
  return null;
}

export function listSkills(): string[] {
  ensureSkillsDir();
  const skillNames = new Set<string>();
  
  // List from ~/.ai-cli/skills
  try {
    const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) skillNames.add(entry.name);
    }
  } catch {}
  
  // List from ~/.agents/skills
  try {
    if (fs.existsSync(AGENTS_SKILLS_DIR)) {
      const entries = fs.readdirSync(AGENTS_SKILLS_DIR, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) skillNames.add(entry.name);
      }
    }
  } catch {}
  
  return Array.from(skillNames);
}

export function removeSkill(name: string): boolean {
  const skillPath = path.join(SKILLS_DIR, name);
  if (!fs.existsSync(skillPath)) return false;
  try {
    fs.rmSync(skillPath, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

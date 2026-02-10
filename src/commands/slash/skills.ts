import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ensureSkillsDir, SKILLS_DIR } from '../../config/paths.js';
import { getSkillByName, listSkills, removeSkill } from '../../skills/index.js';
import type { CommandHandler } from './types.js';

function parseSkillTarget(
  target: string,
): { repo: string; subpath: string; name: string } | null {
  const githubMatch = target.match(
    /github\.com\/([^/]+\/[^/]+)(?:\/tree\/[^/]+\/(.+))?/,
  );
  if (githubMatch) {
    const repo = githubMatch[1].replace(/\.git$/, '');
    const subpath = githubMatch[2] || '';
    const name = subpath ? path.basename(subpath) : repo.split('/')[1];
    return { repo, subpath, name };
  }

  const shortMatch = target.match(/^([^/]+\/[^/]+)(?:\/(.+))?$/);
  if (shortMatch && !target.startsWith('/') && !target.includes(':')) {
    const repo = shortMatch[1];
    const subpath = shortMatch[2] || '';
    const name = subpath ? path.basename(subpath) : repo.split('/')[1];
    return { repo, subpath, name };
  }

  return null;
}

async function downloadGithubFolder(
  repo: string,
  subpath: string,
  dest: string,
): Promise<void> {
  const apiUrl = `https://api.github.com/repos/${repo}/contents/${subpath}`;
  const res = await fetch(apiUrl);
  if (!res.ok) throw new Error('github api failed');
  const items = (await res.json()) as Array<{
    name: string;
    type: string;
    download_url: string;
    path: string;
  }>;

  fs.mkdirSync(dest, { recursive: true });

  for (const item of items) {
    const itemDest = path.join(dest, item.name);
    if (item.type === 'file' && item.download_url) {
      const fileRes = await fetch(item.download_url);
      const content = await fileRes.text();
      fs.writeFileSync(itemDest, content);
    } else if (item.type === 'dir') {
      await downloadGithubFolder(repo, item.path, itemDest);
    }
  }
}

export const skills: CommandHandler = async (_ctx, args) => {
  ensureSkillsDir();

  if (!args || args === 'list') {
    const names = listSkills();
    if (names.length === 0) {
      return { output: 'no skills installed\nuse: /skills add <git-url>' };
    }
    const list = names
      .map((name) => {
        const skill = getSkillByName(name);
        const desc = skill?.description ? ` - ${skill.description}` : '';
        return `  ${name}${desc}`;
      })
      .join('\n');
    return { output: `skills:\n${list}` };
  }

  const parts = args.split(' ');
  const action = parts[0];
  const target = parts.slice(1).join(' ');

  if (action === 'add' && target) {
    const parsed = parseSkillTarget(target);
    const name =
      parsed?.name || path.basename(target, '.git').replace(/^skill-/, '');
    const dest = path.join(SKILLS_DIR, name);

    if (fs.existsSync(dest)) {
      return { output: `skill "${name}" already exists` };
    }

    try {
      if (parsed?.subpath) {
        await downloadGithubFolder(parsed.repo, parsed.subpath, dest);
      } else if (parsed) {
        await downloadGithubFolder(parsed.repo, '', dest);
      } else if (target.startsWith('http')) {
        const result = spawnSync(
          'git',
          ['clone', '--depth', '1', target, dest],
          { stdio: 'pipe' },
        );
        if (result.status !== 0) {
          throw new Error(
            result.stderr?.toString().trim() || 'git clone failed',
          );
        }
        const gitDir = path.join(dest, '.git');
        if (fs.existsSync(gitDir)) fs.rmSync(gitDir, { recursive: true });
      } else if (fs.existsSync(target)) {
        fs.cpSync(target, dest, { recursive: true });
      } else {
        return { output: 'invalid path or url' };
      }

      const skill = getSkillByName(name);
      if (!skill) {
        fs.rmSync(dest, { recursive: true });
        return { output: 'no SKILL.md found' };
      }

      return { output: `added skill: ${name}` };
    } catch (err) {
      if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true });
      return {
        output: `failed: ${err instanceof Error ? err.message : 'unknown'}`,
      };
    }
  }

  if (action === 'remove' && target) {
    if (removeSkill(target)) {
      return { output: `removed: ${target}` };
    }
    return { output: `skill "${target}" not found` };
  }

  if (action === 'show' && target) {
    const skill = getSkillByName(target);
    if (!skill) {
      return { output: `skill "${target}" not found` };
    }
    return {
      output: `${skill.name}\n${skill.description}\n\n${skill.content}`,
    };
  }

  if (action === 'path') {
    return { output: SKILLS_DIR };
  }

  if (action === 'create' && target) {
    const dest = path.join(SKILLS_DIR, target);
    if (fs.existsSync(dest)) {
      return { output: `skill "${target}" already exists` };
    }
    fs.mkdirSync(dest, { recursive: true });
    const template = `---
name: ${target}
description: Describe when this skill should activate
allowed-tools: [Bash, Read, Write]
---

# ${target}

Instructions for this skill...
`;
    fs.writeFileSync(path.join(dest, 'SKILL.md'), template);
    return { output: `created: ${dest}/SKILL.md` };
  }

  return { output: 'use: /skills [list|add|remove|show|create|path] <name>' };
};

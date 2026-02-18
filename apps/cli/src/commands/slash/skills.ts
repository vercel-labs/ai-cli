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

function isNpmPackageName(target: string): boolean {
  // Scoped: @scope/name
  if (/^@[a-z0-9-]+\/[a-z0-9._-]+$/i.test(target)) return true;
  // Bare: name (no slashes, no colons, not a path, not a URL)
  if (
    /^[a-z0-9._-]+$/i.test(target) &&
    !target.startsWith('/') &&
    !target.startsWith('.')
  )
    return true;
  return false;
}

async function resolveNpmToGithub(
  pkg: string,
): Promise<{ repo: string; name: string } | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${pkg}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;

    const data = (await res.json()) as {
      repository?: { type?: string; url?: string } | string;
    };

    const repoField =
      typeof data.repository === 'string'
        ? data.repository
        : data.repository?.url || '';

    // Extract owner/repo from GitHub URL patterns:
    //   git+https://github.com/owner/repo.git
    //   https://github.com/owner/repo
    //   github:owner/repo
    //   git://github.com/owner/repo.git
    const ghMatch = repoField.match(
      /github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/,
    );
    if (ghMatch) {
      const repo = ghMatch[1];
      const name = pkg.startsWith('@') ? pkg.split('/')[1] : pkg;
      return { repo, name };
    }

    // Shorthand: "owner/repo"
    const shorthand =
      typeof data.repository === 'string'
        ? data.repository.match(/^([^/]+\/[^/]+)$/)
        : null;
    if (shorthand) {
      const name = pkg.startsWith('@') ? pkg.split('/')[1] : pkg;
      return { repo: shorthand[1], name };
    }

    return null;
  } catch {
    return null;
  }
}

async function findSkillSubpath(
  repo: string,
  name: string,
): Promise<string | null> {
  const headers: Record<string, string> = {};
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `token ${token}`;
  const opts = { headers, signal: AbortSignal.timeout(10_000) };

  // Check repo root for SKILL.md
  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/contents/SKILL.md`,
      opts,
    );
    if (res.ok) return '';
  } catch {}

  // Check skills/<name>/SKILL.md (common convention)
  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/contents/skills/${name}/SKILL.md`,
      opts,
    );
    if (res.ok) return `skills/${name}`;
  } catch {}

  // List skills/ directory and check each subdirectory
  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/contents/skills`,
      opts,
    );
    if (res.ok) {
      const items = (await res.json()) as Array<{
        name: string;
        type: string;
        path: string;
      }>;
      for (const item of items) {
        if (item.type !== 'dir') continue;
        try {
          const check = await fetch(
            `https://api.github.com/repos/${repo}/contents/${item.path}/SKILL.md`,
            opts,
          );
          if (check.ok) return item.path;
        } catch {}
      }
    }
  } catch {}

  return null;
}

async function downloadGithubFolder(
  repo: string,
  subpath: string,
  dest: string,
  recursive = true,
): Promise<void> {
  const headers: Record<string, string> = {};
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `token ${token}`;

  const apiUrl = `https://api.github.com/repos/${repo}/contents/${subpath}`;
  const res = await fetch(apiUrl, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`github api failed (${res.status})`);
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
      const fileRes = await fetch(item.download_url, {
        signal: AbortSignal.timeout(30_000),
      });
      const content = await fileRes.text();
      fs.writeFileSync(itemDest, content);
    } else if (item.type === 'dir' && recursive) {
      await downloadGithubFolder(repo, item.path, itemDest, recursive);
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
    let parsed = parseSkillTarget(target);

    // If not a GitHub target, try resolving as an npm package name
    if (!parsed && isNpmPackageName(target)) {
      const npm = await resolveNpmToGithub(target);
      if (npm) {
        parsed = { repo: npm.repo, subpath: '', name: npm.name };
      }
    }

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
        // Probe for SKILL.md location before downloading
        const detectedSubpath = await findSkillSubpath(
          parsed.repo,
          parsed.name,
        );
        if (detectedSubpath === null) {
          return { output: 'no SKILL.md found in repository' };
        } else if (detectedSubpath !== '') {
          // Found in a subdirectory - download only that directory
          await downloadGithubFolder(parsed.repo, detectedSubpath, dest);
        } else {
          // Found at repo root - download root-level files only (skip dirs like src/, test/)
          await downloadGithubFolder(parsed.repo, '', dest, false);
        }
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
      } else if (isNpmPackageName(target)) {
        return {
          output: `package "${target}" not found on npm or has no github repo`,
        };
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

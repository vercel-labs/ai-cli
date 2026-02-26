/**
 * LLM-as-judge for spec adherence.
 *
 * Reads all generated source files from a workspace directory,
 * sends them along with the original spec to a judge model via
 * the AI SDK `generateObject`, and returns a structured verdict.
 *
 * The judge evaluates whether the agent's output actually implements
 * what the spec/PRD asked for — not just whether files exist.
 */
import { expect } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gateway } from '@ai-sdk/gateway';
import { generateObject } from 'ai';
import { z } from 'zod';
import { EVAL_MODEL } from './eval-helpers';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const RequirementSchema = z.object({
  requirement: z.string().describe('What the spec asked for'),
  implemented: z.boolean().describe('Whether this requirement was implemented'),
  evidence: z
    .string()
    .describe(
      'File path and brief explanation of why it is or is not implemented',
    ),
});

const JudgeResultSchema = z.object({
  requirements: z.array(RequirementSchema),
  adherenceScore: z
    .number()
    .min(1)
    .max(10)
    .describe(
      'Overall spec adherence score from 1 (nothing implemented) to 10 (fully implemented)',
    ),
  missingRequirements: z
    .array(z.string())
    .describe('List of requirements from the spec that were NOT implemented'),
  verdict: z
    .enum(['pass', 'fail'])
    .describe(
      'pass if the implementation substantially matches the spec, fail otherwise',
    ),
  reasoning: z.string().describe('Brief explanation of the overall assessment'),
});

export type JudgeResult = z.infer<typeof JudgeResultSchema>;

// ---------------------------------------------------------------------------
// File collection
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  '.next',
  '.turbo',
  'coverage',
  '.cache',
]);

const SKIP_FILES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'bun.lock',
]);

const INCLUDE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.json',
  '.css',
  '.html',
]);

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);

const MAX_TOTAL_CHARS = 150_000;

interface CollectedFile {
  path: string;
  content: string;
}

function collectFiles(dir: string, base?: string): CollectedFile[] {
  const root = base ?? dir;
  const files: CollectedFile[] = [];

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return files;
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    if (SKIP_FILES.has(entry)) continue;
    const full = join(dir, entry);

    let stat: ReturnType<typeof statSync> | undefined;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      files.push(...collectFiles(full, root));
    } else if (stat.isFile()) {
      const ext = entry.slice(entry.lastIndexOf('.'));
      if (!INCLUDE_EXTENSIONS.has(ext)) continue;
      try {
        const content = readFileSync(full, 'utf-8');
        files.push({ path: relative(root, full), content });
      } catch {
        // skip unreadable files
      }
    }
  }

  return files;
}

function buildFileContext(workDir: string): string {
  const files = collectFiles(workDir);

  files.sort((a, b) => {
    const aExt = a.path.slice(a.path.lastIndexOf('.'));
    const bExt = b.path.slice(b.path.lastIndexOf('.'));
    const aSource = SOURCE_EXTENSIONS.has(aExt) ? 0 : 1;
    const bSource = SOURCE_EXTENSIONS.has(bExt) ? 0 : 1;
    if (aSource !== bSource) return aSource - bSource;
    return a.path.localeCompare(b.path);
  });

  let totalChars = 0;
  const parts: string[] = [];

  for (const file of files) {
    const entry = `--- ${file.path} ---\n${file.content}\n`;
    if (totalChars + entry.length > MAX_TOTAL_CHARS) {
      parts.push(
        `\n[... truncated — ${files.length - parts.length} more files not shown ...]\n`,
      );
      break;
    }
    parts.push(entry);
    totalChars += entry.length;
  }

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Judge
// ---------------------------------------------------------------------------

export interface JudgeOptions {
  /** Model to use for judging (default: EVAL_MODEL) */
  judgeModel?: string;
  /** Minimum adherence score to pass (default: 7) */
  minScore?: number;
}

export async function judgeSpecAdherence(
  spec: string,
  workDir: string,
  opts: JudgeOptions = {},
): Promise<JudgeResult> {
  const { judgeModel = EVAL_MODEL } = opts;

  const fileContext = buildFileContext(workDir);

  const prompt = `You are a strict technical reviewer. Your job is to evaluate whether a codebase implements a given specification.

## Specification

${spec}

## Generated Source Code

${fileContext}

## Instructions

1. Extract every distinct requirement from the specification above.
2. For each requirement, check whether the generated source code implements it.
3. Provide evidence (file path + brief reason) for each requirement.
4. Give an overall adherence score from 1-10.
5. List any requirements that are missing.
6. Return a verdict: "pass" if the implementation substantially covers the spec (score >= 7), "fail" otherwise.

Be strict: trivial stubs, empty test files, or placeholder implementations should be marked as NOT implemented.`;

  const model = gateway(judgeModel);

  const result = await generateObject({
    model,
    schema: JudgeResultSchema,
    prompt,
  });

  return result.object;
}

// ---------------------------------------------------------------------------
// Assertion helper
// ---------------------------------------------------------------------------

export async function assertSpecAdherence(
  spec: string,
  workDir: string,
  opts: JudgeOptions = {},
): Promise<JudgeResult> {
  const { minScore = 7 } = opts;

  console.log('\n--- judge: spec adherence ---');
  console.log('  calling judge model...');

  const result = await judgeSpecAdherence(spec, workDir, opts);

  console.log(`  adherence score: ${result.adherenceScore}/10`);
  console.log(`  verdict: ${result.verdict}`);
  console.log(`  requirements checked: ${result.requirements.length}`);

  const implemented = result.requirements.filter((r) => r.implemented).length;
  const notImplemented = result.requirements.filter(
    (r) => !r.implemented,
  ).length;
  console.log(
    `  implemented: ${implemented}, not implemented: ${notImplemented}`,
  );

  if (result.missingRequirements.length > 0) {
    console.log(`  missing:`);
    for (const m of result.missingRequirements) {
      console.log(`    - ${m}`);
    }
  }

  console.log(`  reasoning: ${result.reasoning}`);
  console.log('--- end judge ---\n');

  expect(result.adherenceScore).toBeGreaterThanOrEqual(minScore);
  expect(result.verdict).toBe('pass');

  return result;
}

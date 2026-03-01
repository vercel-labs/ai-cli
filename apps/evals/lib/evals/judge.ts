import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gateway } from '@ai-sdk/gateway';
import { generateObject } from 'ai';
import { z } from 'zod';

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

const ComparisonRankingSchema = z.object({
  model: z.string().describe('The model identifier'),
  rank: z.number().int().min(1).describe('Rank position (1 = best)'),
  score: z
    .number()
    .min(1)
    .max(10)
    .describe('Quality score from 1-10 for this model on this task'),
  reasoning: z.string().describe('Why this model received this ranking'),
});

const ComparisonResultSchema = z.object({
  rankings: z.array(ComparisonRankingSchema),
  winnerModel: z.string().describe('The model that performed best overall'),
  reasoning: z
    .string()
    .describe('Overall comparison explanation — why the winner was chosen'),
});

export type ComparisonResult = z.infer<typeof ComparisonResultSchema>;

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

export interface JudgeOptions {
  judgeModel?: string;
  minScore?: number;
  agentOutput?: string;
  agentLogs?: string;
}

export async function judgeSpecAdherence(
  spec: string,
  workDir: string,
  opts: JudgeOptions = {},
): Promise<JudgeResult> {
  const { judgeModel = 'anthropic/claude-opus-4.6' } = opts;

  const fileContext = buildFileContext(workDir);

  const outputSection = opts.agentOutput
    ? `\n## Agent Output\n\n${opts.agentOutput}\n`
    : '';

  const logsSection = opts.agentLogs
    ? `\n## Agent Logs\n\n${opts.agentLogs.slice(-20000)}\n`
    : '';

  const prompt = `You are a strict technical reviewer. Your job is to evaluate whether an AI agent successfully completed a given task.

## Task / Specification

${spec}

## Generated Source Code

${fileContext || '(no files were created)'}
${outputSection}${logsSection}
## Instructions

1. Extract every distinct requirement from the task/specification above.
2. For each requirement, check whether the source code, agent output, or logs demonstrate it was fulfilled.
3. Provide evidence (file path, output excerpt, or brief reason) for each requirement.
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

export interface ComparisonEntry {
  model: string;
  output: string | null;
  judgeScore: number | null;
  judgeVerdict: string | null;
}

export async function judgeComparison(
  spec: string,
  entries: ComparisonEntry[],
  judgeModel = 'anthropic/claude-opus-4.6',
): Promise<ComparisonResult> {
  const modelsSection = entries
    .map((e, i) => {
      const score =
        e.judgeScore != null ? `${e.judgeScore}/10 (${e.judgeVerdict})` : 'N/A';
      return `### Model ${i + 1}: ${e.model}\n\nIndividual judge score: ${score}\n\n#### Output\n\n${e.output || '(no output)'}\n`;
    })
    .join('\n---\n\n');

  const prompt = `You are a strict technical reviewer comparing how multiple AI models performed on the same task. Your job is to rank them from best to worst and pick a winner.

## Task / Specification

${spec}

## Model Results

${modelsSection}

## Instructions

1. Review each model's output against the task specification.
2. Compare the quality, correctness, completeness, and elegance of each model's result.
3. Rank all models from best (rank 1) to worst.
4. Give each model a score from 1-10.
5. Explain why the winner was chosen and how the models differ.

Be fair and objective. Focus on the quality of the actual output, not just whether it ran without errors.`;

  const model = gateway(judgeModel);

  const result = await generateObject({
    model,
    schema: ComparisonResultSchema,
    prompt,
  });

  return result.object;
}

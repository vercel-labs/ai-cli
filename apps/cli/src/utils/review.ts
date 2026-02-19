import * as fs from 'node:fs';
import * as path from 'node:path';
import { type ModelMessage, streamText } from 'ai';
import { editFile } from '../tools/edit-file.js';
import { readFile } from '../tools/read-file.js';
import { runCommand } from '../tools/run-command.js';
import { searchInFiles } from '../tools/search-in-files.js';
import { writeFile } from '../tools/write-file.js';
import type { StreamCallbacks } from '../hooks/chat.js';
import { AI_CLI_HEADERS } from './constants.js';
import { log as debug } from './debug.js';
import { smartStop } from './stop-condition.js';

const REVIEW_COMPLETE_MARKER = 'REVIEW_COMPLETE';

function buildReviewSystemPrompt(pm: { pm: string; run: string }): string {
  const cwd = process.cwd();
  return `You are a strict code reviewer. You are reviewing changes made by another AI coding agent.

You must find and fix ONLY severe and high-priority issues.

REVIEW (fix immediately with editFile):
- Bugs, logic errors, off-by-one errors
- Security vulnerabilities (injection, auth bypass, secrets in code)
- Missing error handling that causes crashes or silent data loss
- Type errors, unsafe casts, unchecked nulls
- Race conditions or data corruption
- Breaking changes to public APIs
- Incorrect implementations that don't match the stated goal

IGNORE (do not flag or fix):
- Style, formatting, naming preferences
- Comment quality or missing docs
- Code organization or file structure
- Performance (unless it causes a hang or OOM)
- "Nice to have" improvements

Rules:
- For each issue: state the file and problem in one line, then fix it immediately with editFile
- Be terse. No preamble, no summaries unless you found issues.
- When no severe/high issues remain, output exactly: ${REVIEW_COMPLETE_MARKER}
- If you find nothing wrong on first read, output ${REVIEW_COMPLETE_MARKER} immediately
- Do NOT re-implement or rewrite working code
- Do NOT add features or improvements beyond fixing bugs
- NEVER use markdown formatting

Environment:
- Directory: ${cwd}
- Package manager: ${pm.pm} (use "${pm.run}" to run scripts)`;
}

function buildDiffContext(
  originalTask: string,
  changedFiles: { path: string; original: string | null; current: string }[],
): string {
  const sections: string[] = [];
  sections.push(`Original task: ${originalTask}`);
  sections.push('');
  sections.push(`Files changed (${changedFiles.length}):`);

  for (const file of changedFiles) {
    const rel = path.relative(process.cwd(), file.path);
    if (file.original === null) {
      sections.push(`\n--- NEW FILE: ${rel} ---`);
      sections.push(file.current);
    } else {
      sections.push(`\n--- MODIFIED: ${rel} ---`);
      sections.push(`BEFORE:\n${file.original}`);
      sections.push(`AFTER:\n${file.current}`);
    }
  }

  sections.push(
    '\nReview these changes for severe/high-priority issues. Fix any you find with editFile. Output REVIEW_COMPLETE when done.',
  );
  return sections.join('\n');
}

export interface ReviewOptions {
  model: string;
  originalTask: string;
  changedFiles: { path: string; original: string | null }[];
  maxIterations: number;
  callbacks: StreamCallbacks;
  abortSignal?: AbortSignal;
  pm: { pm: string; run: string };
}

export interface ReviewResult {
  iterations: number;
  issuesFound: number;
  issuesFixed: number;
}

function isAnthropicModel(model: string): boolean {
  return model.startsWith('anthropic/');
}

const ANTHROPIC_CACHE_CONTROL = {
  anthropic: { cacheControl: { type: 'ephemeral' as const } },
};

export async function reviewLoop(
  options: ReviewOptions,
): Promise<ReviewResult> {
  const {
    model,
    originalTask,
    changedFiles: changedFileRefs,
    maxIterations,
    callbacks,
    abortSignal,
    pm,
  } = options;

  const result: ReviewResult = {
    iterations: 0,
    issuesFound: 0,
    issuesFixed: 0,
  };

  const filesWithContent = changedFileRefs.map((f) => {
    let current = '';
    try {
      current = fs.readFileSync(f.path, 'utf-8');
    } catch {
      current = '(file not found or unreadable)';
    }
    return { ...f, current };
  });

  if (filesWithContent.length === 0) return result;

  const sys = buildReviewSystemPrompt(pm);
  const systemParam = isAnthropicModel(model)
    ? {
        role: 'system' as const,
        content: sys,
        providerOptions: ANTHROPIC_CACHE_CONTROL,
      }
    : sys;

  const reviewTools = {
    readFile,
    editFile,
    writeFile,
    searchInFiles,
    runCommand,
  };

  for (let i = 0; i < maxIterations; i++) {
    if (abortSignal?.aborted) break;

    result.iterations = i + 1;
    debug(`review: iteration ${i + 1}/${maxIterations}`);

    const freshContent = changedFileRefs.map((f) => {
      let current = '';
      try {
        current = fs.readFileSync(f.path, 'utf-8');
      } catch {
        current = '(file not found or unreadable)';
      }
      return { ...f, current };
    });

    const userMessage =
      i === 0
        ? buildDiffContext(originalTask, freshContent)
        : `Previous review pass made fixes. Review the current state of changed files again for any remaining severe/high-priority issues.\n\n${buildDiffContext(originalTask, freshContent)}`;

    const history: ModelMessage[] = [{ role: 'user', content: userMessage }];

    callbacks.onStatus('reviewing...');

    let buffer = '';
    let madeEdits = false;
    let streamError: Error | null = null;

    const stream = streamText({
      model,
      system: systemParam,
      messages: history,
      tools: reviewTools,
      stopWhen: smartStop(),
      headers: AI_CLI_HEADERS,
      abortSignal,
      onError: () => {},
    });

    try {
      for await (const part of stream.fullStream) {
        const partType = part.type as string;

        switch (partType) {
          case 'error': {
            const errorPart = part as { error?: Error };
            streamError = errorPart.error ?? new Error('unknown review error');
            break;
          }

          case 'tool-call': {
            const tc = part as { toolName: string };
            if (tc.toolName === 'editFile' || tc.toolName === 'writeFile') {
              madeEdits = true;
            }
            const label =
              tc.toolName === 'editFile'
                ? 'review: editing...'
                : `review: ${tc.toolName}`;
            callbacks.onStatus(label);
            break;
          }

          case 'tool-result': {
            const tr = part as {
              toolName?: string;
              output?: { message?: string; error?: string };
            };
            if (
              tr.output?.message &&
              !tr.output.message.startsWith('User denied')
            ) {
              result.issuesFixed++;
            }
            callbacks.onStatus('reviewing...');
            break;
          }

          case 'text-delta': {
            const td = part as { text: string };
            buffer += td.text;
            break;
          }
        }

        if (streamError) break;
      }
    } catch (e) {
      streamError = e instanceof Error ? e : new Error(String(e));
    }

    callbacks.onStatus('');

    if (streamError) {
      debug(`review: error in iteration ${i + 1}: ${streamError.message}`);
      break;
    }

    if (madeEdits) {
      result.issuesFound += result.issuesFixed;
    }

    if (buffer.includes(REVIEW_COMPLETE_MARKER)) {
      debug(`review: complete after ${i + 1} iteration(s)`);
      break;
    }

    if (!madeEdits) {
      debug('review: no edits made, stopping');
      break;
    }
  }

  return result;
}

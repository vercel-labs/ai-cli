import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { type ModelMessage, streamText } from 'ai';
import { SKILLS_DIR } from '../config/paths.js';
import { editFile } from '../tools/edit-file.js';
import { readFile } from '../tools/read-file.js';
import { runCommand } from '../tools/run-command.js';
import { searchInFiles } from '../tools/search-in-files.js';
import { writeFile } from '../tools/write-file.js';
import type { StreamCallbacks } from '../hooks/chat.js';
import { AI_CLI_HEADERS } from './constants.js';
import { log as debug } from './debug.js';
import { extractJsonStringValue } from './json-parse.js';
import { toolActions } from './prompt.js';
import { smartStop } from './stop-condition.js';

const REVIEW_COMPLETE_MARKER = 'REVIEW_COMPLETE';

function stripFrontmatter(content: string): string {
  const match = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  return match ? match[1].trim() : content;
}

function loadAgentBrowserSkill(): string | null {
  const localPath = path.join(SKILLS_DIR, 'agent-browser', 'SKILL.md');
  try {
    return stripFrontmatter(fs.readFileSync(localPath, 'utf-8'));
  } catch {}

  try {
    const globalRoot = execSync('npm root -g', { encoding: 'utf-8' }).trim();
    const globalPath = path.join(
      globalRoot,
      'agent-browser',
      'skills',
      'agent-browser',
      'SKILL.md',
    );
    return stripFrontmatter(fs.readFileSync(globalPath, 'utf-8'));
  } catch {}

  return null;
}

function buildReviewSystemPrompt(pm: { pm: string; run: string }): string {
  const cwd = process.cwd();
  let prompt = `You are a strict code reviewer. You are reviewing changes made by another AI coding agent.

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

  const browserSkill = loadAgentBrowserSkill();
  if (browserSkill) {
    prompt += `\n\nBrowser verification is available via runCommand using the agent-browser CLI. Use it to verify UI changes when relevant.\n\n<skill name="agent-browser">\n${browserSkill}\n</skill>`;
  }

  return prompt;
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

    let buffer = '';
    let silent = false;
    let madeEdits = false;
    let streamError: Error | null = null;
    let currentToolLabel = '';
    let reasoning = '';
    let reasoningStart = 0;
    let editStreamActive = false;
    let editStreamArgs = '';
    let editStreamLastCount = 0;

    const flushReasoning = () => {
      if (reasoning && reasoningStart) {
        callbacks.onReasoning(reasoning, Date.now() - reasoningStart);
        reasoning = '';
        reasoningStart = 0;
      }
    };

    callbacks.onStatus('thinking...');

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

        if (partType === 'start-step') {
          if (buffer) {
            callbacks.onRecord('assistant', buffer);
            callbacks.onPending('');
            buffer = '';
          }
          silent = false;
        }

        if (
          silent &&
          partType !== 'tool-call' &&
          partType !== 'tool-result' &&
          partType !== 'tool-error' &&
          partType !== 'tool-input-start' &&
          partType !== 'tool-input-delta' &&
          partType !== 'step-finish'
        ) {
          continue;
        }

        switch (partType) {
          case 'error': {
            const errorPart = part as { error?: Error };
            streamError = errorPart.error ?? new Error('unknown review error');
            break;
          }

          case 'tool-error': {
            debug(`review tool error: ${JSON.stringify(part)}`);
            editStreamActive = false;
            callbacks.onStatus('thinking...');
            break;
          }

          case 'reasoning-delta': {
            const rp = part as { text?: string };
            if (rp.text) {
              if (!reasoningStart) reasoningStart = Date.now();
              reasoning += rp.text;
              callbacks.onStatus(
                reasoning.replace(/\s+/g, ' ').trim().slice(-80),
              );
            }
            break;
          }

          case 'tool-input-start': {
            const tcs = part as Record<string, unknown>;
            if (
              typeof tcs.toolName === 'string' &&
              tcs.toolName === 'editFile' &&
              callbacks.onEditStream
            ) {
              flushReasoning();
              editStreamActive = true;
              editStreamArgs = '';
              editStreamLastCount = 0;
              callbacks.onStatus('Editing...');
            } else {
              editStreamActive = false;
              if (
                typeof tcs.toolName === 'string' &&
                tcs.toolName === 'writeFile'
              ) {
                flushReasoning();
                callbacks.onStatus('Writing...');
              }
            }
            break;
          }

          case 'tool-input-delta': {
            if (editStreamActive && callbacks.onEditStream) {
              const tcd = part as Record<string, unknown>;
              const delta = typeof tcd.delta === 'string' ? tcd.delta : '';
              editStreamArgs += delta;

              const fp = extractJsonStringValue(editStreamArgs, 'filePath');
              if (fp) {
                const old = extractJsonStringValue(editStreamArgs, 'oldText');
                const new_ = extractJsonStringValue(editStreamArgs, 'newText');

                const oldLines = old ? old.value.split('\n').slice(0, 5) : [];
                const newLines = new_ ? new_.value.split('\n').slice(0, 5) : [];
                const totalCount = oldLines.length + newLines.length;

                if (totalCount > editStreamLastCount) {
                  editStreamLastCount = totalCount;
                  const totalOld = old ? old.value.split('\n').length : 0;
                  const totalNew = new_ ? new_.value.split('\n').length : 0;
                  const more = Math.max(totalOld, totalNew) - 5;

                  callbacks.onEditStream(
                    fp.value,
                    oldLines,
                    newLines,
                    more > 0 ? more : 0,
                  );
                }
              }
            }
            break;
          }

          case 'tool-call': {
            flushReasoning();
            const tc = part as {
              toolName: string;
              input?: {
                query?: string;
                command?: string;
                directory?: string;
                dirPath?: string;
                filePath?: string;
              };
            };
            debug(`review tool-call: ${tc.toolName}`);
            const input = tc.input;
            let status: string;
            const wasEditStreamed =
              editStreamActive && tc.toolName === 'editFile';
            if (wasEditStreamed) editStreamActive = false;

            if (tc.toolName === 'editFile' || tc.toolName === 'writeFile') {
              madeEdits = true;
            }

            if (tc.toolName === 'readFile') {
              const f = input?.filePath || 'file';
              status = `Reading ${f}`;
              currentToolLabel = `Read ${f}`;
            } else if (tc.toolName === 'runCommand' && input?.command) {
              status = `Running ${input.command.slice(0, 70)}`;
              currentToolLabel = '';
            } else if (tc.toolName === 'writeFile') {
              const f = input?.filePath || 'file';
              status = `Writing ${f}`;
              currentToolLabel = '';
            } else if (tc.toolName === 'editFile') {
              const f = input?.filePath || 'file';
              status = `Editing ${f}`;
              currentToolLabel = '';
            } else if (tc.toolName === 'searchInFiles') {
              const q = input?.query
                ? String(input.query).slice(0, 60)
                : 'code';
              const d = input?.directory || '';
              const label = d ? `"${q}" in ${d}` : `"${q}"`;
              status = `Searching: ${label}`;
              currentToolLabel = `Searched: ${label}`;
            } else {
              status = toolActions[tc.toolName] ?? 'Working';
              currentToolLabel = '';
            }
            if (!wasEditStreamed) {
              callbacks.onStatus(status);
            }
            break;
          }

          case 'tool-result': {
            const tr = part as {
              toolName?: string;
              output?: {
                tree?: string;
                output?: string;
                answer?: string;
                message?: string;
                error?: string;
                silent?: boolean;
              };
            };
            debug(`review tool-result: ${tr.toolName}`);
            const out = tr.output;

            if (out?.message && !out.message.startsWith('User denied')) {
              result.issuesFixed++;
            }

            if (out?.tree && typeof out.tree === 'string') {
              const treeLines = out.tree.split('\n');
              const dirName = treeLines[0] || '.';
              const treeBody = treeLines.slice(1).join('\n');
              const label = currentToolLabel || `Listed ${dirName}`;
              callbacks.onMessage('tool', `> ${label}\n${treeBody}`);
              silent = true;
            } else if (out?.output && typeof out.output === 'string') {
              if (!out.output.startsWith('$ ') && currentToolLabel) {
                callbacks.onMessage(
                  'tool',
                  `> ${currentToolLabel}\n${out.output}`,
                );
              } else {
                callbacks.onMessage('tool', out.output);
              }
              silent = true;
            } else if (out?.answer && typeof out.answer === 'string') {
              const label = currentToolLabel || 'Result';
              callbacks.onMessage('tool', `> ${label}\n${out.answer}`);
              silent = true;
            } else if (out?.message && typeof out.message === 'string') {
              callbacks.onMessage('info', out.message);
              silent = out.silent === true;
            } else if (out?.error && typeof out.error === 'string') {
              callbacks.onMessage('error', out.error);
              silent = false;
            } else if (out?.silent === true) {
              silent = true;
            }

            if (silent) {
              callbacks.onStatus('');
            }
            break;
          }

          case 'text-delta': {
            flushReasoning();
            const td = part as { text: string };
            callbacks.onStatus('');
            buffer += td.text;
            if (!buffer.includes(REVIEW_COMPLETE_MARKER)) {
              callbacks.onPending(buffer);
            }
            break;
          }

          case 'step-finish': {
            flushReasoning();
            const sf = part as { finishReason?: string };
            debug(`review step-finish: ${sf.finishReason}`);
            break;
          }
        }

        if (streamError) break;
      }
    } catch (e) {
      streamError = e instanceof Error ? e : new Error(String(e));
    }

    flushReasoning();
    callbacks.onStatus('');

    if (streamError) {
      debug(`review: error in iteration ${i + 1}: ${streamError.message}`);
      break;
    }

    const displayBuffer = buffer.replace(REVIEW_COMPLETE_MARKER, '').trim();
    if (displayBuffer) {
      if (silent) {
        callbacks.onRecord('assistant', displayBuffer);
      } else {
        callbacks.onMessage('assistant', displayBuffer);
      }
    }
    callbacks.onPending('');

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

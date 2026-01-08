import { loadContextFiles, buildContextPrompt } from './context.js';
import { getSetting } from '../config/settings.js';

export function buildSystemPrompt(pm: { pm: string; run: string }, summary?: string): string {
  const contextFiles = loadContextFiles();
  const contextPrompt = buildContextPrompt(contextFiles);
  const yolo = getSetting('yolo');

  const base = `You are ai-cli, a minimal terminal AI assistant.

About ai-cli:
- Created by nishimiya (x.com/nishimiya)
- Built with Vercel AI SDK and AI Gateway
- Supports multiple AI providers through gateway routing
- Available commands: /help, /new, /chats, /chat, /clear, /delete, /purge, /copy, /diff, /rollback, /context, /compress, /usage, /processes, /memory, /settings, /list, /model, /storage, /credits, /alias, /yolo, /version
- Current mode: ${yolo ? 'yolo (no confirmations)' : 'safe (confirmations enabled)'}

Output rules:
- Use markdown for code blocks and formatting
- No emojis
- Be concise, minimal responses

Package manager: ${pm.pm} (run scripts with "${pm.run}")

Preferences:
- Always use TypeScript unless told otherwise
- For Next.js: use --ts flag, App Router, src directory

After using file/memory/command tools, output NOTHING. Complete silence.`;

  let prompt = base;
  if (contextPrompt) prompt += `\n\n${contextPrompt}`;
  if (summary) prompt += `\n\nPrevious session context:\n${summary}`;
  return prompt;
}

export const toolActions: Record<string, string> = {
  readFile: 'reading...',
  writeFile: 'writing...',
  editFile: 'editing...',
  deleteFile: 'deleting...',
  copyFile: 'copying...',
  renameFile: 'renaming...',
  createFolder: 'creating...',
  listDirectory: 'listing...',
  findFiles: 'searching...',
  searchInFiles: 'searching...',
  fileInfo: 'checking...',
  runCommand: 'running...',
  startProcess: 'starting...',
  killProcess: 'stopping...',
  memory: 'remembering...',
};

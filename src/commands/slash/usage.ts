import { getContextWindow, loadContextFiles } from '../../utils/context.js';
import type { CommandHandler } from './types.js';

function formatCost(cost: number): string {
  if (cost === 0) return '$0.0000';
  if (cost > 0 && cost < 0.0001) return '<$0.0001';
  return `$${cost.toFixed(4)}`;
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export const usage: CommandHandler = async (ctx) => {
  const lines: string[] = [];

  if (ctx.chat) {
    const userMsgs = ctx.chat.messages.filter((m) => m.role === 'user').length;
    const aiMsgs = ctx.chat.messages.filter(
      (m) => m.role === 'assistant',
    ).length;
    lines.push(`chat: ${ctx.chat.title}`);
    lines.push(`messages: ${userMsgs} user / ${aiMsgs} assistant`);
  }

  try {
    const contextWindow = await getContextWindow(ctx.model);
    const pct = Math.round((ctx.tokens / contextWindow) * 100);
    const bar =
      '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
    lines.push(
      `context: ${ctx.tokens.toLocaleString()} / ${contextWindow.toLocaleString()} [${bar}] ${pct}%`,
    );
  } catch {
    lines.push(`tokens: ~${ctx.tokens.toLocaleString()}`);
  }

  const u = ctx.tokenUsage;
  if (u.inputTokens > 0 || u.outputTokens > 0) {
    lines.push('');
    lines.push(`input:     ${formatTokenCount(u.inputTokens)}`);
    lines.push(`output:    ${formatTokenCount(u.outputTokens)}`);
    if (u.cacheReadTokens > 0) {
      lines.push(`cached:    ${formatTokenCount(u.cacheReadTokens)}`);
    }
    if (u.cacheWriteTokens > 0) {
      lines.push(`cache write: ${formatTokenCount(u.cacheWriteTokens)}`);
    }
    if (u.reasoningTokens > 0) {
      lines.push(`reasoning: ${formatTokenCount(u.reasoningTokens)}`);
    }
  }

  lines.push(`cost: ${formatCost(ctx.cost)}`);

  const files = loadContextFiles();
  if (files.length > 0) {
    lines.push('');
    lines.push('rules:');
    for (const f of files) {
      lines.push(`  ${f.path}`);
    }
  }

  return { output: lines.join('\n') };
};

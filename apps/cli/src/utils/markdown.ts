import { bold, cyan, dim, isColorEnabled, magenta, yellow } from './color.js';

const keywords = [
  'const',
  'let',
  'var',
  'function',
  'return',
  'if',
  'else',
  'for',
  'while',
  'class',
  'interface',
  'type',
  'import',
  'export',
  'from',
  'default',
  'async',
  'await',
  'new',
  'this',
  'try',
  'catch',
  'throw',
  'finally',
  'switch',
  'case',
  'break',
  'continue',
  'typeof',
  'instanceof',
  'in',
  'of',
  'true',
  'false',
  'null',
  'undefined',
  'void',
  'static',
  'public',
  'private',
  'protected',
  'readonly',
  'extends',
  'implements',
  'super',
  'yield',
  'delete',
  'debugger',
  'enum',
];

function highlightCode(code: string): string {
  if (!isColorEnabled()) return code;

  let result = code;

  result = result.replace(/(\/\/[^\n]*)/g, (_, m) => dim(m));
  result = result.replace(/(\/\*[\s\S]*?\*\/)/g, (_, m) => dim(m));
  result = result.replace(/("[^"]*"|'[^']*'|`[^`]*`)/g, (_, m) => yellow(m));
  result = result.replace(/\b(\d+\.?\d*)\b/g, (_, m) => magenta(m));

  const keywordPattern = new RegExp(`\\b(${keywords.join('|')})\\b`, 'g');
  result = result.replace(keywordPattern, (_, m) => cyan(m));

  return result;
}

export function renderMarkdown(text: string): string {
  if (!isColorEnabled()) return text;

  let result = text;

  result = result.replace(/```[\w]*\n?([\s\S]*?)```/g, (_, code) => {
    const highlighted = highlightCode(code.trim());
    const lines = highlighted.split('\n');
    return lines.map((line: string) => `    ${line}`).join('\n');
  });

  result = result.replace(/`([^`]+)`/g, (_, m) => cyan(m));
  result = result.replace(/\*\*([^*]+)\*\*/g, (_, m) => bold(m));
  result = result.replace(/^#{1,6}\s+(.+)$/gm, (_, m) => bold(m));

  return result;
}

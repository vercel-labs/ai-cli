const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
};

const keywords = [
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while',
  'class', 'interface', 'type', 'import', 'export', 'from', 'default', 'async',
  'await', 'new', 'this', 'try', 'catch', 'throw', 'finally', 'switch', 'case',
  'break', 'continue', 'typeof', 'instanceof', 'in', 'of', 'true', 'false', 'null',
  'undefined', 'void', 'static', 'public', 'private', 'protected', 'readonly',
  'extends', 'implements', 'super', 'yield', 'delete', 'debugger', 'enum',
];

function highlightCode(code: string): string {
  let result = code;

  result = result.replace(/(\/\/[^\n]*)/g, `${colors.dim}$1${colors.reset}`);
  result = result.replace(/(\/\*[\s\S]*?\*\/)/g, `${colors.dim}$1${colors.reset}`);

  result = result.replace(/("[^"]*"|'[^']*'|`[^`]*`)/g, `${colors.yellow}$1${colors.reset}`);

  result = result.replace(/\b(\d+\.?\d*)\b/g, `${colors.magenta}$1${colors.reset}`);

  const keywordPattern = new RegExp(`\\b(${keywords.join('|')})\\b`, 'g');
  result = result.replace(keywordPattern, `${colors.cyan}$1${colors.reset}`);

  return result;
}

export function renderMarkdown(text: string): string {
  let result = text;

  result = result.replace(/```[\w]*\n?([\s\S]*?)```/g, (_, code) => {
    const highlighted = highlightCode(code.trim());
    const lines = highlighted.split('\n');
    return lines.map((line: string) => `    ${line}`).join('\n');
  });

  result = result.replace(/`([^`]+)`/g, `${colors.cyan}$1${colors.reset}`);

  result = result.replace(/\*\*([^*]+)\*\*/g, `${colors.bold}$1${colors.reset}`);

  result = result.replace(/^#{1,6}\s+(.+)$/gm, `${colors.bold}$1${colors.reset}`);

  return result;
}

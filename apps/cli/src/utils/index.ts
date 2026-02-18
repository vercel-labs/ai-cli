import { DEFAULT_MODEL } from './constants.js';

export async function readStdin(): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk.toString());
  }
  return chunks.join('').trim();
}

export function showHelp(version: string): void {
  console.log(`ai - AI-powered chat interface

Usage:
  ai [options] <message>
  ai init
  ai -m <model> <message>

Options:
  -m, --model    Specify AI model (default: ${DEFAULT_MODEL})
  --image        Attach an image file (png, jpg, gif, webp)
  -r, --resume   Resume a previous chat by ID
  --plan         Start in plan mode (think before acting)
  -l, --list     List available models
  --no-color     Disable color output
  -v, --version  Show version
  -h, --help     Show this help message

Commands:
  init           Setup AI CLI with API key

Examples:
  ai "whats up bro"
  ai -m claude-opus-4.5 "hello"
  ai --image ./screenshot.png "what is this?"
  ai -l`);
}

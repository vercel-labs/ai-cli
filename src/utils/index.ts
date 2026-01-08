export async function readStdin(): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk.toString());
  }
  return chunks.join('').trim();
}

export function showHelp(): void {
  console.log(`ai - AI-powered chat interface

Usage:
  ai [options] <message>
  ai init
  ai -m <model> <message>

Options:
  -m, --model   Specify AI model (default: anthropic/claude-sonnet-4.5)
  --image       Attach an image file (png, jpg, gif, webp)
  -l, --list    List available models
  -h, --help    Show this help message

Commands:
  init          Setup AI CLI with API key

Examples:
  ai "whats up bro"
  ai -m claude-opus-4.5 "hello"
  ai --image ./screenshot.png "what is this?"
  ai -l`);
}

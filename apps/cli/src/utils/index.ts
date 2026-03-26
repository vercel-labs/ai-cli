import { DEFAULT_MODEL } from "./constants.js";

export async function readStdin(): Promise<string> {
	const chunks: string[] = [];
	for await (const chunk of process.stdin) {
		chunks.push(chunk.toString());
	}
	return chunks.join("").trim();
}

export function showHelp(_version: string): void {
	console.log(`ai - AI-powered chat interface

Usage:
  ai [options] <message>
  ai init
  ai -m <model> <message>
  ai -p <message>

Options:
  -m, --model    Specify AI model (default: ${DEFAULT_MODEL})
  --image        Attach an image file (png, jpg, gif, webp)
  -r, --resume   Resume a previous chat by ID
  --plan         Start in plan mode (think before acting)
  -p, --print    Headless mode: full agent, output to stdout, then exit
  --json         Structured JSON output (implies --print)
  --system       Append custom text to the system prompt
  --fast         Enable fast mode (Anthropic speed=fast)
  --force        Auto-approve all tool actions (--print only)
  --no-save      Don't persist the chat to history (--print only)
  --timeout <s>  Abort after N seconds (--print only)
  -q, --quiet    Suppress stderr status output (--print only)
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
  ai -p "explain this codebase"
  ai -p --json --force "fix all type errors" > result.json
  git diff | ai -p "review this for bugs"
  ai -p --timeout 60 "fix type errors"
  ai -p -r <chatId> "continue"
  ai --system "respond in Spanish" "hola"
  ai -l`);
}

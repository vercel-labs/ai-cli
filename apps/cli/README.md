# ai-cli

Minimal terminal AI assistant.

## Install

```bash
npm install -g ai-cli
```

## Setup

```bash
ai init
```

Get your API key from [Vercel AI Gateway](https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%2Fapi-keys&title=Go+to+AI+Gateway)

## Usage

```bash
ai                           # interactive mode
ai "hello"                   # single message
ai -m gpt-5 "hello"          # use specific model
ai --image ./img.png "what?" # analyze image (single message)
ai -l                        # list models
echo "explain this" | ai     # pipe input
ai --system "respond in Spanish" "hola"  # custom system prompt

# in interactive mode, ctrl+v to paste image from clipboard
```

## Headless Mode

Run the full agent non-interactively. Useful for CI pipelines, scripts, and automation.

```bash
ai -p "explain this codebase"                          # output to stdout
ai -p --json "write tests for src/auth.ts" > result.json  # structured JSON
ai -p --force "fix all type errors"                    # skip confirmations
ai -p --no-save "what dependencies are outdated?"      # ephemeral (no history)
git diff | ai -p "review this for bugs"                # pipe + headless
ai -p -m gpt-5 --force "refactor the database layer"  # combine flags
ai -p --plan "how should I refactor auth?"             # plan mode (read-only)
ai -p -r <chatId> "continue"                           # resume a session
ai -p --timeout 60 "fix type errors"                   # abort after 60s
ai -p -q "explain this codebase"                       # suppress stderr status
```

Exit codes: `0` success, `1` error, `2` agent stuck.

**Note:** When `--timeout` fires during a tool execution (e.g., mid-file-write), the agent is interrupted immediately. The workspace may contain partial changes. Combine with version control or review the working tree after a timeout.

JSON output format:

```json
{
  "output": "...",
  "model": "anthropic/claude-sonnet-4.5",
  "tokens": 1234,
  "cost": 0.05,
  "exitCode": 0,
  "chatId": "abc123",
  "usage": {
    "inputTokens": 800,
    "outputTokens": 434,
    "cacheReadTokens": 0,
    "cacheWriteTokens": 0,
    "reasoningTokens": 0
  }
}
```

On error, includes an `error` field with the message.

## Options

- `-m, --model` - model (default: anthropic/claude-sonnet-4.5)
- `--image` - attach image file
- `-r, --resume` - resume a previous chat by ID
- `--plan` - start in plan mode (think before acting)
- `-p, --print` - headless mode: full agent, output to stdout, then exit
- `--json` - structured JSON output (implies --print)
- `--system` - append custom text to the system prompt
- `--force` - auto-approve all tool actions (--print only)
- `--no-save` - don't persist the chat to history (--print only)
- `--timeout` - abort after N seconds (--print only)
- `-q, --quiet` - suppress stderr status output (--print only)
- `-l, --list` - list models
- `--no-color` - disable color output
- `-v, --version` - show version
- `-h, --help` - help

## Commands

### Chat
- `/new` - new chat
- `/chats` - list chats
- `/chat <n>` - load chat
- `/delete` - delete chat
- `/clear` - clear screen

### Files
- `/copy` - copy response
- `/rollback` - undo changes

### Context
- `/usage` - token usage and cost
- `/compress` - compress history
- `/plan` - toggle plan mode (think before acting)
- `/review` - review loop (auto-reviews changes for bugs)

### Model
- `/model` - select model interactively
- `/model <query>` - switch to matching model

### System
- `/info` - version, model, balance, storage
- `/processes` - background processes
- `/memory` - saved memories
- `/mcp` - mcp servers
- `/settings` - preferences
- `/permissions` - tool permission rules
- `/alias` - shortcuts
- `/purge` - delete all chats
- `/help` - commands

## Skills

Skills extend the AI with specialized capabilities. They follow the [Agent Skills](https://agentskills.io) open standard.

### Managing Skills

```bash
/skills                    # list installed
/skills add <url>          # install from git
/skills remove <name>      # uninstall
/skills show <name>        # view content
/skills create <name>      # create new
/skills path               # show directory
```

### Installing Skills

Shorthand (like skills.sh):

```bash
/skills add vercel-labs/agent-skills/skills/react-best-practices
/skills add anthropics/skills/skills/pdf
/skills add owner/repo
```

Full GitHub URL:

```bash
/skills add https://github.com/anthropics/skills/tree/main/skills/pdf
```

Local path:

```bash
/skills add /path/to/skill
```

### Creating Skills

```bash
/skills create my-skill
```

Creates `~/.ai-cli/skills/my-skill/SKILL.md`

## Rules

Custom instructions loaded into every conversation:

- `~/.ai-cli/AGENTS.md` - global rules
- `./AGENTS.md` - project rules

Manage with `/rules`:

```bash
/rules show    # view rules
/rules edit    # open in editor
/rules clear   # remove rules
/rules path    # show path
```

## Review Loop

After the coding agent finishes making file changes, a separate review agent automatically inspects all modifications for severe and high-priority bugs. If it finds issues, it fixes them and re-reviews, up to a configurable number of passes.

The review agent runs in its own isolated context with a strict system prompt -- it has no attachment to the code it's reviewing and is intentionally more critical than the coding agent.

Enabled by default. Toggle with:

```bash
/review on     # enable
/review off    # disable
/review        # show status
```

Configure max iterations in `~/.ai-cli/config.json`:

```json
{
  "review": {
    "enabled": true,
    "maxIterations": 3
  }
}
```

## Tools

The AI can:

**files** - read, write, edit, delete, copy, rename, search

**commands** - run shell commands, background processes

**memory** - save facts across sessions ("remember X")

**web** - search, fetch urls, check weather

## MCP

Connect to external tools via [Model Context Protocol](https://modelcontextprotocol.io):

```bash
/mcp                                    # list servers
/mcp add weather http https://mcp.example.com
/mcp add db stdio npx @example/mcp-db
/mcp remove weather                     # remove server
/mcp reload                             # reconnect all
```

### Transports

- **http** - HTTP endpoint
- **sse** - server-sent events
- **stdio** - spawn local process

### Config

Servers stored in `~/.ai-cli/mcp.json`:

```json
{
  "servers": {
    "weather": {
      "type": "http",
      "url": "https://mcp.example.com"
    },
    "db": {
      "type": "stdio",
      "command": "npx",
      "args": ["@example/mcp-db"]
    }
  }
}
```

Environment variables expand with `${VAR}` or `${VAR:-default}`.

MCP tools are prefixed with server name (e.g., `weather_get_forecast`).

## Models

Supports fuzzy matching:

```bash
ai -m claude-4       # → anthropic/claude-sonnet-4
ai -m gpt-5          # → openai/gpt-5
ai -m sonnet         # → finds sonnet model
```

## Storage

All data in `~/.ai-cli/`:

```
~/.ai-cli/
├── config.json      # settings and api key
├── mcp.json         # mcp servers
├── chats/           # chat history
├── memories.json    # saved memories
├── skills/          # installed skills
└── AGENTS.md        # global rules
```

## Environment

Alternatively set your API key:

```bash
export AI_GATEWAY_API_KEY=your-key
```

# ai-cli

minimal terminal AI assistant

## install

```bash
npm install -g ai-cli
```

## setup

```bash
ai init
```

get your API key from [Vercel AI Gateway](https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%2Fapi-keys&title=Go+to+AI+Gateway)

## usage

```bash
ai                           # interactive mode
ai "hello"                   # single message
ai -m gpt-5 "hello"          # use specific model
ai --image ./img.png "what?" # analyze image (single message)
ai -l                        # list models
echo "explain this" | ai     # pipe input

# in interactive mode, ctrl+v to paste image from clipboard
```

## options

- `-m, --model` - model (default: anthropic/claude-sonnet-4.5)
- `--image` - attach image file
- `-r, --resume` - resume a previous chat by ID
- `--plan` - start in plan mode (think before acting)
- `-l, --list` - list models
- `--no-color` - disable color output
- `-v, --version` - show version
- `-h, --help` - help

## commands

### chat
- `/new` - new chat
- `/chats` - list chats
- `/chat <n>` - load chat
- `/delete` - delete chat
- `/clear` - clear screen

### files
- `/copy` - copy response
- `/rollback` - undo changes

### context
- `/usage` - token usage and cost
- `/compress` - compress history
- `/plan` - toggle plan mode (think before acting)
- `/review` - review loop (auto-reviews changes for bugs)

### model
- `/model` - select model interactively
- `/model <query>` - switch to matching model

### system
- `/info` - version, model, balance, storage
- `/processes` - background processes
- `/memory` - saved memories
- `/mcp` - mcp servers
- `/settings` - preferences
- `/permissions` - tool permission rules
- `/alias` - shortcuts
- `/purge` - delete all chats
- `/help` - commands

## skills

skills extend the AI with specialized capabilities. they follow the [Agent Skills](https://agentskills.io) open standard.

### managing skills

```bash
/skills                    # list installed
/skills add <url>          # install from git
/skills remove <name>      # uninstall
/skills show <name>        # view content
/skills create <name>      # create new
/skills path               # show directory
```

### installing skills

shorthand (like skills.sh):

```bash
/skills add vercel-labs/agent-skills/skills/react-best-practices
/skills add anthropics/skills/skills/pdf
/skills add owner/repo
```

full github url:

```bash
/skills add https://github.com/anthropics/skills/tree/main/skills/pdf
```

local path:

```bash
/skills add /path/to/skill
```

### creating skills

```bash
/skills create my-skill
```

creates `~/.ai-cli/skills/my-skill/SKILL.md`

## rules

custom instructions loaded into every conversation:

- `~/.ai-cli/AGENTS.md` - global rules
- `./AGENTS.md` - project rules

manage with `/rules`:

```bash
/rules show    # view rules
/rules edit    # open in editor
/rules clear   # remove rules
/rules path    # show path
```

## review loop

after the coding agent finishes making file changes, a separate review agent automatically inspects all modifications for severe and high-priority bugs. if it finds issues, it fixes them and re-reviews, up to a configurable number of passes.

the review agent runs in its own isolated context with a strict system prompt -- it has no attachment to the code it's reviewing and is intentionally more critical than the coding agent.

enabled by default. toggle with:

```bash
/review on     # enable
/review off    # disable
/review        # show status
```

configure max iterations in `~/.ai-cli/config.json`:

```json
{
  "review": {
    "enabled": true,
    "maxIterations": 3
  }
}
```

## tools

the AI can:

**files** - read, write, edit, delete, copy, rename, search

**commands** - run shell commands, background processes

**memory** - save facts across sessions ("remember X")

**web** - search, fetch urls, check weather

## mcp

connect to external tools via [model context protocol](https://modelcontextprotocol.io):

```bash
/mcp                                    # list servers
/mcp add weather http https://mcp.example.com
/mcp add db stdio npx @example/mcp-db
/mcp remove weather                     # remove server
/mcp reload                             # reconnect all
```

### transports

- **http** - HTTP endpoint
- **sse** - server-sent events
- **stdio** - spawn local process

### config

servers stored in `~/.ai-cli/mcp.json`:

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

environment variables expand with `${VAR}` or `${VAR:-default}`.

mcp tools are prefixed with server name (e.g., `weather_get_forecast`).

## models

supports fuzzy matching:

```bash
ai -m claude-4       # → anthropic/claude-sonnet-4
ai -m gpt-5          # → openai/gpt-5
ai -m sonnet         # → finds sonnet model
```

## storage

all data in `~/.ai-cli/`:

```
~/.ai-cli/
├── config.json      # settings and api key
├── mcp.json         # mcp servers
├── chats/           # chat history
├── memories.json    # saved memories
├── skills/          # installed skills
└── AGENTS.md        # global rules
```

## environment

alternatively set your API key:

```bash
export AI_GATEWAY_API_KEY=your-key
```

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
- `-l, --list` - list models
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
- `/diff` - view changes

### context
- `/usage` - token usage and cost
- `/compress` - compress history

### model
- `/list` - select model
- `/model` - current model

### system
- `/processes` - background processes
- `/memory` - saved memories
- `/settings` - preferences
- `/alias` - shortcuts
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

## tools

the AI can:

**files** - read, write, edit, delete, copy, rename, search

**commands** - run shell commands, background processes

**memory** - save facts across sessions ("remember X")

**web** - search, fetch urls, check weather

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

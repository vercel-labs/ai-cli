# ai-cli

AI CLI using Vercel AI Gateway

## Installation

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
ai --image ./img.png "what?" # analyze image
ai -l                        # list available models
echo "explain this" | ai     # pipe input
```

## Options

- `-m, --model` - model (default: anthropic/claude-sonnet-4.5)
- `--image` - attach image file (png, jpg, gif, webp)
- `-l, --list` - list available models
- `-h, --help` - help

## Interactive Mode

Type `ai` to enter interactive mode with file access and chat history.

### Commands

**Chat**
- `/new` - start new chat
- `/chats` - list saved chats (paginated)
- `/chat <n>` - load chat by number
- `/delete` - delete current chat
- `/purge` - delete all chats
- `/clear`, `/c` - clear screen and history

**Context**
- `/context` - show token usage
- `/compress` - compress chat history
- `/summary` - view compressed summary
- `/usage` - show chat stats and cost

**Models**
- `/list`, `/l` - select model (with search)
- `/model`, `/m` - show current model

**Processes**
- `/processes`, `/ps` - manage background processes

**Memory**
- `/memory` - view saved memories
- `/memory clear` - clear all memories

**Undo**
- `/undo`, `/u` - undo last file change

**Settings**
- `/init`, `/i` - setup api key
- `/credits` - show balance
- `/storage` - show storage info
- `/help`, `/h` - show commands

**Exit**
- `exit` or `quit`

## Tools

The AI can interact with your system:

**Files**
- read/write/edit files
- create folders
- rename/move/copy/delete files
- search in files
- find files by pattern

**Commands**
- run shell commands (build, test, install)
- start background processes (dev servers)
- manage running processes

**Memory**
- say "remember X" to save facts across sessions
- ask "what do you remember" to recall

## Switching Models

Supports fuzzy matching:

```bash
ai -m claude-4       # → anthropic/claude-sonnet-4
ai -m gpt-5          # → openai/gpt-5
ai -m sonnet         # → finds a sonnet model
```

## Storage

- Config: `~/.airc`
- Chats: `~/.ai-chats/`
- Memories: `~/.ai-memories`

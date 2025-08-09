# ai-cli

AI CLI using OpenAI's open source model.

## Installation

```bash
npm install -g ai-cli
```

## Setup

Set your AI Gateway API key in your shell configuration:

```bash
# Add to ~/.zshrc or ~/.bashrc
export AI_GATEWAY_API_KEY=your-api-key
```

Get your API key at https://vercel.com/ai-gateway

## Usage

```bash
ai "whats up bro"
ai hello
echo "explain this code" | ai
ai -m openai/gpt-5 "who is rauchg"
```

## Options

- `-m, --model` - Specify AI model (default: openai/gpt-5)
- `-h, --help` - Show help message

## Switching Models

You can use any model available through Vercel AI Gateway by using the `-m` flag:

```bash
ai -m claude-4-sonnet "who am i"
ai -m openai/gpt-4o "count to 3"
ai -m anthropic/claude-4.1-opus "spend my money"
```

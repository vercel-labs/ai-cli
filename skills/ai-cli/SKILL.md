---
name: ai-cli
description: Generate text, images, video, and audio from the terminal using AI models.
---

# ai-cli

Generate text, images, video, and audio from the terminal using AI models.

## When to Use

Use when you need to:
- Generate images from text prompts or existing images
- Generate video from text prompts or images
- Generate text (summaries, explanations, code reviews) from prompts or piped content
- Generate speech from text or transcribe audio files and streams
- Compare outputs across multiple models side-by-side
- Build composable media pipelines by chaining commands via stdin/stdout

## Prerequisites

Requires `AI_GATEWAY_API_KEY` or a provider-specific key (e.g. `OPENAI_API_KEY`) in the environment.

## Commands

```bash
ai text "explain this code"              # generate text
ai image "a sunset over mountains"       # generate an image
ai video "a spinning triangle"           # generate a video
ai audio speak "hello"                   # generate speech
ai audio transcribe recording.mp3        # transcribe audio
ai models --type audio                   # list speech and transcription models
```

## Key Flags

```
-m, --model <id>       Model ID (provider/name or short name), comma-separated for multi-model
-o, --output <path>    Output file or directory
-n, --count <n>        Number of generations per model
-q, --quiet            Suppress progress output
--json                 Output structured metadata as JSON (paths, timing, success/failure)
```

## Piping Patterns

Chain commands for agent workflows:

```bash
# Pipe content in for summarization
cat file.txt | ai text "summarize this"
git diff | ai text "write a commit message"

# Image-to-video pipeline
ai image "a dragon" | ai video "animate this"

# Image editing via stdin
cat photo.png | ai image "make it a watercolor"

# Audio workflows
echo "Ship the changelog" | ai audio speak -o changelog.mp3
cat recording.mp3 | ai audio transcribe -o transcript.txt
```

## Structured Output

Use `--json` to get machine-readable results:

```bash
ai image "a sunset" --json
```

Returns:
```json
{
  "elapsed_ms": 3420,
  "count": 1,
  "results": [
    {
      "index": 1,
      "model": "openai/gpt-image-2",
      "elapsed_ms": 3420,
      "success": true,
      "file": "/path/to/resp_abc123.png"
    }
  ]
}
```

## Multi-Model Comparison

```bash
ai image "a sunset" -m "openai/gpt-image-1,bfl/flux-2-pro,xai/grok-imagine-image"
```

## Output Behavior

- **Interactive (TTY)**: saves to file, prints path to stderr
- **Piped (non-TTY)**: writes raw content to stdout for chaining
- **`-o <dir>`**: saves inside directory with auto-generated names

When the CLI chooses a filename, it uses a response ID when available and falls back to a random 8-character ID, such as `resp_abc123.png` or `7f3a9c1d.mp3`.

**Important for agents**: Always use `-o` to save to a file when generating images, video, or speech audio. Without `-o` in a non-TTY context, raw binary data is written to stdout, which wastes context and is not useful for agents. Use `-o output.png`, `-o speech.mp3`, or an output directory and read the file path from `--json` output instead.

## Timeouts

- text: 120 seconds
- image: 300 seconds
- video: 300 seconds
- audio speak: 120 seconds
- audio transcribe: 120 seconds

## Exit Codes

- `0` — success
- `1` — all generations failed
- `2` — partial failure (some succeeded)

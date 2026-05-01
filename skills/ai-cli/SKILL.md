# ai-cli

Generate text, images, and video from the terminal using AI models.

## When to Use

Use when you need to:
- Generate images from text prompts or existing images
- Generate video from text prompts or images
- Generate text (summaries, explanations, code reviews) from prompts or piped content
- Compare outputs across multiple models side-by-side
- Build composable media pipelines by chaining commands via stdin/stdout

## Prerequisites

Requires `AI_GATEWAY_API_KEY` or a provider-specific key (e.g. `OPENAI_API_KEY`) in the environment.

## Commands

```bash
ai text "explain this code"              # generate text
ai image "a sunset over mountains"       # generate an image
ai video "a spinning triangle"           # generate a video
ai models --type image                   # list available models
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
      "file": "/path/to/output.png"
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

## Timeouts

- text/image: 120 seconds
- video: 300 seconds

## Exit Codes

- `0` — success
- `1` — all generations failed
- `2` — partial failure (some succeeded)

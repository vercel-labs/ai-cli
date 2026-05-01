# ai

A tiny, agent-native CLI for generating images, video and text with dead-simple commands, stdin support and predictable artifact outputs. Uses [Vercel AI SDK](https://sdk.vercel.ai) and [AI Gateway](https://vercel.com/docs/ai-gateway) for unified access to hundreds of models.

## Install

```bash
npm install -g ai-cli
```

Requires an [AI Gateway](https://vercel.com/docs/ai-gateway) API key or a provider-specific key (e.g. `OPENAI_API_KEY`).

## Usage

```bash
ai image "a cute dog"
ai video "a spinning triangle"
ai text "explain quantum computing"
ai models                          # list available models
```

### Piping

```bash
ai image "a dragon" | ai video "animate this"
cat notes.txt | ai text "summarize this"
git diff | ai text "explain these changes"
```

### Common Options

All commands support:

```
-m, --model <id>         Model ID (creator/model-name), comma-separated for multi-model
-o, --output <path>      Output file path or directory
-n, --count <n>          Number of generations per model (default: 1)
-p, --concurrency <n>    Max parallel generations (default: 4, video: 2)
-q, --quiet              Suppress progress output
--json                   Output metadata as JSON
```

Model IDs can be specified as `provider/model-name` or just `model-name` (resolved against the known model list):

```bash
ai text -m gpt-5.5 "hello"          # resolves to openai/gpt-5.5
ai image -m flux-2-pro "a sunset"   # resolves to bfl/flux-2-pro
```

### image

```
--size <WxH>             Image size (e.g. 1024x1024)
--aspect-ratio <W:H>     Aspect ratio (e.g. 16:9)
--quality <level>        Quality (standard, hd)
--style <style>          Style (vivid, natural)
--no-preview             Disable inline image preview
```

### video

```
--aspect-ratio <W:H>     Aspect ratio (e.g. 16:9)
--duration <seconds>     Duration in seconds
--no-preview             Disable inline video frame preview
```

### text

In interactive terminals, single-model text output streams to stdout as tokens arrive. Use `--json`, `-o`, or `AI_CLI_OUTPUT_DIR` when you need buffered output.

```
-f, --format <fmt>       Output format: md, txt (default: md)
-s, --system <prompt>    System prompt
--max-tokens <n>         Maximum tokens to generate
-t, --temperature <n>    Temperature (0-2)
```

### models

```
--type <type>            Filter by type: text, image, video
--provider <name>        Filter by provider (e.g. openai, google)
--json                   Output as JSON (includes descriptions)
```

All model types (text, image, video) are fetched live from the AI Gateway. If the gateway is unreachable, all model types fall back to a built-in list.

### completions

Output a shell completion script for tab completion of commands, flags, and model names:

```bash
ai completions zsh    # add eval "$(ai completions zsh)" to ~/.zshrc
ai completions bash   # add eval "$(ai completions bash)" to ~/.bashrc
ai completions fish   # add ai completions fish | source to config.fish
```

### Multi-Model Comparison

Generate with multiple models by comma-separating `-m`:

```bash
ai image "a sunset" -m "openai/gpt-image-1,xai/grok-imagine-image,bfl/flux-2-pro"
```

Combine with `-n` to generate multiple per model:

```bash
ai image "a sunset" -n 2 -m "openai/gpt-image-1,bfl/flux-2-pro"   # 4 images total
```

### Inline Preview

When running in a terminal that supports the [Kitty graphics protocol](https://sw.kovidgoyal.net/kitty/graphics-protocol/) (Kitty, Ghostty, WezTerm, Warp, iTerm2), generated images and videos are displayed inline automatically. Video previews decode an H.264 keyframe from the midpoint of the video using [openh264](https://github.com/cisco/openh264) compiled to WebAssembly — no native dependencies required. Use `--no-preview` to disable this, or set `AI_CLI_PREVIEW=1` to force it on in undetected terminals.

### Output Behavior

- **text**: streams to stdout in interactive terminals for single-model runs, stdout when piped
- **image/video**: saves to file (interactive), raw binary stdout when piped
- **`-o <dir>`**: saves inside the directory with auto-generated names

### Environment Variables

| Variable             | Description                                              |
| -------------------- | -------------------------------------------------------- |
| `AI_GATEWAY_API_KEY` | AI Gateway authentication key                            |
| `OPENAI_API_KEY`     | Provider-specific key (or other provider keys)           |
| `AI_CLI_TEXT_MODEL`  | Default text model (overrides `openai/gpt-5.5`)          |
| `AI_CLI_IMAGE_MODEL` | Default image model (overrides `openai/gpt-image-2`)     |
| `AI_CLI_VIDEO_MODEL` | Default video model (overrides `bytedance/seedance-2.0`) |
| `AI_CLI_OUTPUT_DIR`  | Default output directory for generated files             |
| `AI_CLI_PREVIEW`     | Set to `1` to force inline image preview, `0` to disable |
| `NO_COLOR`           | Disable ANSI color output                                |
| `FORCE_COLOR`        | Force color output even when not a TTY                   |

The `-m` flag always takes priority over `AI_CLI_*_MODEL` env vars. The `-o` flag always takes priority over `AI_CLI_OUTPUT_DIR`.

### Timeouts

Requests that exceed the timeout are aborted automatically:

| Command | Timeout     |
| ------- | ----------- |
| `text`  | 120 seconds |
| `image` | 120 seconds |
| `video` | 300 seconds |

### Exit Codes

| Code | Meaning                                       |
| ---- | --------------------------------------------- |
| `0`  | Success                                       |
| `1`  | All generations failed                        |
| `2`  | Partial failure (some succeeded, some failed) |

## License

[Apache-2.0](LICENSE)

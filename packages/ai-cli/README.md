# ai

An agent-native CLI for generating media and text, and filtering, ranking, and selecting records with AI. Composable commands, stdin support, and predictable outputs. Uses [Vercel AI SDK](https://sdk.vercel.ai) and [AI Gateway](https://vercel.com/docs/ai-gateway) for unified access to hundreds of models.

## Install

```bash
npm install -g ai-cli
```

Requires Node.js 22+ and an [AI Gateway](https://vercel.com/docs/ai-gateway) API key or a provider-specific key (e.g. `OPENAI_API_KEY`).

## Usage

```bash
ai image "a cute dog"
ai video "a spinning triangle"
ai text "explain quantum computing"
ai audio speak "Thanks for trying ai-cli"
ai audio transcribe recording.mp3
git log --oneline | ai filter "describes a concurrency fix"
ai rank "impact on signing in" --top 5 < issues.json
ai pick "most relevant to this failure" --context failure.log < issues.jsonl
ai models                          # list available models
```

### Piping and References

```bash
ai image "a dragon" | ai video "animate this"
ai video -i input.png "animate this"
ai image --image reference.png "make a sticker in this style"
ai image -i sketch.png -i palette.jpg "render this product concept"
ai text --image screenshot.png "what is broken in this UI?"
cat photo.png | ai text "describe this image"
cat notes.txt | ai text "summarize this"
git diff | ai text "explain these changes"
echo "Ship the changelog" | ai audio speak -o changelog.mp3
cat recording.mp3 | ai audio transcribe
```

### Common Options

Generation commands support:

```
-m, --model <id>         Model ID (creator/model-name), comma-separated for multi-model
-o, --output <path>      Output file path or directory
-n, --count <n>          Number of generations per model (default: 1)
-p, --concurrency <n>    Max parallel generations (default: 4, video: 2)
--timeout <seconds>      Request timeout in seconds (default: text/audio 120, image/video 300)
-q, --quiet              Suppress progress output
--json                   Output metadata as JSON
```

When using `--json`, stdout contains only metadata. Generated text, image, video and audio outputs are written to files even when stdout is piped.

Model IDs can be specified as `creator/model-name` or just `model-name` (resolved against models fetched from the gateway):

```bash
ai text -m gpt-5.5 "hello"          # resolves to openai/gpt-5.5
ai image -m flux-2-pro "a sunset"   # resolves to bfl/flux-2-pro
ai audio speak -m tts-1 "hello"     # resolves to openai/tts-1
```

Model IDs must contain printable ASCII characters without spaces. This applies to both `--model` values and the `AI_CLI_*_MODEL` environment variables.

### filter, rank, and pick

Evaluate records with Jev through AI Gateway:

```bash
git log --oneline | ai filter "describes a concurrency fix"
ai rank "impact on signing in" --top 5 < issues.json
ai pick "most relevant to this failure" --context failure.log < issues.jsonl
```

- `filter` keeps records whose match probability is at least `--threshold`
  (default `0.8`). Probabilities at or below `1 - threshold` are rejected.
  Values between those bounds are uncertain: the default fails without emitting
  records; `--on-uncertain skip` drops them and `keep` includes them.
- `rank` scores each record on the same ordered rubric, highest first.
  `--top <n>` limits the output; ties retain input order.
- `pick` chooses one existing record and independently checks that a match exists.
  Both the existence probability and winning choice probability must meet
  `--threshold`. No match exits `3`; uncertainty exits `4`.

```text
-m, --model <id>        One evaluation model (default: typesafe-ai/jev)
--input <format>       auto, lines, json, or jsonl (default: auto)
--context <path>       UTF-8 file supplying context
-p, --concurrency <n>  Parallel evaluation requests (default: 4)
--timeout <seconds>    Timeout per request, including retries (default: 30)
-q, --quiet            Suppress progress and outcome diagnostics
--json                 Records, decisions, probabilities, usage, and timing
--threshold <p>        filter/pick only: greater than 0.5 and at most 1
--on-uncertain <mode>  filter only: error, skip, or keep (default: error)
--top <n>              rank only: return the highest-ranked n records
--rubric <path>        rank/pick: JSON array of labels, lowest to highest
```

Input is buffered through EOF. Auto detection tries a complete JSON value, then
JSONL, then nonempty text lines. Use `--input lines` for bracketed logs or other
JSON-looking text. Lines and JSONL preserve selected line contents; JSON input
produces a JSON array, including for a single selected record. Blank lines are
ignored. Decisions always print records to stdout, including in a TTY.
`--json` instead emits an envelope with `status`, `count`, `input_count`,
`calls`, `usage`, and `results` containing original records, one-based input
indices, selection flags, and probabilities or scores. It does not create files.

The default rubric has five levels from no match (`0`) to an exceptional match
(`4`). A custom rubric must contain 2–255 nonempty string labels. `pick` uses
the rubric only when there are more than 255 records: it scores every record
in batches, shortlists the top 32, and chooses from that shortlist. Shortlisting
is approximate; use `--json` to inspect the scores and final selection.
If a filtering or scoring batch fails, pending batches are not started,
in-flight siblings are cancelled, and no partial records are emitted.

Requires `AI_GATEWAY_API_KEY` with access to the evaluation provider. Override the
default with `AI_CLI_EVALUATION_MODEL` or `-m`. Decision commands accept one
evaluation model per invocation.

### image

```
-i, --image <path-or-url> Reference image path or URL (repeatable)
--size <WxH>             Image size (e.g. 1024x1024)
--aspect-ratio <W:H>     Aspect ratio (e.g. 16:9)
--quality <level>        Quality (standard, hd)
--style <style>          Style (vivid, natural)
--no-preview             Disable inline image preview
```

Reference images can be local paths, `file://` URLs, `http(s)://` URLs or data URLs. You can repeat `--image` to pass multiple references, and you can still pipe one image through stdin:

```bash
cat input.png | ai image -i style.png "combine the subject with this style"
```

Reference-image support is model-dependent; unsupported models may reject image inputs.

Gemini image models (e.g. `google/gemini-2.5-flash-image`) don't support `--size`; use `--aspect-ratio` instead.

### video

```
-i, --image <path-or-url> Image input path or URL
--aspect-ratio <W:H>     Aspect ratio (e.g. 16:9)
--resolution <WxH>       Video resolution (e.g. 1920x1080 for 1080p)
--duration <seconds>     Duration in seconds
--no-preview             Disable inline video frame preview
```

Image inputs can be local paths, `file://` URLs, `http(s)://` URLs or data URLs. Video generation accepts one input image, provided either through `--image` or piped stdin:

```bash
ai video -i input.png "animate this"
cat input.png | ai video "animate this"
```

Resolution support is model-dependent; unsupported resolutions may be rejected by the selected video model.

### text

```
-f, --format <fmt>       Output format: md, txt (default: md)
-i, --image <path-or-url> Image input path or URL for vision (repeatable)
-s, --system <prompt>    System prompt
--max-tokens <n>         Maximum tokens to generate
-t, --temperature <n>    Temperature (0-2)
```

For vision-capable text models, `ai text` accepts images from `--image` or piped stdin:

```bash
ai text -i chart.png -i table.jpg "summarize the data"
cat screenshot.png | ai text "list the visible errors"
```

### audio

`audio` has two subcommands:

```bash
ai audio speak "Hello from AI Gateway"
ai audio transcribe recording.mp3
```

#### audio speak

```
-f, --format <fmt>       Audio output format (default: mp3)
--voice <voice>          Voice to use for speech generation
--instructions <text>    Instructions for speech generation
--speed <n>              Speech speed
--language <code>        Language code (e.g. en, fr) or auto
--no-play                Disable audio playback after generation
--no-waveform            Disable accurate terminal waveform preview
```

`audio speak` accepts text from an argument or stdin and saves audio to `<id>.mp3` by default:

```bash
ai audio speak --voice alloy "Read this as a friendly update"
cat announcement.txt | ai audio speak --format wav -o announcement.wav
```

When using OpenAI speech models, `ai audio speak` defaults to the `alloy` voice unless `--voice` is provided.

When `-o` points to a file with a known audio extension and `--format` is omitted, the extension selects the audio format. If both are provided, `--format` must match the filename extension.

In interactive terminals, `audio speak` plays the generated audio after saving it and shows an accurate waveform derived from decoded audio samples. Use `--no-play` to skip playback and `--no-waveform` or `--quiet` to suppress the waveform. Playback and waveform previews are skipped for `--json` and binary stdout pipeline output. WAV output is decoded directly; MP3 and other encoded formats use a local decoder when available (`ffmpeg`, `mpg123`, `sox`, or `afconvert`).

#### audio transcribe

```
-f, --format <fmt>       Output format: md, txt (default: txt)
```

`audio transcribe` accepts a local path, `file://` URL, `http(s)://` URL or piped audio:

```bash
ai audio transcribe meeting.mp3
ai audio transcribe https://example.com/call.wav
cat voice-note.mp3 | ai audio transcribe -o transcript.txt
```

### models

```
[model]                  Show detailed info for a model (e.g. anthropic/claude-opus-4.6)
--type <type>            Filter by type: text, image, video, audio, speech, transcription, evaluation
--creator <name>         Filter by creator (e.g. openai, google)
--json                   Output as JSON (includes descriptions)
```

All supported model types (text, image, video, speech, transcription, evaluation) are fetched live from the AI Gateway.

Pass a model ID (or short name) to see its context window, max output, pricing, release date and per-provider latency, throughput and uptime:

```
$ ai models claude-opus-4.6

Claude Opus 4.6  anthropic/claude-opus-4.6
Released 2026-02-05 · tool-use · reasoning · vision · web-search

  Context      1M
  Max output   128K
  Input        $5/M
  Output       $25/M
  Cache read   $0.5/M
  Cache write  $6.25/M
  Web search   $10/K + input costs

Providers
  provider   context  latency  throughput  uptime
  anthropic  1M       1.4s     49tps       99.9%
  bedrock    1M       1.4s     56tps       99.9%
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

When running in a terminal that supports the [Kitty graphics protocol](https://sw.kovidgoyal.net/kitty/graphics-protocol/) (Kitty, Ghostty, WezTerm, Warp, iTerm2), generated images and videos are displayed inline automatically. Image formats returned by models are preserved on disk and converted to PNG for terminal previews when needed. Video previews decode an H.264 keyframe from the midpoint of the video using [openh264](https://github.com/cisco/openh264) compiled to WebAssembly — no native dependencies required. `audio speak` can also play generated speech and render a terminal waveform after saving. Use `--no-preview` for image/video previews, `--no-play` or `--no-waveform` for audio previews, or set `AI_CLI_PREVIEW=1` to force visual previews on in undetected terminals.

### Output Behavior

- **filter/rank/pick**: selected records on stdout in both TTY and pipes; `--json` returns inline decision metadata
- **text**: saves to `<id>.md` (interactive), stdout when piped
- **image/video**: saves to `<id>.<format>` / `<id>.mp4` (interactive), preserving the image format returned by the model, raw binary stdout when piped
- **audio speak**: saves to `<id>.mp3` (interactive), raw binary stdout when piped
- **audio transcribe**: saves to `<id>.txt` (interactive), stdout when piped
- **`-o <dir>`**: saves inside the directory with auto-generated names

When the CLI needs to choose a filename, it uses a response id when available and falls back to a random 8-character id.

### Environment Variables

| Variable | Description |
|---|---|
| `AI_GATEWAY_API_KEY` | AI Gateway authentication key |
| `OPENAI_API_KEY` | Provider-specific key (or other provider keys) |
| `AI_CLI_TEXT_MODEL` | Default text model (overrides `openai/gpt-5.5`) |
| `AI_CLI_IMAGE_MODEL` | Default image model (overrides `openai/gpt-image-2`) |
| `AI_CLI_VIDEO_MODEL` | Default video model (overrides `bytedance/seedance-2.0`) |
| `AI_CLI_SPEECH_MODEL` | Default speech model (overrides `openai/tts-1`) |
| `AI_CLI_TRANSCRIPTION_MODEL` | Default transcription model (overrides `openai/whisper-1`) |
| `AI_CLI_EVALUATION_MODEL` | Default evaluation model (overrides `typesafe-ai/jev`) |
| `AI_CLI_OUTPUT_DIR` | Default output directory for generated files |
| `AI_CLI_PREVIEW` | Set to `1` to force inline image preview, `0` to disable |
| `NO_COLOR` | Disable ANSI color output |
| `FORCE_COLOR` | Force color output even when not a TTY |

The `-m` flag always takes priority over `AI_CLI_*_MODEL` env vars. The `-o` flag always takes priority over `AI_CLI_OUTPUT_DIR`.

### Timeouts

Requests that exceed the timeout are aborted automatically:

| Command | Timeout |
|---|---|
| `filter`, `rank`, `pick` | 30 seconds per evaluation request |
| `text` | 120 seconds |
| `image` | 300 seconds |
| `video` | 300 seconds |
| `audio speak` | 120 seconds |
| `audio transcribe` | 120 seconds |

Use `--timeout <seconds>` to override the default for `text`, `image`, `video`, `audio speak`, `audio transcribe`, `filter`, `rank`, or `pick`. The value must be a positive integer. For example, `ai image --timeout 600 "a detailed sprite atlas"` allows the request to run for up to 10 minutes.

### Exit Codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | Invalid input or request failure; all generations failed |
| `2` | Partial generation failure (some succeeded, some failed) |
| `3` | `pick` found no matching record |
| `4` | `pick` is uncertain, or `filter` is uncertain with `--on-uncertain error` |

## License

[Apache-2.0](LICENSE)

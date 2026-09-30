# ai

<p>
  <a href="https://vercel.com/labs#active-experiments"><img alt="Vercel Labs Experiment" src="https://img.shields.io/badge/LABS-EXPERIMENT-0a0a0a.svg?style=for-the-badge&amp;logo=Vercel&amp;labelColor=000000" height="28"></a>
  <a href="https://www.npmjs.com/package/ai-cli"><img alt="npm version: ai-cli" src="https://img.shields.io/npm/v/ai-cli.svg?style=for-the-badge&amp;labelColor=000000" height="28"></a>
  <a href="https://www.apache.org/licenses/LICENSE-2.0"><img alt="License: Apache-2.0" src="https://img.shields.io/npm/l/ai-cli.svg?style=for-the-badge&amp;labelColor=000000" height="28"></a>
</p>

The [Vercel AI SDK](https://sdk.vercel.ai) in your terminal. Generate text, images, video, and audio, and evaluate typed questions with composable commands, stdin support, and predictable outputs. Uses [AI Gateway](https://vercel.com/docs/ai-gateway) for unified access to hundreds of models.

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
ai evaluate --boolean "refund=Refund requested?" < ticket.txt
ai models                          # list available models
```

### Piping and References

```bash
ai image "a dragon" | ai video "animate this"
ai video -i input.png "animate this"
ai image --images reference.png "make a sticker in this style"
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
-n, --n <n>              Image/video outputs per model (default: 1)
-n, --count <n>          Text/audio generations per model (default: 1)
-p, --concurrency <n>    Max parallel generations (default: 4, video: 2)
--timeout <seconds>      Request timeout in seconds (default: text/audio 120, image 300, video 600)
-q, --quiet              Suppress progress output
--json                   Output metadata as JSON
```

When using `--json`, stdout contains only metadata. Generated text, image, video and audio outputs are written to files even when stdout is piped.
For image and video `--n`, fewer returned outputs than requested are reported as
an incomplete result with a nonzero exit code. Available media is still saved.
When a batching limit splits generation into calls, successful calls are saved
even if another call fails. For `generateImage` and video generation, JSON
results include successful call diagnostics in `batches` and failed call or
download details in `failures`.

Model IDs can be specified as `creator/model-name` or just `model-name` (resolved against models fetched from the gateway):

```bash
ai text -m gpt-5.5 "hello"          # resolves to openai/gpt-5.5
ai image -m flux-2-pro "a sunset"   # resolves to bfl/flux-2-pro
ai audio speak -m tts-1 "hello"     # resolves to openai/tts-1
```

Model IDs must contain printable ASCII characters without spaces. This applies to both `--model` values and the `AI_CLI_*_MODEL` environment variables.

### evaluate

Evaluate named Boolean, Choice, and Score questions using AI SDK evaluation models:

```bash
cat ticket.txt |
  ai evaluate \
    --boolean "refund=Refund requested?" \
    --choice "team=Which team?" \
    --choices "team=billing,support" \
    --score "tone=How positive?" \
    --levels "tone=angry,neutral,happy"
```

All questions share one unchanged input. Text keeps its line breaks; JSON objects
and arrays keep their shape. Each question has an explicit type and a unique ID.
Choices and levels bind to that ID regardless of flag order. Repeat the flags to
ask more questions in the same request.

- Boolean returns `probability`: P(true) from 0 to 1, including strong no answers near zero.
- Choice returns one supplied option and its distribution when available.
- Score returns a fractional position on ordered levels, starting at zero, and
  a distribution when available. Jev uses the probability-weighted mean.

The command calls AI SDK's `experimental_evaluate`: stdin maps to `state`,
and typed flags build its named `questions`. `--choices` creates a Choice
`criteria` map; `--levels` creates a Score `criteria` array. The file form uses
the SDK question schema directly. Jev is the default evaluation model; other
supported evaluation models use the same interface.

For richer criteria, save a named question map to `triage.json`:

```json
{
  "refund": {
    "type": "boolean",
    "instructions": "Is the customer requesting money back?"
  },
  "team": {
    "type": "choice",
    "instructions": "Which team should handle this request?",
    "criteria": {
      "billing": "Payments, charges, and refunds",
      "support": "Other requests"
    }
  },
  "impact": {
    "type": "score",
    "instructions": "How much is the customer prevented from using the product?",
    "criteria": ["Cosmetic issue", "A workaround exists", "Unusable; no workaround"]
  }
}
```

```bash
ai evaluate --questions triage.json < ticket.json
ai evaluate --boolean "refund=Refund requested?" < ticket.txt |
  jq -e '.answers.refund.probability >= 0.9'
```

Question files support string, JSON object, or array instructions and descriptions;
descriptions may also be `null`. Boolean criteria optionally describe `true` and
`false`; Choice criteria are an option map; Score criteria are ordered levels.
There is no implicit rubric. Model-specific limits are enforced by the SDK and provider.
Inline comma-separated choices use each label as its name and description.
Use a file for labels containing commas or separate names and descriptions.
Files and inline questions can be combined; duplicate IDs are errors.

```text
--boolean <id=question>    P(true) question (repeatable)
--choice <id=question>     Categorical question (repeatable)
--choices <id=a,b,...>     Choices for the named question (repeatable)
--score <id=question>      Ordered-score question (repeatable)
--levels <id=low,...,high> Score levels for the named question (repeatable)
--questions <path>        JSON file of named typed questions
-m, --model <id>          One evaluation model (default: typesafe-ai/jev)
--input <format>          auto, text, or json (default: auto)
--provider-options <path> JSON object of provider names to option objects
--max-retries <n>         Transient-error retries, including 0 (default: 2)
--timeout <seconds>       Evaluation deadline including retries (default: 30)
```

Output is always JSON on stdout; no `--json` flag is needed and no files are
created. Output is the JSON-serialized SDK result: `answers`, `usage`, `warnings`,
`response`, and optional `rounding` and `providerMetadata`. Fields and values
are preserved; score indices refer to your supplied criteria.
Native confidence is distinct from option probability and stays in provider
metadata. Missing distributions or confidence are not synthesized.
Usage has `inputTokens`, `outputTokens`, and `totalTokens`; unknown values
are omitted, and known zeros remain zero. `response` retains model information,
provider headers and body when available, and an ISO timestamp. Use shell `time`
for elapsed command time.

Stdin is buffered through EOF. Auto mode tries one complete JSON value, then
text. Malformed JSON-looking input fails; use `--input text` for literal logs.
JSON state must be a string, object, or array. Empty stdin and binary input fail;
explicit empty JSON objects, arrays, and strings are valid. To read JSONL as a
shared array, use `jq -s . tickets.jsonl | ai evaluate --questions triage.json`.
Provider context limits apply; input and questions are never silently split or truncated.

Valid evaluations exit `0`, including false and uncertain answers. Input errors,
provider failures, timeouts, and invalid answers exit `1` with no partial JSON.
Apply thresholds, sorting, and routing in your code; `jq -e` above owns its exit status.

Ask small, focused questions with complete instructions and meaningful criteria.
Question IDs are for your code and are not instructions to Jev. Questions in one
call are independent; use follow-up calls for dependencies. Use `ai text` when
you need prose, explanations, or code. Typed output does not guarantee correct judgments.

Supply the context each question needs, including a reference date for questions
about "today"; the CLI does not add the current date. Keep exact arithmetic,
counting, age cutoffs, and date comparisons in code. TypeSafe documents
[numeric and date limitations in Jev 1.13](https://docs.typesafe.ai/model-jaggedness/jev-1.13).
Adding context can clarify a question without making the model a reliable calculator.
Validate questions and probability thresholds against positive and negative examples,
including quotations and negations. A high probability can still be a wrong judgment.

Requires `AI_GATEWAY_API_KEY` with access to the evaluation provider. Override
the default with `AI_CLI_EVALUATION_MODEL` or `-m`; `-m jev` resolves to
`typesafe-ai/jev`. Discover models with `ai models --type evaluation`.

See [Evaluate](https://ai-cli.dev/docs/evaluate) for the complete interface.

### image

Image and video option names follow AI SDK keys in kebab case. Nested options use
JSON files with the SDK's original camelCase keys.

```text
-i, --images <path-or-url>   prompt.images reference (repeatable)
--mask <path-or-url>         prompt.mask for editing
-n, --n <n>                 Number of images per model (default: 1)
--max-images-per-call <n>    SDK batching limit
--size <widthxheight>                Image size, e.g. 1024x1024
--aspect-ratio <width:height>         Aspect ratio, e.g. 16:9
--api <api>                 generateImage or generateText (default: model catalog)
--generate-text-options <path> JSON generateText settings and provider tools
```

Reference images and masks accept local paths, `file://`, HTTP(S), and data URLs.
Stdin supplies an additional reference image. A mask requires a reference image.

```bash
ai image --images subject.png --images style.png "combine these"
ai image --images photo.png --mask mask.png "replace the background"
ai image "a sunset" --n 3 --max-images-per-call 2 --json -o ./renders/
```

Both image and video generation support these request controls:

```text
--seed <integer>            SDK seed, including 0
--provider-options <path>   JSON providerOptions, keyed by provider name
--headers <path>            JSON object of HTTP headers
--max-retries <n>            SDK maxRetries (default: 2; 0 disables retries)
--base-url <url>             Gateway baseURL (e.g. https://ai-gateway.vercel.sh/v4/ai)
--team-id-or-slug <team>     Gateway teamIdOrSlug
```

For example, `image-options.json` can contain:

```json
{
  "openai": { "quality": "high", "outputFormat": "webp", "background": "transparent" },
  "gateway": { "order": ["openai"] }
}
```

```bash
ai image "a transparent sticker" --provider-options image-options.json -o ./renders/
```

Provider options pass through unchanged, including nested routing, fallbacks,
compression, fidelity, and model-specific controls. Supported keys and values
depend on the provider/model; use the [AI SDK provider docs](https://ai-sdk.dev/providers/ai-sdk-providers)
and [Gateway provider options](https://vercel.com/docs/ai-gateway/models-and-providers/provider-options).
`--output` selects a filesystem destination; `outputFormat` selects an encoded format.

Gemini image models use `generateText`. Set their resolution with
`{"google":{"imageConfig":{"imageSize":"4K"}}}` in the provider-options file.
`--aspect-ratio` merges into `google.imageConfig.aspectRatio` without removing
`imageSize`. `--size`, `--mask`, `--max-images-per-call`, and `--n` other than 1
are rejected for `generateText`; that API can still return multiple image files,
which are all saved. Other language image models use provider-specific controls.

`--api generateText` selects a language model explicitly; `--api generateImage`
selects a dedicated image model. If discovery fails, returns an invalid catalog,
or omits the selected image model, automatic routing stops with an error.
Explicit `--api` and a full model ID allow generation without discovery.

For OpenAI image generation through a language model, use
`--generate-text-options text-image.json` (which selects `generateText`):

```json
{
  "maxOutputTokens": 4096,
  "tools": {
    "image_generation": {
      "type": "provider",
      "id": "openai.image_generation",
      "args": { "outputFormat": "webp", "quality": "high" }
    }
  }
}
```

```bash
ai image -m openai/gpt-5.5 "draw a lighthouse" --generate-text-options text-image.json --json -o ./renders/
```

The file also accepts SDK `system`, `temperature`, `topP`, `topK`,
`presencePenalty`, `frequencyPenalty`, `stopSequences`, `reasoning`, `toolChoice`,
and `activeTools`. Tools must be executed by the provider; JavaScript callbacks
and local tool execution require using the SDK directly. Image-tool results,
all returned image files, and accompanying text are retained. Quiver Arrow SVG
output remains supported, including inline previews.

### video

```text
-i, --image <path-or-url>     prompt.image (or pipe one image through stdin)
--frame-images <path>        JSON frameImages array
--input-references <path>    JSON inputReferences array
-n, --n <n>                  Number of videos per model (default: 1)
--max-videos-per-call <n>     SDK batching limit
--aspect-ratio <width:height|adaptive> SDK aspectRatio
--resolution <widthxheight>           SDK resolution, e.g. 1920x1080
--duration <seconds>         Positive duration, including fractional seconds
--fps <number>               Positive frames per second
--generate-audio             Request generated audio
--no-generate-audio          Disable generated audio (unset uses provider default)
--poll-interval-ms <ms>      SDK poll.intervalMs (default: 5000)
--poll-timeout-ms <ms>       SDK poll.timeoutMs (default: --timeout in milliseconds)
--download-max-bytes <bytes> SDK createDownload maxBytes (default: 2 GiB)
```

Use the SDK's exact frame roles in `frames.json`:

```json
[
  { "image": "start.png", "frameType": "first_frame" },
  { "image": "end.png", "frameType": "last_frame" }
]
```

```bash
ai video "a smooth camera move" --frame-images frames.json --duration 5
ai video --image scene.png "animate this" --aspect-ratio adaptive --generate-audio
```

Either frame may be supplied alone. The prompt is optional when image, frame,
or reference inputs are provided. Frame paths accept local paths, `file://`,
HTTP(S), and data URLs. Paths inside JSON files are relative to the working
directory. Use data URLs for inline base64 content.

For reference-to-video generation, `references.json` can contain:

```json
[
  "character.png",
  { "data": "https://example.com/motion.mp4", "mediaType": "video/mp4" }
]
```

```bash
ai video "follow this motion" --input-references references.json --json -o ./clips/
```

Specify `mediaType` for video URLs. SDK precedence rules apply: `frameImages`
replace `inputReferences`, and a `first_frame` replaces `prompt.image`; warnings
are retained in JSON. Duplicate frame roles are rejected locally.

Generation polls the SDK start/status API by default, avoiding a single long-lived
video response. `--timeout` defaults to 600 seconds and bounds generation plus
download; `--poll-timeout-ms` limits the polling stage. `--concurrency` limits
parallel models; `n` and `maxVideosPerCall` control SDK batching within a model.
For multiple SDK calls, JSON output associates each video with its call's response
ID, even if another batch is short or fails. Successful batch diagnostics remain
in `batches`; a short result or failed batch exits nonzero while preserving
returned videos. A failed URL download within a call is recorded in `failures`
without discarding its successfully downloaded siblings. The top-level Gateway
cost fields sum reported costs from completed batches; `batches` keeps each
call's original provider metadata.

To submit a job and return immediately:

```bash
ai video start "a scene" --n 2 --output operation.json
ai video status operation.json
ai video status operation.json --download --output ./clips/
```

`video start` accepts generation/request options and `--webhook-url <url>`.
It prints `{ model, operation, warnings, providerMetadata, response }` as JSON
and optionally saves that same object with `--output`. It accepts one model and
one SDK operation; `n` must fit `maxVideosPerCall`. It does not take polling,
download, preview, or concurrency flags. Keep the operation JSON private: provider
metadata can contain a webhook signing secret. Reuse the same Gateway base URL,
team, and authentication when checking it.

`video status` performs one check and prints SDK `pending`, `completed`, or
`error` status. By default it returns URLs/base64 data without downloading.
`--download` saves completed videos and returns a manifest; `--output` requires
`--download`. Request headers, retries, Gateway connection settings, timeout,
and download limits can be set on status requests too. Provider errors exit 1;
pending operations exit 0 and can be checked again later. If one video download
fails, successful downloads are still saved and `failures` records the error.

Model support determines valid frame/reference combinations, durations,
resolutions, FPS, and audio. Inspect `ai models <model> --json` for native
`video_capabilities`, `modalities`, and `supported_specifications` when supplied
by Gateway. For example, Seedance 2.0 currently advertises 4–15 second clips:
1, 2, or 3 second sections require a different model or trimming. Frame inputs
guide generation and do not guarantee exact frame matching.

### Image/video migration

- `--count` becomes `--n`; `-n` remains. Counts use SDK batching instead of separate one-output jobs.
- Image `--image` becomes `--images`; `-i` remains. Video retains SDK `--image`.
- Video `--start-frame` / `--end-frame` become `--frame-images` with `first_frame` / `last_frame` JSON entries.
- Image `--quality` / `--style` move to their provider's JSON options. DALL·E's `standard`/`hd` and `vivid`/`natural` values are not universal image settings.
- Image/video JSON uses `elapsedMs`, per-model results, `images`/`videos` artifact arrays, and SDK diagnostics. Multiple outputs always go to separate files, including when stdout is piped. Use `--json` for a machine-readable manifest.

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
--json                   JSON including native Gateway capabilities and metadata
--base-url <url>         Gateway baseURL
--team-id-or-slug <team> Gateway teamIdOrSlug
--headers <path>         JSON HTTP headers
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

When running in a terminal that supports the [Kitty graphics protocol](https://sw.kovidgoyal.net/kitty/graphics-protocol/) (Kitty, Ghostty, WezTerm, Warp, iTerm2), generated images and videos are displayed inline automatically. Image formats returned by models are preserved on disk and converted to PNG for terminal previews when needed. SVG previews use a 512-pixel long edge and an opaque white background. Video previews decode an H.264 keyframe from the midpoint of the video using [openh264](https://github.com/cisco/openh264) compiled to WebAssembly — no native dependencies required. `audio speak` can also play generated speech and render a terminal waveform after saving. Use `--no-preview` for image/video previews, `--no-play` or `--no-waveform` for audio previews, or set `AI_CLI_PREVIEW=1` to force visual previews on in undetected terminals.

### Output Behavior

- **evaluate**: the SDK evaluation result as JSON on stdout, including typed answers, usage, provider metadata, and response information
- **text**: saves to `<id>.md` (interactive), stdout when piped
- **image/video**: saves every artifact using its returned media type (PNG, WebP, SVG, MP4, WebM, etc.). A single artifact writes raw bytes when piped; multiple artifacts always use separate files. `--json` includes all artifacts, accompanying text, usage, warnings, responses, and provider metadata when available
- **audio speak**: saves to `<id>.mp3` (interactive), raw binary stdout when piped
- **audio transcribe**: saves to `<id>.txt` (interactive), stdout when piped
- **`-o <dir>`**: saves inside the directory with auto-generated names

When the CLI needs to choose a filename, it uses a response id when available and falls back to a random 8-character id.

### Environment Variables

| Variable | Description |
|---|---|
| `AI_GATEWAY_API_KEY` | AI Gateway authentication key |
| `AI_GATEWAY_BASE_URL` | Gateway baseURL for image/video generation and model discovery; overridden by `--base-url` |
| `AI_GATEWAY_TEAM_ID_OR_SLUG` | Gateway team for image/video and models; overridden by `--team-id-or-slug` |
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
| `evaluate` | 30 seconds per evaluation request |
| `text` | 120 seconds |
| `image` | 300 seconds |
| `video` | 600 seconds |
| `audio speak` | 120 seconds |
| `audio transcribe` | 120 seconds |

Use `--timeout <seconds>` to override the default for `text`, `image`, `video`, `audio speak`, `audio transcribe`, or `evaluate`. The value must be a positive integer. For example, `ai image --timeout 600 "a detailed sprite atlas"` allows the request to run for up to 10 minutes.

### Exit Codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | Invalid input or request failure; all generations failed |
| `2` | Partial generation failure (some succeeded, some failed) |

## License

[Apache-2.0](LICENSE)

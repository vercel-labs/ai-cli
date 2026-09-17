---
name: ai-cli
description: Generate media and text, and filter, rank, and select records from the terminal using AI models.
---

# ai-cli

Generate media and text, and filter, rank, and select records from the terminal using AI models.

## When to Use

Use when you need to:
- Generate images from text prompts or existing images
- Generate video from text prompts or images
- Generate text (summaries, explanations, code reviews) from prompts or piped content
- Generate speech from text or transcribe audio files and streams
- Compare outputs across multiple models side-by-side
- Filter records by meaning, rank them by a rubric, or pick an existing record using Jev
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

## Video Resolution

Use `--resolution <WxH>` to request a specific video output resolution. Supported resolutions vary by model.

```bash
ai video "a cinematic landscape" --resolution 1920x1080
```

## Key Flags

```
-m, --model <id>       Model ID (provider/name or short name), comma-separated for multi-model
-o, --output <path>    Output file or directory
-n, --count <n>        Number of generations per model
-q, --quiet            Suppress progress output
--json                 Output structured metadata as JSON (paths, timing, success/failure)
--timeout <seconds>    Request timeout in seconds (see Timeouts for per-command defaults)
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

## Decisions

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

- **Decision commands**: selected records on stdout in both terminals and pipes; `--json` includes inline records and evaluation metadata
- **Generation, interactive (TTY)**: saves to file, prints path to stderr
- **Piped (non-TTY)**: writes raw content to stdout for chaining
- **`-o <dir>`**: saves inside directory with auto-generated names

When the CLI chooses a filename, it uses a response ID when available and falls back to a random 8-character ID, such as `resp_abc123.png` or `7f3a9c1d.mp3`.

**Important for agents**: Always use `-o` to save to a file when generating images, video, or speech audio. Without `-o` in a non-TTY context, raw binary data is written to stdout, which wastes context and is not useful for agents. Use `-o output.png`, `-o speech.mp3`, or an output directory and read the file path from `--json` output instead.

## Timeouts

- filter/rank/pick: 30 seconds per evaluation request
- text: 120 seconds
- image: 300 seconds
- video: 300 seconds
- audio speak: 120 seconds
- audio transcribe: 120 seconds

Override with `--timeout <seconds>` when a prompt legitimately needs longer, instead of dropping to a faster model variant that changes the output:

```bash
ai image "a 72-cell sprite atlas, detailed" --timeout 600
```

The value is in seconds, not milliseconds, and is capped at 2147483.

## Exit Codes

- `0` — success
- `1` — invalid input or request failure; all generations failed
- `2` — partial generation failure (some succeeded)
- `3` — pick found no matching record
- `4` — pick is uncertain, or filter is uncertain with --on-uncertain error

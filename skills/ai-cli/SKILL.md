---
name: ai-cli
description: Use the AI SDK from the terminal to generate media and text and evaluate typed questions.
---

# ai-cli

Use the AI SDK from the terminal to generate media and text and evaluate typed questions.

## When to Use

Use when you need to:
- Generate images from text prompts or existing images
- Generate video from text prompts or images
- Generate text (summaries, explanations, code reviews) from prompts or piped content
- Generate speech from text or transcribe audio files and streams
- Compare outputs across multiple models side-by-side
- Ask Boolean, Choice, and Score questions using AI SDK evaluation models
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

Generation commands support:

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

## Evaluate

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

## Structured Output

Generation commands use `--json` to get machine-readable results; `evaluate` always returns JSON:

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

- **evaluate**: the SDK evaluation result as JSON on stdout, including typed answers, usage, provider metadata, and response information
- **Generation, interactive (TTY)**: saves to file, prints path to stderr
- **Piped (non-TTY)**: writes raw content to stdout for chaining
- **`-o <dir>`**: saves inside directory with auto-generated names

When the CLI chooses a filename, it uses a response ID when available and falls back to a random 8-character ID, such as `resp_abc123.png` or `7f3a9c1d.mp3`.

**Important for agents**: Always use `-o` to save to a file when generating images, video, or speech audio. Without `-o` in a non-TTY context, raw binary data is written to stdout, which wastes context and is not useful for agents. Use `-o output.png`, `-o speech.mp3`, or an output directory and read the file path from `--json` output instead.

## Timeouts

- evaluate: 30 seconds including evaluation retries
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

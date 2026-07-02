# Changelog

## 0.4.1

<!-- release:start -->

### Bug Fixes

- **Aspect ratio for language-image models** - `--aspect-ratio` is now forwarded to Google language-image models like `google/gemini-2.5-flash-image`, which previously always generated 1:1 output; `--size` now warns when passed to these models instead of being silently ignored (#72)

### Contributors

- @ctate

<!-- release:end -->

## 0.4.0

<!-- release:start -->

### New Features

- **Audio commands** - `ai audio speak` generates speech from text and `ai audio transcribe` transcribes local files, URLs and piped audio (#66)
- **Audio playback previews** - generated speech plays automatically in interactive terminals with accurate waveform previews and opt-out flags (#68)

### Improvements

- **Longer image timeout** - image generation requests now use a 300-second timeout to better accommodate slower models (#64)

### Bug Fixes

- **Metadata-only JSON output** - `--json` keeps stdout parseable by forcing generated artifacts to files and disabling previews (#67)

### Contributors

- @atinux
- @piotrjoniec
- @ctate

<!-- release:end -->

## 0.3.1

<!-- release:start -->

### New Features

- **Video image inputs** — `ai video` now accepts `--image` / `-i` image inputs from local paths, `file://` URLs, `http(s)://` URLs and data URLs (#57)

### Improvements

- **Default output filenames** — generated text, image and video files now use response IDs when available and random 8-character IDs otherwise, replacing generic `output.*` filenames (#59)
- **Agent setup cleanup** — removed outdated opensrc references from local agent configuration (#58)

### Contributors

- @ctate

<!-- release:end -->

## 0.3.0

<!-- release:start -->

### New Features

- **Reference image inputs** — `ai image` and `ai text` now accept repeatable `--image` references from local paths, `file://` URLs, `http(s)://` URLs and data URLs
- **Vision stdin detection** — `ai text` can distinguish piped image bytes from piped text, enabling image prompts from stdin without treating binary data as prompt text

### Contributors

- @ctate

<!-- release:end -->

## 0.2.1

<!-- release:start -->

### Bug Fixes

- **Published CLI binary** — packages `ai` as a Node-targeted `dist/index.js` bundle and points npm's `bin`/`files` metadata at `dist`, fixing global installs that could not execute the TypeScript source (#52)

### Improvements

- **Node engine requirement** — declares and documents the Node.js 20+ runtime requirement for the CLI package (#52)

### Contributors

- @ctate

<!-- release:end -->

## 0.2.0

<!-- release:start -->

### New Features

- **Dynamic model discovery** — replaced hardcoded fallback model lists with live fetches from the AI Gateway API, so new models are available immediately without a CLI update (#48)
- **Model capabilities & metadata** — `ai models` now shows creator, capabilities, and pricing info for each model (#48)
- **Language-image model routing** — language models tagged with `image-generation` (e.g. Gemini) are automatically detected and routed through `generateText` instead of `generateImage` (#48)
- **Stdin image support for language-image models** — piping an image via stdin to a language-based image model now correctly passes the image data via the messages API (#48)

### Improvements

- **`--provider` renamed to `--creator`** — aligns with the AI Gateway's creator/model-name convention and reserves `--provider` for future multi-provider support (#48)
- **Deduplicated `--json` output** — `ai models --json` now returns a flat array where each model appears once with all its capabilities (#48)
- **Gateway fetch resilience** — failed gateway fetches are no longer permanently cached, so retries work correctly; requests time out after 5 seconds (#48)
- **Documentation overhaul** — filled gaps across README, web docs, and added a SKILL.md for agent integration (#42)
- **Favicon & OG images** — added favicon and Open Graph image generation to the web app (#40)
- **OG card refresh** — updated OG card to match the portless design and removed outdated tagline (#41)

### Bug Fixes

- **Mobile responsive overflow** — fixed layout overflow on the landing page for mobile viewports (#47)

### Breaking Changes

- **`ai completions` removed** — the shell completions command has been removed (#48)
- **`--provider` flag renamed to `--creator`** — update any scripts using `--provider` to use `--creator` instead (#48)

### Contributors

- @ctate
- @dancer

<!-- release:end -->

## 0.1.1

<!-- release:start -->

### Improvements

- **npm README** — replaced symlink with a real file so the README renders correctly on the npm registry (#38)

### Contributors

- @ctate

<!-- release:end -->

## 0.1.0

- Initial release of the new `ai-cli` — a lightweight, agent-native CLI for generating text, images, and video
- Commands: `ai text`, `ai image`, `ai video`, `ai models`, `ai completions`
- Multi-model comparison via comma-separated `-m` flag
- Inline terminal preview for images and video (Kitty graphics protocol)
- H.264 keyframe decoding via OpenH264 WASM — no native dependencies required
- Stdin piping support for chaining commands
- Shell completions for bash, zsh, and fish

<!-- release:end -->

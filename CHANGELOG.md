# Changelog

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

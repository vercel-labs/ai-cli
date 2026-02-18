# ai-cli

minimal terminal AI assistant

## structure

```
apps/
  cli/            # the ai-cli package (npm)
packages/
  typescript-config/  # shared tsconfig
```

See [apps/cli/README.md](apps/cli/README.md) for CLI usage, commands, and configuration.

## development

### prerequisites

- [Bun](https://bun.sh) (v1.3.9+)
- Node.js 18+

### setup

```bash
bun install
```

### scripts

```bash
bun run build       # build all packages
bun run test        # run tests
bun run typecheck   # type check
bun run lint        # lint
bun run format      # format
bun run check       # lint + format check
```

### running the CLI locally

```bash
cd apps/cli
bun run build
node dist/ai.mjs
```

### testing

```bash
bun run test              # unit tests (all packages)
bun run test:e2e          # e2e tests (requires API key)
  --cwd apps/cli
```

Unit tests use `bun:test`. E2E tests require `AI_GATEWAY_API_KEY` set and are not run in CI.

### git hooks

```bash
git config core.hooksPath .githooks
```

This enables the pre-commit hook that auto-formats with Biome.

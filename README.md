# ai-cli

minimal terminal AI assistant

## structure

```
packages/
  ai-cli/               # the ai-cli package
  typescript-config/     # shared tsconfig
apps/
  web/                   # docs site
```

See [packages/ai-cli/README.md](packages/ai-cli/README.md) for CLI usage, commands, and configuration.

## development

### prerequisites

- [Bun](https://bun.sh) (v1.3.9+)

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
```

### running the CLI locally

```bash
cd packages/ai-cli
bun run dev          # run directly via bun
bun run build        # compile to dist/ai binary
./dist/ai
```

### testing

```bash
bun run test         # unit tests (all packages)
```

Unit tests use `bun:test`.

### git hooks

```bash
git config core.hooksPath .githooks
```

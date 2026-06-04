# AGENTS.md

## Monorepo Structure

This is a Turborepo monorepo. The CLI application lives in `packages/ai-cli/` and shared configuration packages live in `packages/`.

## Package Manager

Use **bun** for all package management and script execution:

- `bun install` to install dependencies
- `bun add <package>` to add a dependency (use `--cwd packages/ai-cli` to target the CLI package)
- `bun add -d <package>` to add a dev dependency
- `bun run <script>` to run package.json scripts
- `bun test` to run tests

## Installing Packages

Before installing any npm package, always check the latest version first:

```sh
npm view <package> version
```

Then install that specific version (e.g. `bun add --cwd packages/ai-cli <package>@<version>`). Never blindly install without verifying the latest version.

## Documentation

When making any user-facing change (new command, new flag, changed behavior, renamed option, etc.), update the documentation in `packages/ai-cli/README.md` in the same PR. A user-facing change without a docs update is incomplete.

## Type Checking

Run the type checker after every agent turn:

```sh
bun run typecheck
```

This runs `turbo run typecheck` across all workspaces and ensures no type errors have been introduced. Fix any type errors before moving on.

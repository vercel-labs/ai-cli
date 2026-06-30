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

When making any user-facing change (new command, new flag, changed behavior, renamed option, release note, website copy change, etc.), update every relevant user-facing documentation surface in the same PR:

- `packages/ai-cli/README.md` for the npm/package README
- `apps/web/docs/` for website documentation
- `apps/web/components/landing/` and other website copy when the landing page or marketing copy should reflect the change
- `CHANGELOG.md` for release-facing changes

A user-facing change without matching README and website/docs updates is incomplete.

## Type Checking

Run the type checker after every agent turn:

```sh
bun run typecheck
```

This runs `turbo run typecheck` across all workspaces and ensures no type errors have been introduced. Fix any type errors before moving on.

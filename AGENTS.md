# AGENTS.md

## Package Manager

Use **bun** for all package management and script execution:

- `bun install` to install dependencies
- `bun add <package>` to add a dependency
- `bun add -d <package>` to add a dev dependency
- `bun run <script>` to run package.json scripts
- `bun test` to run tests

## Installing Packages

Before installing any npm package, always check the latest version first:

```sh
npm view <package> version
```

Then install that specific version (e.g. `bun add <package>@<version>`). Never blindly install without verifying the latest version.

## Type Checking

Run the type checker after every agent turn:

```sh
bun run typecheck
```

This runs `tsc --noEmit` and ensures no type errors have been introduced. Fix any type errors before moving on.

# AGENTS.md

## Monorepo Structure

This is a Turborepo monorepo. The CLI application lives in `apps/cli/` and shared configuration packages live in `packages/`.

## Package Manager

Use **bun** for all package management and script execution:

- `bun install` to install dependencies
- `bun add <package>` to add a dependency (use `--cwd apps/cli` to target the CLI app)
- `bun add -d <package>` to add a dev dependency
- `bun run <script>` to run package.json scripts
- `bun test` to run tests

## Installing Packages

Before installing any npm package, always check the latest version first:

```sh
npm view <package> version
```

Then install that specific version (e.g. `bun add --cwd apps/cli <package>@<version>`). Never blindly install without verifying the latest version.

## Type Checking

Run the type checker after every agent turn:

```sh
bun run typecheck
```

This runs `turbo run typecheck` across all workspaces and ensures no type errors have been introduced. Fix any type errors before moving on.

<!-- opensrc:start -->

## Source Code Reference

Source code for dependencies is available in `opensrc/` for deeper understanding of implementation details.

See `opensrc/sources.json` for the list of available packages and their versions.

Use this source code when you need to understand how a package works internally, not just its types/interface.

### Fetching Additional Source Code

To fetch source code for a package or repository you need to understand, run:

```bash
npx opensrc <package>           # npm package (e.g., npx opensrc zod)
npx opensrc pypi:<package>      # Python package (e.g., npx opensrc pypi:requests)
npx opensrc crates:<package>    # Rust crate (e.g., npx opensrc crates:serde)
npx opensrc <owner>/<repo>      # GitHub repo (e.g., npx opensrc vercel/ai)
```

<!-- opensrc:end -->

# Contributing

We welcome issues, bug reports, feature requests, and design feedback from the community.

Pull requests are limited to collaborators. We keep implementation and merge ownership with collaborators so we can manage security review, roadmap fit, release timing, and maintenance responsibility consistently.

If you have a proposed change, please open an issue instead of a pull request. Include:

- The problem you are trying to solve
- Relevant context or reproduction steps
- Suggested behavior or implementation notes, if helpful

Maintainers will review issues and handle code changes through the pull request process.

Issue templates ask whether you would like to be listed as a co-contributor if a pull request is created and merged as a result of your issue.

## Issues

Before opening an issue, please search existing issues to avoid duplicates.

Use the issue template that best matches your report:

- **Bug report** for broken or unexpected behavior
- **Feature request** for new capabilities or changes to existing behavior
- **Change proposal** for implementation ideas that would otherwise have been a pull request

Do not include API keys, tokens, credentials, private data, or other sensitive information in issues.

## Development

Use Node.js 24+ (see `.node-version`) and npm to work on this monorepo. The published CLI requires Node.js 22+.

From the repository root:

```bash
npm ci
npm run typecheck
npm run format:check
npm run lint
npm test
npm run build
```

Run the CLI from source with `npm run dev --workspace ai-cli -- --help`, or start the documentation website with `npm run dev --workspace @ai-cli/web`.

Tests use Vitest on Node.js. CLI builds use esbuild and copy the OpenH264 WebAssembly asset into `dist/` for terminal video previews.

Linting and formatting use Oxlint and Oxfmt directly. Run `npm run format` to format CLI sources, or `npm run lint -- -- --fix` to apply automatic lint fixes. The optional pre-commit hook in `.githooks/` runs the workspace formatter; enable it with `git config core.hooksPath .githooks`.

Before adding a dependency, check its latest version with `npm view <package> version`, then install the specific version with `npm install --save-exact --workspace ai-cli <package>@<version>` (add `-D` for a development dependency). Commit the updated `package-lock.json` with dependency changes.

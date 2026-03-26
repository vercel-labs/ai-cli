#!/usr/bin/env node

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { build } from "esbuild";

const packageJson = JSON.parse(readFileSync("./package.json", "utf8"));

mkdirSync("dist", { recursive: true });

await build({
	entryPoints: ["src/index.ts"],
	bundle: true,
	platform: "node",
	target: ["node18", "node20", "node22"],
	format: "esm",
	outfile: "dist/ai.mjs",
	external: [],
	minify: true,
	sourcemap: false,
	banner: {
		js: `import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
	},
	define: {
		__VERSION__: JSON.stringify(packageJson.version),
	},
	alias: {
		"react-devtools-core": "./src/stubs/devtools.js",
	},
});

const content = readFileSync("dist/ai.mjs", "utf8");
writeFileSync("dist/ai.mjs", `#!/usr/bin/env node\n${content}`);
chmodSync("dist/ai.mjs", 0o755);

console.log("build completed successfully");

#!/usr/bin/env node

import { build } from 'esbuild'
import { readFileSync, mkdirSync, chmodSync } from 'fs'

const packageJson = JSON.parse(readFileSync('./package.json', 'utf-8'))

// ensure dist directory exists
mkdirSync('dist', { recursive: true })

await build({
  entryPoints: ['aix.mts'],
  bundle: true,
  platform: 'node',
  target: ['node18', 'node20', 'node22'],
  format: 'esm',
  outfile: 'dist/aix.mjs',
  banner: {
    js: '#!/usr/bin/env node'
  },
  external: [],
  minify: true,
  sourcemap: false,
  define: {
    '__VERSION__': JSON.stringify(packageJson.version)
  }
})

chmodSync('dist/aix.mjs', 0o755)

console.log('build completed successfully')
#!/usr/bin/env node

import { build } from 'esbuild'
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'fs'

const packageJson = JSON.parse(readFileSync('./package.json', 'utf-8'))

mkdirSync('dist', { recursive: true })

await build({
  entryPoints: ['ai.mts'],
  bundle: true,
  platform: 'node',
  target: ['node18', 'node20', 'node22'],
  format: 'esm',
  outfile: 'dist/ai.mjs',
  packages: 'bundle',
  minify: true,
  sourcemap: false,
  define: {
    '__VERSION__': JSON.stringify(packageJson.version)
  }
})

const content = readFileSync('dist/ai.mjs', 'utf-8')
writeFileSync('dist/ai.mjs', '#!/usr/bin/env node\n' + content)
chmodSync('dist/ai.mjs', 0o755)

console.log('build completed successfully')
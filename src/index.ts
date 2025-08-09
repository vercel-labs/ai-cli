import arg from 'arg'
import { getApiKey } from './config/index.js'
import { initCommand } from './commands/init.js'
import { chatCommand } from './commands/chat.js'
import { readStdin, showHelp } from './utils/index.js'

// @ts-ignore - defined by esbuild
const version = typeof __VERSION__ !== 'undefined' ? __VERSION__ : '0.0.1'

async function main() {
  let args: any
  try {
    args = arg({
      '--model': String,
      '--help': Boolean,
      '-m': '--model',
      '-h': '--help'
    })
  } catch (err: any) {
    console.error(err.message)
    process.exit(1)
  }

  if (args['--help']) {
    showHelp()
    process.exit(0)
  }

  if (args._.includes('init')) {
    await initCommand()
    return
  }

  const apiKey = getApiKey()
  if (!apiKey) {
    console.error('no key. run: ai init')
    process.exit(1)
  }

  process.env.AI_GATEWAY_API_KEY = apiKey

  let message = args._.join(' ')
  
  if (!message) {
    if (!process.stdin.isTTY) {
      message = await readStdin()
    }
    
    if (!message) {
      console.error('no message')
      process.exit(1)
    }
  }

  await chatCommand({
    message,
    model: args['--model'],
    isPiped: !process.stdout.isTTY,
    version
  })
}

main().catch(error => {
  console.error('error:', error instanceof Error ? error.message : 'unknown')
  process.exit(1)
})
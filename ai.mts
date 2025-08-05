import { streamText } from 'ai'
import arg from 'arg'
import { gray } from 'yoctocolors'

// @ts-ignore - defined by esbuild
const version = typeof __VERSION__ !== 'undefined' ? __VERSION__ : '0.1.1'

async function main() {
  if (!process.env.AI_GATEWAY_API_KEY) {
    console.error('Error: AI_GATEWAY_API_KEY environment variable is not set')
    console.error('Please visit https://vercel.com/docs/ai-gateway to get your API key')
    process.exit(1)
  }

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
    console.log(`ai - AI-powered chat interface

Usage:
  ai [options] <message>
  ai -m <model> <message>

Options:
  -m, --model   Specify AI model (default: openai/gpt-oss-120b)
  -h, --help    Show this help message

Examples:
  ai "whats up bro"
  ai -m openai/gpt-oss-120b "hello world"
  ai hello`)
    process.exit(0)
  }

  const message = args._.join(' ')
  if (!message) {
    console.error('Error: Please provide a message')
    console.error('Usage: ai <message>')
    process.exit(1)
  }

  const model = args['--model'] || 'openai/gpt-oss-120b'

  console.log(gray(`ai ${version} [${model}]`))
  
  try {
    const result = await streamText({
      model: model,
      prompt: message,
    })

    for await (const chunk of result.textStream) {
      process.stdout.write(chunk)
    }
    console.log()
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : 'Unknown error')
    process.exit(1)
  }
}

main().catch(error => {
  console.error('Error:', error instanceof Error ? error.message : 'Unknown error')
  process.exit(1)
})
import { streamText } from 'ai'
import arg from 'arg'
import { gray, dim } from 'yoctocolors'
import ora from 'ora'

// @ts-ignore - defined by esbuild
const version = typeof __VERSION__ !== 'undefined' ? __VERSION__ : '0.0.1'

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
  -m, --model   Specify AI model (default: openai/gpt-5)
  -h, --help    Show this help message

Examples:
  ai "whats up bro"
  ai -m openai/gpt-5 "hello world"
  ai hello`)
    process.exit(0)
  }

  let message = args._.join(' ')
  
  if (!message) {
    if (!process.stdin.isTTY) {
      const chunks: string[] = []
      for await (const chunk of process.stdin) {
        chunks.push(chunk.toString())
      }
      message = chunks.join('').trim()
    }
    
    if (!message) {
      console.error('Error: Please provide a message')
      console.error('Usage: ai <message>')
      process.exit(1)
    }
  }

  const model = args['--model'] || 'openai/gpt-5'
  const isPiped = !process.stdout.isTTY

  if (!isPiped) {
    console.log(gray(`ai ${version} [${model}]`))
  }
  
  try {
    let thinkingBuffer = ''
    let hasSeenContent = false
    let spinner: any = null
    let lastLength = 0

    if (!isPiped) {
      spinner = ora({
        text: dim('Thinking...'),
        color: 'gray',
        spinner: 'dots'
      }).start()
    }

    const result = streamText({
      model: model,
      prompt: message,
      providerOptions: {
        openai: {
          reasoningEffort: 'high',
          reasoningSummary: 'detailed'
        }
      }
    })

    for await (const part of result.fullStream) {
      if (part.type === 'reasoning-delta' && part.text) {
        thinkingBuffer += part.text
        
        if (spinner && thinkingBuffer) {
          const cleaned = thinkingBuffer.replace(/\s+/g, ' ').trim()
          const termWidth = process.stdout.columns || 80
          const maxWidth = termWidth - 4
          
          if (cleaned.length <= maxWidth) {
            spinner.text = dim(cleaned)
          } else {
            const start = Math.max(0, cleaned.length - maxWidth)
            const window = cleaned.substring(start, start + maxWidth)
            spinner.text = dim(window)
          }
          
          lastLength = cleaned.length
        }
      } else if (part.type === 'text-delta') {
        if (!hasSeenContent) {
          hasSeenContent = true
          if (spinner) {
            spinner.stop()
            spinner = null
          }
        }
        process.stdout.write(part.text)
      }
    }

    if (spinner) {
      spinner.stop()
    }
    
    if (!isPiped) {
      console.log()
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : 'Unknown error')
    process.exit(1)
  }
}

main().catch(error => {
  console.error('Error:', error instanceof Error ? error.message : 'Unknown error')
  process.exit(1)
})
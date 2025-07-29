#!/usr/bin/env node

import { generateObject } from 'ai'
import { z } from 'zod'
import { spawn } from 'child_process'
import { red, bold, gray, dim } from 'yoctocolors'
import arg from 'arg'

const DangerLevel = z.enum(['harmless', 'dangerous', 'ultra'])
type DangerLevel = z.infer<typeof DangerLevel>

const commandSchema = z.object({
  command: z.string().describe('The suggested command to run'),
  description: z.string().describe('Brief description of what the command does'),
  danger: DangerLevel.describe('Danger level: harmless (safe read-only), dangerous (potentially destructive), ultra (irreversibly destructive like rm -rf /)')
})

const THINKING_TEXT = 'Thinking'
const GRADIENT_WIDTH = 8
const ANIMATION_SPEED = 90

class ThinkingLoader {
  private intervalId: NodeJS.Timeout | null = null
  private position = 0

  start() {
    this.intervalId = setInterval(() => {
      this.render()
      this.position = (this.position + 1) % (THINKING_TEXT.length + GRADIENT_WIDTH)
    }, ANIMATION_SPEED)
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    process.stdout.write('\r\x1b[K')
  }

  private render() {
    let output = ''
    
    for (let i = 0; i < THINKING_TEXT.length; i++) {
      const char = THINKING_TEXT[i]
      const distanceFromGradient = Math.abs(i - this.position)
      
      if (distanceFromGradient < GRADIENT_WIDTH / 2) {
        const intensity = 1 - (distanceFromGradient / (GRADIENT_WIDTH / 2))
        const grayValue = Math.floor(100 + intensity * 155)
        output += `\x1b[38;5;${this.grayToAnsi(grayValue)}m${char}\x1b[0m`
      } else {
        output += `\x1b[90m${char}\x1b[0m`
      }
    }
    
    process.stdout.write(`\r${output}`)
  }

  private grayToAnsi(grayValue: number): number {
    return Math.floor(232 + (grayValue / 255) * 23)
  }
}

async function readUserInput(danger: DangerLevel): Promise<string> {
  return new Promise((resolve) => {
    let buffer = ''
    
    const onData = (chunk: Buffer) => {
      const char = chunk.toString()
      
      // Handle Ctrl+C
      if (char === '\u0003') {
        process.stdin.setRawMode?.(false)
        process.stdout.write('\n')
        process.exit(0)
      }
      
      // Handle backspace
      if (char === '\u007f' || char === '\b') {
        if (buffer.length > 0) {
          buffer = buffer.slice(0, -1)
          process.stdout.write('\b \b') // Move back, write space, move back again
        }
        return
      }
      
      // Handle 'n' or 'N' - immediate abort
      if (char.toLowerCase() === 'n') {
        process.stdin.removeListener('data', onData)
        process.stdin.setRawMode?.(false)
        resolve('n')
        return
      }
      
      // Handle 'y' - immediate accept in harmless mode
      if (danger === 'harmless' && char.toLowerCase() === 'y') {
        process.stdin.removeListener('data', onData)
        process.stdin.setRawMode?.(false)
        resolve('y')
        return
      }
      
      // Handle Enter
      if (char === '\r' || char === '\n') {
        process.stdin.removeListener('data', onData)
        process.stdin.setRawMode?.(false)
        // Only echo newline if user typed 'y' (will run command)
        if (buffer.toLowerCase() === 'y') {
          process.stdout.write('\n')
        }
        resolve(buffer || 'n') // Empty buffer treated as 'n'
        return
      }
      
      // Accumulate other characters
      if (char !== '\r' && char !== '\n') {
        buffer += char
        process.stdout.write(char) // Echo the character
      }
    }
    
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true)
    }
    process.stdin.resume()
    process.stdin.on('data', onData)
  })
}

async function promptAndExecute(command: string, danger: DangerLevel, autoAccept: boolean): Promise<void> {
  // Ultra dangerous commands - don't even prompt
  if (danger === 'ultra') {
    const styledCommand = red(bold(command))
    console.log(`${styledCommand} ${red('[BLOCKED]')}`)
    console.log(red('This command is irreversibly destructive and cannot be executed'))
    process.exit(1)
  }
  
  // Auto-accept harmless commands if -y flag is set
  if (autoAccept && danger === 'harmless') {
    const styledCommand = bold(command)
    console.log(`${styledCommand} ${gray('[auto-accepted]')}`)
    executeCommand(command)
    return
  }
  
  const styledCommand = danger === 'dangerous' ? red(bold(command)) : bold(command)
  const prompt = `${styledCommand} ${gray('[yN]')} `
  
  process.stdout.write(prompt)
  
  const answer = await readUserInput(danger)
  
  if (answer.toLowerCase() === 'y') {
    if (danger === 'harmless') {
      console.log('') // newline for harmless commands
    }
    executeCommand(command)
  } else {
    console.log(gray('aborted'))
    process.exit(0)
  }
}

function executeCommand(command: string) {
  const shell = process.env.SHELL || '/bin/bash'
  
  // Use script command to provide a TTY for interactive shell with aliases
  const scriptCmd = process.platform === 'darwin' 
    ? ['script', '-q', '/dev/null', shell, '-i', '-c', command]
    : ['script', '-qc', `${shell} -i -c "${command}"`, '/dev/null']
  
  const child = spawn(scriptCmd[0], scriptCmd.slice(1), {
    stdio: 'inherit'
  })
  
  child.on('exit', (code) => {
    process.exit(code || 0)
  })
  
  child.on('error', (err) => {
    console.error('Failed to execute command:', err)
    process.exit(1)
  })
}

// Check for AI_GATEWAY_API_KEY early
if (!process.env.AI_GATEWAY_API_KEY) {
  console.error('Error: AI_GATEWAY_API_KEY environment variable is not set')
  console.error('Please visit https://vercel.com/docs/ai-gateway to get your API key')
  process.exit(1)
}

// Check for AIX_DANGEROUSLY_USE_ALPHA environment variable
if (process.env.AIX_DANGEROUSLY_USE_ALPHA !== '1') {
  console.error('Error: aix is in alpha and requires explicit opt-in')
  console.error('Set AIX_DANGEROUSLY_USE_ALPHA=1 to use this tool')
  console.error('⚠️  WARNING: This is alpha software - use with care and review all output')
  process.exit(1)
}

const packageJson = JSON.parse(await import('fs').then(fs => fs.promises.readFile(new URL('package.json', import.meta.url), 'utf-8')))
const version = packageJson.version || '0.0.1'

// Parse arguments
let args: any
try {
  args = arg({
    '--yes': Boolean,
    '--model': String,
    '--help': Boolean,
    '--debug': Boolean,
    '-y': '--yes',
    '-m': '--model',
    '-h': '--help'
  })
} catch (err: any) {
  console.error(err.message)
  process.exit(1)
}

// Show help
if (args['--help']) {
  console.log(`aix ${version} - AI-powered command line interface

Usage:
  aix [options] <prompt>

Options:
  -y, --yes     Auto-accept harmless commands without prompting
  -m, --model   Specify AI model (default: claude-4-sonnet)
  -h, --help    Show this help message
  --debug       Show debug information

Examples:
  aix list files
  aix -y show git status
  aix -m openai/4o create a new directory

Environment:
  AI_GATEWAY_API_KEY    Required. Get yours at https://vercel.com/docs/ai-gateway`)
  process.exit(0)
}

const prompt = args._.join(' ')
if (!prompt) {
  console.error('Error: No prompt provided')
  console.error('Usage: aix [options] <prompt>')
  console.error('Try: aix --help')
  process.exit(1)
}

const model = args['--model'] || 'anthropic/claude-4-sonnet'
const autoAccept = args['--yes'] || false
const isDebug = args['--debug'] || false

// Print version info
console.log(`\x1b[38;5;245maix ${version} (${model})\x1b[0m`)

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  process.stdout.write('\n')
  process.exit(0)
})

const loader = new ThinkingLoader()
loader.start()

try {
  const { object } = await generateObject({
    model: model,
    schema: commandSchema,
    prompt: `Given this natural language request: "${prompt}"
    
Suggest the most appropriate command line command to accomplish this task. Consider common shell commands, git commands, npm/yarn commands, and other standard CLI tools.

Examples:
- "list files" → "ls" (harmless)
- "show git status" → "git status" (harmless)
- "install dependencies" → "npm install" (harmless)
- "delete node_modules" → "rm -rf node_modules" (dangerous)
- "remove all files" → "rm -rf /" (ultra)

Categorize the danger level:
- harmless: Safe read-only commands or commands that don't modify important data
- dangerous: Commands that delete files, modify system settings, or could cause data loss if misused
- ultra: Irreversibly destructive commands like "rm -rf /", "dd if=/dev/zero of=/dev/sda", format commands, or commands that would destroy the entire system or critical data

Provide a brief description of what the command does.`,
  })

  loader.stop()
  
  if (isDebug) {
    console.log('Debug - LLM Response:', JSON.stringify(object, null, 2))
  }
  
  await promptAndExecute(object.command, object.danger, autoAccept)
} catch (error) {
  loader.stop()
  console.error('Error:', error instanceof Error ? error.message : 'Unknown error')
  process.exit(1)
}

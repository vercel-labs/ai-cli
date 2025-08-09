import { createInterface } from 'readline'
import { setApiKey } from '../config/index.js'

const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

async function validateApiKey(apiKey: string): Promise<boolean> {
  try {
    const response = await fetch('https://ai-gateway.vercel.sh/v1/ai/language-model', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'ai-gateway-protocol-version': '0.0.1',
        'ai-model-id': 'openai/gpt-4o-mini',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'test' }] }],
        maxTokens: 1
      })
    })
    return response.status !== 401
  } catch {
    return false
  }
}

export async function initCommand(): Promise<void> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  })

  const apiKey = await new Promise<string>((resolve) => {
    rl.question('► api key: ', (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })

  if (!apiKey) {
    console.error('key required')
    process.exit(1)
  }

  // Show loading animation while validating
  let frame = 0
  const interval = setInterval(() => {
    process.stdout.write(`\r${spinnerFrames[frame]} validating...`)
    frame = (frame + 1) % spinnerFrames.length
  }, 80)

  const isValid = await validateApiKey(apiKey)
  clearInterval(interval)
  process.stdout.write('\r\x1b[K')

  if (!isValid) {
    console.error('✗ invalid key')
    process.exit(1)
  }

  try {
    setApiKey(apiKey)
    console.log('✓ saved')
  } catch (error) {
    console.error('✗ failed to save')
    process.exit(1)
  }
}
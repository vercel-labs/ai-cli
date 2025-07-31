import { generateObject, generateText, tool, stepCountIs } from 'ai'
import { z } from 'zod'
import { spawn } from 'child_process'
import { red, bold, gray } from 'yoctocolors'
import arg from 'arg'
import { writeFile, readFile } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { createInterface } from 'readline'
import { existsSync } from 'fs'

const DangerLevel = z.enum(['harmless', 'dangerous', 'ultra'])
type DangerLevel = z.infer<typeof DangerLevel>

const commandSchema = z.object({
  command: z.string().describe('The suggested command to run'),
  description: z.string().describe('Brief description of what the command does'),
  danger: DangerLevel.describe('Danger level: harmless (safe read-only), dangerous (potentially destructive), ultra (irreversibly destructive like rm -rf /)'),
  reasoning: z.string().describe('Step-by-step reasoning for why this command was chosen and how it accomplishes the task')
})

const THINKING_TEXT = 'Thinking'
const GRADIENT_WIDTH = 8
const ANIMATION_SPEED = 90

let lastReasoning: string = ''

// Full V4A Patch Implementation (from OpenAI reference)
class DiffError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DiffError'
  }
}

enum ActionType {
  ADD = "add",
  DELETE = "delete", 
  UPDATE = "update"
}

interface FileChange {
  type: ActionType
  old_content?: string
  new_content?: string
  move_path?: string
}

interface Chunk {
  orig_index: number
  del_lines: string[]
  ins_lines: string[]
}

interface PatchAction {
  type: ActionType
  new_file?: string
  chunks: Chunk[]
  move_path?: string
}

class V4AParser {
  private current_files: Record<string, string>
  private lines: string[]
  private index: number = 0
  private patch: Record<string, PatchAction> = {}
  private fuzz: number = 0

  constructor(current_files: Record<string, string>, lines: string[], index: number = 1) {
    this.current_files = current_files
    this.lines = lines
    this.index = index
  }

  private _cur_line(): string {
    if (this.index >= this.lines.length) {
      throw new DiffError("Unexpected end of input while parsing patch")
    }
    return this.lines[this.index]
  }

  static _norm(line: string): string {
    return line.replace(/\r$/, '')
  }

  private is_done(prefixes?: string[]): boolean {
    if (this.index >= this.lines.length) return true
    if (prefixes && prefixes.length > 0) {
      return prefixes.some(prefix => V4AParser._norm(this._cur_line()).startsWith(prefix))
    }
    return false
  }

  private startswith(prefix: string | string[]): boolean {
    const prefixes = Array.isArray(prefix) ? prefix : [prefix]
    return prefixes.some(p => V4AParser._norm(this._cur_line()).startsWith(p))
  }

  private read_str(prefix: string): string {
    if (prefix === "") {
      throw new Error("read_str() requires a non-empty prefix")
    }
    if (V4AParser._norm(this._cur_line()).startsWith(prefix)) {
      const text = this._cur_line().slice(prefix.length)
      this.index += 1
      return text
    }
    return ""
  }

  parse(): Record<string, PatchAction> {
    while (!this.is_done(["*** End Patch"])) {
      // UPDATE
      const update_path = this.read_str("*** Update File: ")
      if (update_path) {
        if (update_path in this.patch) {
          throw new DiffError(`Duplicate update for file: ${update_path}`)
        }
        const move_to = this.read_str("*** Move to: ")
        if (!(update_path in this.current_files)) {
          throw new DiffError(`Update File Error - missing file: ${update_path}`)
        }
        const text = this.current_files[update_path]
        const action = this._parse_update_file(text)
        action.move_path = move_to || undefined
        this.patch[update_path] = action
        continue
      }

      // DELETE  
      const delete_path = this.read_str("*** Delete File: ")
      if (delete_path) {
        if (delete_path in this.patch) {
          throw new DiffError(`Duplicate delete for file: ${delete_path}`)
        }
        if (!(delete_path in this.current_files)) {
          throw new DiffError(`Delete File Error - missing file: ${delete_path}`)
        }
        this.patch[delete_path] = { type: ActionType.DELETE, chunks: [] }
        continue
      }

      // ADD
      const add_path = this.read_str("*** Add File: ")
      if (add_path) {
        if (add_path in this.patch) {
          throw new DiffError(`Duplicate add for file: ${add_path}`)
        }
        if (add_path in this.current_files) {
          throw new DiffError(`Add File Error - file already exists: ${add_path}`)
        }
        this.patch[add_path] = this._parse_add_file()
        continue
      }

      throw new DiffError(`Unknown line while parsing: ${this._cur_line()}`)
    }

    if (!this.startswith("*** End Patch")) {
      throw new DiffError("Missing *** End Patch sentinel")
    }
    this.index += 1

    return this.patch
  }

  private _parse_update_file(text: string): PatchAction {
    const action: PatchAction = { type: ActionType.UPDATE, chunks: [] }
    const lines = text.split('\n')
    let index = 0

    while (!this.is_done([
      "*** End Patch", "*** Update File:", "*** Delete File:", "*** Add File:", "*** End of File"
    ])) {
      const def_str = this.read_str("@@ ")
      
      if (!def_str && index === 0) {
      } else if (!def_str && V4AParser._norm(this._cur_line()) !== "@@") {
        if (!this._cur_line().startsWith("-") && !this._cur_line().startsWith("+") && !this._cur_line().startsWith(" ")) {
          throw new DiffError(`Invalid line in update section:\n${this._cur_line()}`)
        }
      }

      if (def_str.trim()) {
        let found = false
        for (let i = index; i < lines.length; i++) {
          if (lines[i] === def_str || lines[i].trim() === def_str.trim()) {
            index = i + 1
            found = true
            break
          }
        }
        if (!found) {
          this.fuzz += 1
        }
      }

      try {
        const { context, chunks, end_idx } = this.peek_next_section()
        
        if (chunks.length === 0 && context.length === 0) {
          break
        }
        
        const new_index = this.find_context(lines, context, index)
        
        if (new_index === -1 && context.length > 0) {
          for (let i = index; i < lines.length; i++) {
            let contextMatch = true
            for (let j = 0; j < Math.min(3, context.length); j++) {
              if (i + j >= lines.length || lines[i + j].trim() !== context[j].trim()) {
                contextMatch = false
                break
              }
            }
            if (contextMatch) {
              for (const chunk of chunks) {
                chunk.orig_index = i + Math.min(3, context.length)
                action.chunks.push(chunk)
              }
              index = i + context.length
              this.index = end_idx
              break
            }
          }
        } else {
          for (const chunk of chunks) {
            chunk.orig_index += new_index
            action.chunks.push(chunk)
          }
          
          index = new_index + context.length
          this.index = end_idx
        }
      } catch (error) {
        if (error instanceof DiffError && error.message === "Nothing in this section") {
          break
        }
        throw error
      }
    }

    return action
  }

  private _parse_add_file(): PatchAction {
    const lines: string[] = []
    while (!this.is_done(["*** End Patch", "*** Update File:", "*** Delete File:", "*** Add File:"])) {
      const s = this.lines[this.index]
      this.index++
      if (!s.startsWith("+")) {
        throw new DiffError(`Invalid Add File line (missing '+'): ${s}`)
      }
      lines.push(s.slice(1))
    }
    return { type: ActionType.ADD, new_file: lines.join('\n'), chunks: [] }
  }

  private peek_next_section(): { context: string[], chunks: Chunk[], end_idx: number } {
    const old: string[] = []
    let del_lines: string[] = []
    let ins_lines: string[] = []
    const chunks: Chunk[] = []
    let mode = "keep"
    const orig_index = this.index

    let index = this.index
    while (index < this.lines.length) {
      const s = this.lines[index]
      if (s.startsWith("@@") || s.startsWith("*** End Patch") || 
          s.startsWith("*** Update File:") || s.startsWith("*** Delete File:") ||
          s.startsWith("*** Add File:") || s.startsWith("*** End of File")) {
        break
      }
      if (s === "***") break
      if (s.startsWith("***")) {
        throw new DiffError(`Invalid Line: ${s}`)
      }
      index++

      const last_mode = mode
      let line = s === "" ? " " : s
      
      if (line[0] === "+") {
        mode = "add"
      } else if (line[0] === "-") {
        mode = "delete"  
      } else if (line[0] === " ") {
        mode = "keep"
      } else {
        throw new DiffError(`Invalid Line: ${s}`)
      }
      line = line.slice(1)

      if (mode === "keep" && last_mode !== mode) {
        if (ins_lines.length > 0 || del_lines.length > 0) {
          chunks.push({
            orig_index: old.length - del_lines.length,
            del_lines: [...del_lines],
            ins_lines: [...ins_lines]
          })
        }
        del_lines = []
        ins_lines = []
      }

      if (mode === "delete") {
        del_lines.push(line)
        old.push(line)
      } else if (mode === "add") {
        ins_lines.push(line)
      } else if (mode === "keep") {
        old.push(line)
      }
    }

    if (ins_lines.length > 0 || del_lines.length > 0) {
      chunks.push({
        orig_index: old.length - del_lines.length,
        del_lines,
        ins_lines
      })
    }

    if (index === orig_index) {
      throw new DiffError("Nothing in this section")
    }

    return { context: old, chunks, end_idx: index }
  }

  private find_context(lines: string[], context: string[], start: number): number {
    if (context.length === 0) return start

    for (let i = start; i <= lines.length - context.length; i++) {
      let match = true
      for (let j = 0; j < context.length; j++) {
        if (lines[i + j] !== context[j]) {
          match = false
          break
        }
      }
      if (match) return i
    }

    for (let i = start; i <= lines.length - context.length; i++) {
      let match = true
      for (let j = 0; j < context.length; j++) {
        if (lines[i + j].trim() !== context[j].trim()) {
          match = false
          break
        }
      }
      if (match) {
        this.fuzz += 1
        return i
      }
    }

    return -1
  }
}

async function applyV4APatch(patch_text: string): Promise<string> {
  try {
    const lines = patch_text.split('\n')
    if (lines.length < 2 || 
        !V4AParser._norm(lines[0]).startsWith("*** Begin Patch") ||
        V4AParser._norm(lines[lines.length - 1]) !== "*** End Patch") {
      throw new DiffError("Invalid patch text - missing sentinels")
    }

    const files_needed: string[] = []
    for (const line of lines) {
      if (line.startsWith("*** Update File: ")) {
        files_needed.push(line.slice("*** Update File: ".length))
      } else if (line.startsWith("*** Delete File: ")) {
        files_needed.push(line.slice("*** Delete File: ".length))
      }
    }

    const current_files: Record<string, string> = {}
    for (const path of files_needed) {
      if (existsSync(path)) {
        current_files[path] = await readFile(path, 'utf8')
      }
    }

    const parser = new V4AParser(current_files, lines, 1)
    const patch = parser.parse()

    const results: string[] = []
    for (const [path, action] of Object.entries(patch)) {
      if (action.type === ActionType.DELETE) {
        if (existsSync(path)) {
          await writeFile(path + '.backup', current_files[path])
          results.push(`✓ Backed up and marked for deletion: ${path}`)
        }
      } else if (action.type === ActionType.ADD) {
        if (action.new_file !== undefined) {
          await writeFile(path, action.new_file)
          results.push(`✓ Added file: ${path}`)
        }
      } else if (action.type === ActionType.UPDATE) {
        let content = current_files[path]
        const orig_lines = content.split('\n')
        const dest_lines: string[] = []
        let orig_index = 0

        for (const chunk of action.chunks) {
          if (chunk.orig_index > orig_lines.length) {
            throw new DiffError(`${path}: chunk.orig_index ${chunk.orig_index} exceeds file length`)
          }
          if (orig_index > chunk.orig_index) {
            throw new DiffError(`${path}: overlapping chunks at ${orig_index} > ${chunk.orig_index}`)
          }

          dest_lines.push(...orig_lines.slice(orig_index, chunk.orig_index))
          orig_index = chunk.orig_index
          dest_lines.push(...chunk.ins_lines)
          orig_index += chunk.del_lines.length
        }

        dest_lines.push(...orig_lines.slice(orig_index))
        const new_content = dest_lines.join('\n')
        
        await writeFile(path, new_content)
        
        const addedLines: string[] = []
        let lineNum = 1
        for (const chunk of action.chunks) {
          if (chunk.ins_lines.length > 0) {
            for (const line of chunk.ins_lines) {
              addedLines.push(`${lineNum.toString().padStart(3)}+ ${line}`)
              lineNum++
            }
          }
        }
        
        if (addedLines.length > 0) {
          results.push(`✓ Updated ${path}:\n${addedLines.join('\n')}`)
        } else {
          results.push(`✓ Updated file: ${path}`)
        }
      }
    }

    return results.join('\n')
  } catch (error) {
    if (error instanceof DiffError) {
      throw error
    }
    throw new DiffError(`Patch application failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

const applyPatchTool = tool({
  description: 'Apply file changes using V4A diff format. Use this for ANY file modification including adding comments, editing JSON, changing code, etc.',
  inputSchema: z.object({
    patch: z.string().describe('The complete V4A patch content starting with *** Begin Patch and ending with *** End Patch')
  }),
  execute: async ({ patch }) => {
    try {
      const result = await applyV4APatch(patch)
      return result
    } catch (error) {
      return `Error applying patch: ${error instanceof Error ? error.message : 'Unknown error'}`
    }
  }
})

const runCommandTool = tool({
  description: 'Execute system commands. Use this for running shell commands, git operations, npm scripts, etc.',
  inputSchema: z.object({
    command: z.string().describe('The command to execute'),
    description: z.string().describe('Brief description of what this command does')
  }),
  execute: async ({ command, description }) => {
    return new Promise<string>((resolve) => {
      const isViewCommand = command.includes('cat ') || command.includes('head ') || 
                           command.includes('tail ') || command.includes('sed ') ||
                           command.includes('less ') || command.includes('more ')
      
      if (!isViewCommand) {
        console.log(`\nExecuting: ${command}`)
        console.log(`Purpose: ${description}`)
      }
      
      const shell = process.env.SHELL || '/bin/bash'
      const child = spawn(shell, ['-c', command], {
        stdio: ['inherit', 'pipe', 'pipe']
      })
      
      let stdout = ''
      let stderr = ''
      
      child.stdout?.on('data', (data) => {
        const output = data.toString()
        stdout += output
        if (!isViewCommand) {
          const lines = output.split('\n')
          const cleanLines = lines.filter((line: string) => {
            if (line.length > 100 && /^[A-Za-z0-9+/=]+$/.test(line.trim())) {
              return false
            }
            if (line.includes('base64') && line.length > 50) {
              return false
            }
            return true
          })
          if (cleanLines.length > 0 && cleanLines.some((l: string) => l.trim())) {
            process.stdout.write(cleanLines.join('\n'))
          }
        }
      })
      
      child.stderr?.on('data', (data) => {
        const output = data.toString()
        stderr += output
        if (!isViewCommand) {
          process.stderr.write(output)
        }
      })
      
      child.on('exit', (code) => {
        if (isViewCommand) {
          const lines = stdout.split('\n').length - 1
          resolve(`Viewed file (${lines} lines)`)
        } else {
          const result = `Command completed with exit code ${code}\n${stdout}${stderr ? '\nErrors:\n' + stderr : ''}`
          resolve(result)
        }
      })
      
      child.on('error', (error) => {
        resolve(`Command failed: ${error.message}`)
      })
    })
  }
})

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

class ShellHistory {
  private shell: string
  private historyFile: string

  constructor() {
    this.shell = this.detectShell()
    this.historyFile = this.getHistoryFile()
  }

  private detectShell(): string {
    if (process.env.ZSH_VERSION) return 'zsh'
    if (process.env.BASH_VERSION) return 'bash'
    if (process.env.FISH_VERSION) return 'fish'
    
    const shell = process.env.SHELL || ''
    if (shell.includes('/zsh')) return 'zsh'
    if (shell.includes('/bash')) return 'bash'
    if (shell.includes('/fish')) return 'fish'
    
    return 'bash'
  }

  private getHistoryFile(): string {
    switch (this.shell) {
      case 'zsh':
        return process.env.HISTFILE || join(homedir(), '.zsh_history')
      case 'bash':
        return process.env.HISTFILE || join(homedir(), '.bash_history')
      case 'fish':
        const dataDir = process.env.XDG_DATA_HOME || join(homedir(), '.local/share')
        return join(dataDir, 'fish', 'fish_history')
      default:
        return join(homedir(), '.bash_history')
    }
  }

  async addCommand(command: string): Promise<void> {
    const timestamp = Math.floor(Date.now() / 1000)
    
    try {
      let entry = ''
      
      switch (this.shell) {
        case 'zsh':
          entry = `: ${timestamp}:0;${command}\n`
          break
        case 'bash':
          if (process.env.HISTTIMEFORMAT) {
            entry = `#${timestamp}\n${command}\n`
          } else {
            entry = `${command}\n`
          }
          break
        case 'fish':
          entry = `- cmd: ${command}\n  when: ${timestamp}\n`
          break
        default:
          entry = `${command}\n`
      }
      
      await writeFile(this.historyFile, entry, { flag: 'a' })
      
      this.reloadHistory()
    } catch (error) {
    }
  }

  private reloadHistory(): void {
    try {
      switch (this.shell) {
        case 'zsh':
          if (process.env.ZSH_VERSION) {
            spawn('zsh', ['-c', 'fc -R'], { stdio: 'ignore', detached: true })
          }
          break
        case 'bash':
          if (process.env.BASH_VERSION) {
            spawn('bash', ['-c', 'history -r'], { stdio: 'ignore', detached: true })
          }
          break
        case 'fish':
          if (process.env.FISH_VERSION) {
            spawn('fish', ['-c', 'history merge'], { stdio: 'ignore', detached: true })
          }
          break
      }
    } catch {
    }
  }
}

async function readUserInput(danger: DangerLevel): Promise<string> {
  return new Promise((resolve) => {
    let buffer = ''
  
    process.stdin.setRawMode?.(true)
    
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
      
      if (char === '\u001b[A') {
        if (lastReasoning) {
          process.stdout.write('\n' + gray('--- AI Reasoning ---\n'))
          process.stdout.write(gray(lastReasoning) + '\n')
          process.stdout.write(gray('--- End Reasoning ---\n'))
          const styledCommand = danger === 'dangerous' ? red(bold('Command shown above')) : bold('Command shown above')
          const prompt = `${styledCommand} ${gray('[yN]')} `
          process.stdout.write(prompt)
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

async function promptAndExecute(command: string, danger: DangerLevel, autoAccept: boolean, yolo: boolean = false, onComplete?: (exitCode: number) => void): Promise<void> {
  // YOLO mode - run everything without prompting (even ultra dangerous)
  if (yolo) {
    const warningColor = danger === 'ultra' ? red : danger === 'dangerous' ? red : gray
    const styledCommand = warningColor(bold(command))
    console.log(`${styledCommand} ${warningColor('[YOLO MODE]')}`)
    executeCommand(command, onComplete)
    return
  }
  
  // Ultra dangerous commands - don't even prompt (unless yolo)
  if (danger === 'ultra') {
    const styledCommand = red(bold(command))
    console.log(`${styledCommand} ${red('[BLOCKED]')}`)
    console.log(red('This command is irreversibly destructive and cannot be executed'))
    if (onComplete) {
      onComplete(1)
    } else {
      process.exit(1)
    }
    return
  }
  
  // Auto-accept harmless commands if -y flag is set
  if (autoAccept && danger === 'harmless') {
    const styledCommand = bold(command)
    console.log(`${styledCommand} ${gray('[auto-accepted]')}`)
    executeCommand(command, onComplete)
    return
  }
  
  const styledCommand = danger === 'dangerous' ? red(bold(command)) : bold(command)
  const prompt = `${styledCommand} ${gray('[yN↑]')} `
  
  process.stdout.write(prompt)
  
  const answer = await readUserInput(danger)
  
  if (answer.toLowerCase() === 'y') {
    if (danger === 'harmless') {
      console.log('') // newline for harmless commands
    }
    executeCommand(command, onComplete)
  } else {
    console.log(gray('aborted'))
    if (onComplete) {
      onComplete(0)
    } else {
      process.exit(0)
    }
  }
}

function executeCommand(command: string, onComplete?: (exitCode: number) => void) {
  const shell = process.env.SHELL || '/bin/bash'
  const history = new ShellHistory()
  
  // Use script command to provide a TTY for interactive shell with aliases
  const scriptCmd = process.platform === 'darwin' 
    ? ['script', '-q', '/dev/null', shell, '-l', '-c', command]
    : ['script', '-qe', '-c', `${shell} -l -c '${command.replace(/'/g, "'\\''")}'`, '/dev/null']
  
  const child = spawn(scriptCmd[0], scriptCmd.slice(1), {
    stdio: 'inherit'
  })
  
  child.on('exit', async (code) => {
    if (code === 0) {
      await history.addCommand(command)
    }
    
    if (onComplete) {
      onComplete(code || 0)
    } else {
      process.exit(code || 0)
    }
  })
  
  child.on('error', (err) => {
    console.error('Failed to execute command:', err)
    if (onComplete) {
      onComplete(1)
    } else {
      process.exit(1)
    }
  })
}

async function processPrompt(prompt: string, model: string, autoAccept: boolean, yoloMode: boolean, isDebug: boolean, onComplete?: (exitCode: number) => void): Promise<void> {
  const loader = new ThinkingLoader()
  loader.start()

  try {
    // Use generateText with tools for wagyu models, generateObject for others
    if (model.includes('wagyu')) {
      const result = await generateText({
        model: model,
        stopWhen: stepCountIs(50),
        tools: { 
          apply_patch: applyPatchTool,
          run_command: runCommandTool
        },
        providerOptions: {
          openai: {
            include: ['reasoning.encrypted_content'],
          },
        },
        system: `You are an agent - please keep going until the user's query is completely resolved, before ending your turn and yielding back to the user. Only terminate your turn when you are sure that the problem is solved.

If you are not sure about file content or codebase structure pertaining to the user's request, use your tools to read files and gather the relevant information: do NOT guess or make up an answer.

You MUST plan extensively before each function call, and reflect extensively on the outcomes of the previous function calls. DO NOT do this entire process by making function calls only, as this can impair your ability to solve the problem and think insightfully.

CRITICAL: You must continue making tool calls until the user's request is COMPLETELY fulfilled. Do not stop after planning - execute the plan with actual tool calls.

You have access to two main tools:
1. apply_patch: For file modifications (editing, adding comments, changing JSON, etc.) using V4A diff format
2. run_command: For executing system commands (git, npm, shell commands, etc.)

# V4A Diff Format Example:
*** Begin Patch
*** Update File: package.json
{
  "name": "example",
+ // AI CLI tool comment
  "version": "1.0.0"
}
*** End Patch

# Command Execution Examples:
- Use run_command for: git status, npm install, ls -la, mkdir, etc.
- The tool will execute commands and show you the output

Always think through the request step by step and use the appropriate tool for each task.`,
        prompt: `User request: "${prompt}"

You must COMPLETE this request fully. Use the appropriate tools:
- apply_patch for file modifications 
- run_command for system operations

Execute the necessary actions to fulfill this request completely.`,
      })
      
      loader.stop()
      
      if (result.toolResults && result.toolResults.length > 0) {
        for (const toolResult of result.toolResults) {
          const output = toolResult.output
          if (output && !output.includes('base64') && output.trim().length > 0) {
            if (toolResult.toolName === 'apply_patch') {
              console.log(output)
            } else {
              console.log(gray(`${toolResult.toolName}: ${output}`))
            }
          }
        }
      }
      
      if (result.text && result.text.trim() && !result.text.includes('base64')) {
        console.log('\n' + result.text)
      }
      
      if (onComplete) onComplete(0)
      return
    }
    
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

Provide a brief description of what the command does.

Also provide detailed step-by-step reasoning explaining:
1. How you interpreted the user's request
2. What command options/flags you considered
3. Why this specific command was chosen over alternatives
4. Any potential edge cases or considerations`,
    })

    loader.stop()
    
    // Store reasoning for ↑ key access
    lastReasoning = object.reasoning
    
    if (isDebug) {
      console.log('Debug - LLM Response:', JSON.stringify(object, null, 2))
    }
    
    await promptAndExecute(object.command, object.danger, autoAccept, yoloMode, onComplete)
  } catch (error) {
    loader.stop()
    throw error
  }
}

async function interactiveMode(model: string, autoAccept: boolean, yoloMode: boolean, isDebug: boolean): Promise<void> {
  console.log(`\x1b[38;5;245maix ${version} (${model}) - Interactive Mode\x1b[0m`)
  console.log(gray('Type your commands or "exit" to quit'))
  console.log()

  while (true) {
    // Create a fresh readline interface for each prompt to avoid buffer issues
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout
    })

    const userInput = await new Promise<string>((resolve) => {
      rl.question(bold('aix> '), (answer) => {
        rl.close()
        resolve(answer.trim())
      })
    })
    
    if (!userInput) continue
    
    if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
      console.log('Goodbye!')
      break
    }
    
    try {
      await new Promise<void>((resolve) => {
        processPrompt(userInput, model, autoAccept, yoloMode, isDebug, () => {
          resolve()
        }).catch(error => {
          console.error('Error:', error instanceof Error ? error.message : 'Unknown error')
          resolve()
        })
      })
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : 'Unknown error')
    }
    
    console.log()
  }
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

// @ts-ignore - defined by esbuild
const version = typeof __VERSION__ !== 'undefined' ? __VERSION__ : '0.0.1'

// Parse arguments
let args: any
try {
  args = arg({
    '--yes': Boolean,
    '--yolo': Boolean,
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
  --yolo        Run ANY command without prompting (DANGEROUS!)
  -m, --model   Specify AI model (default: openai/wagyu-a5)
  -h, --help    Show this help message
  --debug       Show debug information

Examples:
  aix list files
  aix -y show git status
  aix --yolo delete all temp files
  aix -m openai/4o create a new directory

Environment:
  AI_GATEWAY_API_KEY    Required. Get yours at https://vercel.com/docs/ai-gateway

Tips:
  Press ↑ (up arrow) during command confirmation to see AI reasoning`)
  process.exit(0)
}

const model = args['--model'] || 'openai/wagyu-a5'
const autoAccept = args['--yes'] || false
const yoloMode = args['--yolo'] || false
const isDebug = args['--debug'] || false

async function main() {
  const prompt = args._.join(' ')
  if (!prompt) {
    await interactiveMode(model, autoAccept, yoloMode, isDebug)
    process.exit(0)
  }

  console.log(`\x1b[38;5;245maix ${version} (${model})\x1b[0m`)

  process.on('SIGINT', () => {
    process.stdout.write('\n')
    process.exit(0)
  })

  try {
    await processPrompt(prompt, model, autoAccept, yoloMode, isDebug)
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : 'Unknown error')
    process.exit(1)
  }
}

main().catch(error => {
  console.error('Error:', error instanceof Error ? error.message : 'Unknown error')
  process.exit(1)
})

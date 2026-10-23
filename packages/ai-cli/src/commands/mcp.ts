import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";

import pkg from "../../package.json";
import type { Command, CommandDefinition } from "../lib/command.js";

type Profile = "core" | "media" | "all";

interface Input {
  type: "string" | "array" | "boolean" | "integer";
  description: string;
  flag?: string;
  falseFlag?: string;
  items?: Record<string, unknown>;
  enum?: string[];
  minItems?: number;
  minimum?: number;
  maximum?: number;
  default?: number;
}

interface Question {
  id: string;
  type: "boolean" | "choice" | "score";
  question: string;
  choices?: string[];
  levels?: string[];
}

interface Run {
  code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  timeoutMs: number;
}

interface CallToolResult {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

const WRITES = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};
const READS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};
const STRING_ITEMS = { type: "string" };
const QUESTION_CRITERIA: Partial<
  Record<Question["type"], "choices" | "levels">
> = { choice: "choices", score: "levels" };
const QUESTION_REQUIRED = ["id", "type", "question"];
const QUESTION_INPUTS: Record<string, Input> = {
  id: { type: "string", description: "Question ID, without =" },
  type: {
    type: "string",
    enum: ["boolean", "choice", "score"],
    description: "Answer type",
  },
  question: { type: "string", description: "Question to ask" },
  choices: {
    type: "array",
    items: STRING_ITEMS,
    description: "Choice labels without commas; required for choice questions",
  },
  levels: {
    type: "array",
    items: STRING_ITEMS,
    description:
      "Score levels without commas, lowest to highest; required for score questions",
  },
};
const SHARED_INPUTS: Record<string, Input> = {
  cwd: { type: "string", description: "Working directory for the run" },
  extraArgs: {
    type: "array",
    items: STRING_ITEMS,
    description: "Extra CLI flags appended last",
  },
  timeoutMs: {
    type: "integer",
    minimum: 1,
    maximum: 2147483647,
    default: 600000,
    description: "Child process timeout in milliseconds",
  },
};
const DECIDE_INPUTS: Record<string, Input> = {
  questions: {
    type: "array",
    minItems: 1,
    items: {
      type: "object",
      properties: QUESTION_INPUTS,
      required: QUESTION_REQUIRED,
      additionalProperties: false,
    },
    description:
      "Named boolean, choice, or score questions; choices and levels must not contain commas",
  },
  state: {
    type: "string",
    description: "Text or JSON state written to stdin",
  },
};

interface ToolOverride {
  path: string[];
  profile: Exclude<Profile, "all">;
  json: boolean;
  annotations: typeof WRITES;
  hint: string;
  required?: string[];
  inputs?: Record<string, Input>;
  hiddenOptions?: string[];
}

/** Command mappings and agent hints that the CLI definitions cannot supply. */
export const TOOL_OVERRIDES: Record<string, ToolOverride> = {
  ai_text: {
    path: ["text"],
    profile: "core",
    json: true,
    annotations: WRITES,
    hint: "Returns JSON metadata with a saved file path to read; without output the file is written to cwd (or AI_CLI_OUTPUT_DIR). Useful extraArgs: --format, --max-tokens.",
  },
  ai_image: {
    path: ["image"],
    profile: "core",
    json: true,
    annotations: WRITES,
    hint: "Returns a JSON manifest with saved file paths; without output files are written to cwd (or AI_CLI_OUTPUT_DIR). Pass a returned file path to ai_decide images. Useful extraArgs: --seed, --mask.",
  },
  ai_decide: {
    path: ["decide"],
    profile: "core",
    json: false,
    annotations: READS,
    hint: "Supply state, images, or both. Useful extraArgs: --input, --max-retries.",
    required: ["questions"],
    inputs: DECIDE_INPUTS,
    hiddenOptions: [
      "boolean",
      "choice",
      "choices",
      "score",
      "levels",
      "questions",
    ],
  },
  ai_models: {
    path: ["models"],
    profile: "core",
    json: true,
    annotations: READS,
    hint: "Discover model IDs before generating. Useful extraArgs: --base-url, --headers.",
  },
  ai_video_start: {
    path: ["video", "start"],
    profile: "media",
    json: false,
    annotations: WRITES,
    hint: "Set output and pass that file path to ai_video_status. Useful extraArgs: --seed, --resolution.",
    required: ["output"],
  },
  ai_video_status: {
    path: ["video", "status"],
    profile: "media",
    json: false,
    annotations: { ...WRITES, idempotentHint: true },
    hint: "Set download to save completed videos. Useful extraArgs: --download-max-bytes, --max-retries.",
  },
  ai_audio_speak: {
    path: ["audio", "speak"],
    profile: "media",
    json: true,
    annotations: WRITES,
    hint: "Returns JSON metadata with saved file paths; without output files are written to cwd (or AI_CLI_OUTPUT_DIR). Useful extraArgs: --format, --speed.",
    required: ["text"],
  },
  ai_audio_transcribe: {
    path: ["audio", "transcribe"],
    profile: "media",
    json: true,
    annotations: WRITES,
    hint: "Returns JSON metadata with a saved file path to read; without output the file is written to cwd (or AI_CLI_OUTPUT_DIR). Useful extraArgs: --format, --count.",
    required: ["audio"],
  },
};

/** Commands deliberately omitted from MCP discovery. */
export const EXCLUDED_COMMANDS: Record<string, string> = {
  video: "Blocking poll; use video start and video status instead.",
  mcp: "This server is not a tool.",
};

/** TTY and connection options available only through extraArgs. */
export const HIDDEN_OPTIONS = [
  "json",
  "quiet",
  "preview",
  "play",
  "waveform",
  "headers",
  "baseUrl",
  "teamIdOrSlug",
];

/** Generate MCP schemas and argument bindings from the registered CLI tree. */
export function buildTools(definition: CommandDefinition) {
  return Object.entries(TOOL_OVERRIDES).map(([name, override]) => {
    let command = definition;
    for (const part of override.path) {
      const child = command.commands.find(
        (candidate) => candidate.name === part
      );
      if (!child)
        throw new Error(`Unknown command path: ${override.path.join(" ")}`);
      command = child;
    }
    const positional = command.argument?.name.replace(
      /-([a-z])/g,
      (_, c: string) => c.toUpperCase()
    );
    const inputs: Record<string, Input> = {};
    if (positional) {
      inputs[positional] = {
        type: "string",
        description: command.argument!.description,
      };
    }
    for (const option of command.options) {
      if (
        HIDDEN_OPTIONS.includes(option.name) ||
        Object.hasOwn(inputs, option.name) ||
        override.hiddenOptions?.includes(option.name)
      )
        continue;
      const positive =
        command.options.find(
          (candidate) => candidate.name === option.name && !candidate.negated
        ) ?? option;
      inputs[option.name] = {
        type: positive.takesValue
          ? positive.repeatable
            ? "array"
            : "string"
          : "boolean",
        description: positive.description,
        ...(positive.takesValue && positive.repeatable
          ? { items: STRING_ITEMS }
          : {}),
        flag: positive.negated ? undefined : positive.long,
        falseFlag: command.options.find(
          (candidate) => candidate.name === option.name && candidate.negated
        )?.long,
      };
    }
    Object.assign(inputs, override.inputs, SHARED_INPUTS);
    return {
      name,
      command: override.path,
      json: override.json,
      positional,
      description: `${command.description}. ${override.hint}`,
      inputs,
      inputSchema: {
        type: "object",
        properties: Object.fromEntries(
          Object.entries(inputs).map(
            ([key, { flag: _flag, falseFlag: _falseFlag, ...schema }]) => [
              key,
              schema,
            ]
          )
        ),
        required: [
          ...(command.argument?.required ? [positional!] : []),
          ...(override.required ?? []),
        ],
        additionalProperties: false,
      },
      annotations: override.annotations,
    };
  });
}

/** Tool names enabled by each server profile. */
export const PROFILES: Record<Profile, string[]> = {
  core: [],
  media: [],
  all: [],
};
for (const [name, { profile }] of Object.entries(TOOL_OVERRIDES)) {
  PROFILES[profile].push(name);
  PROFILES.all.push(name);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateInput(
  key: string,
  value: unknown,
  input: Input
): string | undefined {
  if (input.enum && !input.enum.includes(value as string)) {
    return `argument '${key}' must be one of ${input.enum.join(", ")}`;
  }
  const expected = {
    string: "a string",
    boolean: "a boolean",
    integer: "an integer",
    array: "an array of strings",
  }[input.type];
  const valid =
    input.type === "array"
      ? Array.isArray(value) && value.every((item) => typeof item === "string")
      : input.type === "integer"
        ? Number.isInteger(value)
        : typeof value === input.type;
  if (!valid) return `argument '${key}' must be ${expected}`;
  if (
    input.type === "integer" &&
    ((value as number) < input.minimum! || (value as number) > input.maximum!)
  ) {
    return `argument '${key}' must be an integer from ${input.minimum} to ${input.maximum}`;
  }
}

function validateQuestions(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return "argument 'questions' must be a non-empty array of questions";
  }
  for (const [index, question] of value.entries()) {
    const prefix = `questions[${index}]`;
    if (!isObject(question)) return `argument '${prefix}' must be an object`;
    for (const key of Object.keys(question)) {
      if (!Object.hasOwn(QUESTION_INPUTS, key)) {
        return `unknown argument '${key}' in ${prefix}; valid: ${Object.keys(QUESTION_INPUTS).join(", ")}`;
      }
    }
    for (const key of QUESTION_REQUIRED) {
      if (question[key] === undefined)
        return `missing required argument '${prefix}.${key}'`;
    }
    for (const [key, input] of Object.entries(QUESTION_INPUTS)) {
      if (question[key] === undefined) continue;
      const error = validateInput(`${prefix}.${key}`, question[key], input);
      if (error) return error;
    }
    if ((question.id as string).includes("=")) {
      return `argument '${prefix}.id' must not contain "="`;
    }
    const criteria = QUESTION_CRITERIA[question.type as Question["type"]];
    if (criteria && question[criteria] === undefined) {
      return `missing required argument '${prefix}.${criteria}'`;
    }
    if (criteria && (question[criteria] as string[]).length === 0) {
      return `argument '${prefix}.${criteria}' must be a non-empty array of strings`;
    }
    for (const key of ["choices", "levels"]) {
      if (
        (question[key] as string[] | undefined)?.some((label) =>
          label.includes(",")
        )
      ) {
        return `argument '${prefix}.${key}' must not contain labels with ","`;
      }
    }
  }
}

/** Validate tool inputs and translate them to CLI arguments and optional stdin. */
export function toolArgv(
  tools: ReturnType<typeof buildTools>,
  name: string,
  args: unknown
): { argv: string[]; stdin?: string } | { error: string } {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) return { error: `Unknown tool: ${name}` };
  if (args === undefined) args = {};
  if (!isObject(args)) return { error: "arguments must be an object" };
  const inputs = tool.inputs;
  for (const key of Object.keys(args)) {
    if (!Object.hasOwn(inputs, key)) {
      return {
        error: `unknown argument '${key}' for ${name}; valid: ${Object.keys(inputs).join(", ")}`,
      };
    }
  }
  const argv = [...tool.command];
  if (tool.positional && args[tool.positional] !== undefined)
    argv.push(args[tool.positional] as string);
  if (tool.json) argv.push("--json");
  for (const [key, input] of Object.entries(inputs)) {
    const value = args[key];
    if (value === undefined || value === "") {
      if (tool.inputSchema.required.includes(key))
        return { error: `missing required argument '${key}' for ${name}` };
      continue;
    }
    const error =
      key === "questions"
        ? validateQuestions(value)
        : validateInput(key, value, input);
    if (error) return { error };
    if (key === tool.positional && (value as string).startsWith("-")) {
      return { error: `argument '${key}' must not start with "-"` };
    }
    if (key === "questions") {
      for (const question of value as Question[]) {
        argv.push(`--${question.type}=${question.id}=${question.question}`);
        const criteria = QUESTION_CRITERIA[question.type];
        if (criteria)
          argv.push(
            `--${criteria}=${question.id}=${question[criteria]!.join(",")}`
          );
      }
    } else if (input.type === "boolean") {
      const flag = value ? input.flag : input.falseFlag;
      if (flag) argv.push(flag);
    } else if (input.flag) {
      for (const item of Array.isArray(value) ? value : [value])
        argv.push(`${input.flag}=${item}`);
    }
  }
  argv.push(...((args.extraArgs as string[] | undefined) ?? []));
  return name === "ai_decide"
    ? { argv, stdin: (args.state as string | undefined) ?? "" }
    : { argv };
}

function errorResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/** Map drained child output and exit status to an MCP tool result. */
export function toolResult(run: Run): CallToolResult {
  const stdout = run.stdout.trim();
  let parsed: unknown;
  let validJson = true;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    validJson = false;
  }
  const failed =
    run.code !== 0 ||
    run.signal != null ||
    run.timedOut ||
    !validJson ||
    (isObject(parsed) && parsed.success === false);
  const text = failed
    ? [
        stdout,
        run.stderr.trim(),
        run.timedOut ? `timed out after ${run.timeoutMs}ms` : "",
      ]
        .filter(Boolean)
        .join("\n") || `exited with ${run.signal ?? `code ${run.code}`}`
    : stdout;
  return {
    content: [{ type: "text", text }],
    ...(isObject(parsed) ? { structuredContent: parsed } : {}),
    ...(failed ? { isError: true } : {}),
  };
}

async function killChild(child: ChildProcess): Promise<void> {
  if (!child.pid) return;
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn(
        "taskkill",
        ["/pid", String(child.pid), "/T", "/F"],
        { stdio: "ignore", windowsHide: true }
      );
      killer.once("error", () => resolve());
      killer.once("close", () => resolve());
    });
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH")
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`
      );
  }
}

function runTool(
  command: { argv: string[]; stdin?: string },
  args: Record<string, unknown>,
  children: Set<ChildProcess>
): Promise<CallToolResult> {
  return new Promise((resolve) => {
    const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1" };
    delete env.FORCE_COLOR;
    delete env.AI_CLI_PREVIEW;
    const timeoutMs = (args.timeoutMs as number | undefined) ?? 600000;
    const child = spawn(
      process.execPath,
      [...process.execArgv, process.argv[1]!, ...command.argv],
      {
        cwd: args.cwd as string | undefined,
        env,
        stdio: [
          command.stdin === undefined ? "ignore" : "pipe",
          "pipe",
          "pipe",
        ],
        detached: true,
        windowsHide: true,
      }
    );
    children.add(child);
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let spawnError: string | undefined;
    child.stdout!.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr!.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      spawnError = error.message;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      void killChild(child);
    }, timeoutMs);
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      children.delete(child);
      resolve(
        spawnError === undefined
          ? toolResult({ code, signal, stdout, stderr, timedOut, timeoutMs })
          : errorResult(spawnError)
      );
    });
    if (child.stdin) {
      child.stdin.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code !== "EPIPE") process.stderr.write(`${error.message}\n`);
      });
      child.stdin.end(command.stdin);
    }
  });
}

/** Serve newline-delimited MCP requests on stdin and stdout. */
export async function runMcp(program: Command, args: string[]): Promise<void> {
  const tools = buildTools(program.definition());
  let profile: Profile = "core";
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "-h" || arg === "--help") {
      process.stdout.write(
        "Usage: ai mcp [--profile core|media|all]\n\nStart an MCP server over stdio (default profile: core).\n\nOptions:\n  --profile <profile>  Enable core, media, or all tools\n  -h, --help           Display help\n"
      );
      return;
    }
    if (arg === "--profile" || arg.startsWith("--profile=")) {
      const value =
        arg === "--profile" ? args[++index] : arg.slice("--profile=".length);
      if (value !== "core" && value !== "media" && value !== "all") {
        process.stderr.write(`Unknown profile: ${value ?? "(missing)"}\n`);
        process.exitCode = 1;
        return;
      }
      profile = value;
    } else {
      process.stderr.write(`Unknown flag: ${arg}\n`);
      process.exitCode = 1;
      return;
    }
  }
  const listedTools = tools
    .filter((tool) => PROFILES[profile].includes(tool.name))
    .map(({ name, description, inputSchema, annotations }) => ({
      name,
      description,
      inputSchema,
      annotations,
    }));
  const children = new Set<ChildProcess>();
  const pending = new Set<Promise<void>>();
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  let ending = false;
  let terminating = false;
  const endInput = () => {
    ending = true;
    input.close();
    process.stdin.pause();
  };
  const terminate = async () => {
    if (terminating) return;
    terminating = true;
    endInput();
    await Promise.all([...children].map(killChild));
    process.exit(0);
  };
  const send = (message: unknown) => {
    if (!terminating) process.stdout.write(JSON.stringify(message) + "\n");
  };
  const rpcError = (id: unknown, code: number, message: string) => {
    send({ jsonrpc: "2.0", id, error: { code, message } });
  };
  const respond = async (request: Record<string, unknown>) => {
    const id = request.id;
    let result: unknown;
    switch (request.method) {
      case "initialize":
        result = {
          protocolVersion: "2025-11-25",
          capabilities: { tools: {} },
          serverInfo: { name: "ai", version: pkg.version },
        };
        break;
      case "ping":
        result = {};
        break;
      case "tools/list":
        result = { tools: listedTools };
        break;
      case "tools/call": {
        const params = isObject(request.params) ? request.params : {};
        const name = params.name;
        if (!tools.some((tool) => tool.name === name)) {
          rpcError(
            id,
            -32602,
            `Unknown tool: ${typeof name === "string" ? name : JSON.stringify(name)}`
          );
          return;
        }
        if (!PROFILES[profile].includes(name as string)) {
          result = errorResult(
            `${name} is not enabled in profile ${profile}; start the server with \`ai mcp --profile media\` or \`--profile all\``
          );
          break;
        }
        const command = toolArgv(tools, name as string, params.arguments);
        if ("error" in command) {
          result = errorResult(command.error);
        } else {
          result = await runTool(
            command,
            (params.arguments ?? {}) as Record<string, unknown>,
            children
          ).catch((error: unknown) =>
            errorResult(error instanceof Error ? error.message : String(error))
          );
        }
        break;
      }
      case "shutdown":
        send({ jsonrpc: "2.0", id, result: {} });
        endInput();
        return;
      default:
        rpcError(id, -32601, "Method not found");
        return;
    }
    send({ jsonrpc: "2.0", id, result });
  };
  process.stdout.on("error", terminate);
  process.stdout.on("close", terminate);
  const signals = ["SIGTERM", "SIGINT", "SIGHUP"] as const;
  for (const signal of signals) process.on(signal, terminate);
  const closed = new Promise<void>((resolve) => {
    input.once("close", () => {
      ending = true;
      resolve();
    });
  });
  input.on("line", (line) => {
    if (ending || !line.trim()) return;
    let request: unknown;
    try {
      request = JSON.parse(line);
    } catch {
      rpcError(null, -32700, "Parse error");
      return;
    }
    const id = isObject(request) ? request.id : undefined;
    const validId =
      typeof id === "string" || typeof id === "number" || id === undefined;
    if (
      !isObject(request) ||
      request.jsonrpc !== "2.0" ||
      typeof request.method !== "string" ||
      !validId
    ) {
      rpcError(validId ? (id ?? null) : null, -32600, "Invalid Request");
      return;
    }
    if (!Object.hasOwn(request, "id")) return;
    const task = respond(request);
    pending.add(task);
    void task.finally(() => pending.delete(task));
  });
  try {
    await closed;
    await Promise.all(pending);
  } finally {
    process.stdout.off("error", terminate);
    process.stdout.off("close", terminate);
    for (const signal of signals) process.off(signal, terminate);
  }
}

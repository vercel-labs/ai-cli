/**
 * Eval harness for ai-cli.
 *
 * Runs the CLI in headless mode (-p --force --json --timeout) inside
 * isolated temp directories and provides assertion helpers to verify
 * workspace state after the agent finishes.
 *
 * Requires: AI_GATEWAY_API_KEY — set via environment variable or
 * in apps/cli/.env (loaded automatically).
 * CLI must be built first (`bun run build`).
 * Do NOT run in CI — these hit real LLMs and take minutes.
 *
 *   bun test tests/evals/
 */
import { expect } from "bun:test";
import { execSync, spawn as nodeSpawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, unlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI = resolve(import.meta.dirname, "../../dist/ai.mjs");
const CLI_ROOT = resolve(import.meta.dirname, "../..");

export const EVAL_MODELS = [
	"anthropic/claude-sonnet-4.6",
	"xai/grok-4.1-fast-reasoning",
] as const;

export const EVAL_MODEL: string = process.env.EVAL_MODEL ?? EVAL_MODELS[0];

// ---------------------------------------------------------------------------
// .env loading
// ---------------------------------------------------------------------------

function loadDotEnv(): Record<string, string> {
	const candidates = [join(CLI_ROOT, ".env"), join(CLI_ROOT, ".env.local")];
	const vars: Record<string, string> = {};
	for (const file of candidates) {
		if (!existsSync(file)) {
			continue;
		}
		const lines = readFileSync(file, "utf8").split("\n");
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) {
				continue;
			}
			const eq = trimmed.indexOf("=");
			if (eq === -1) {
				continue;
			}
			const key = trimmed.slice(0, eq).trim();
			let value = trimmed.slice(eq + 1).trim();
			if (
				(value.startsWith('"') && value.endsWith('"')) ||
				(value.startsWith("'") && value.endsWith("'"))
			) {
				value = value.slice(1, -1);
			}
			vars[key] = value;
		}
	}
	return vars;
}

const dotEnvVars = loadDotEnv();

for (const [k, v] of Object.entries(dotEnvVars)) {
	if (!process.env[k]) {
		process.env[k] = v;
	}
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HeadlessResult {
	output: string;
	model: string;
	tokens: number;
	cost: number;
	steps: number;
	toolCalls: number;
	exitCode: number;
	chatId?: string;
	error?: string;
	usage?: {
		inputTokens: number;
		outputTokens: number;
		cacheReadTokens: number;
		cacheWriteTokens: number;
		reasoningTokens: number;
	};
}

export interface EvalResult {
	json: HeadlessResult;
	stdout: string;
	stderr: string;
	code: number | null;
	workDir: string;
}

export interface EvalOptions {
	/** CLI timeout in seconds (default: 300) */
	timeoutSec?: number;
	/** Override the working directory instead of creating a temp dir */
	cwd?: string;
	/** Model override */
	model?: string;
	/** Run before the eval starts (receives the work dir) */
	setup?: (dir: string) => Promise<void>;
	/** Resume an existing chat session by ID */
	resume?: string;
	/** Persist the chat session (needed for multi-turn). Default: false */
	save?: boolean;
}

// ---------------------------------------------------------------------------
// Temp directory management
// ---------------------------------------------------------------------------

const PREFIX = "ai-cli-eval-";

export function createWorkDir(): string {
	return mkdtempSync(join(tmpdir(), PREFIX));
}

/** Background cleanup — spawns `rm -rf` without blocking the test runner. */
export function cleanupWorkDir(dir: string): void {
	try {
		nodeSpawn("rm", ["-rf", dir], { stdio: "ignore", detached: true }).unref();
	} catch {}
}

// ---------------------------------------------------------------------------
// Core runner
// ---------------------------------------------------------------------------

export async function runEval(
	prompt: string,
	opts: EvalOptions = {},
): Promise<EvalResult> {
	const {
		timeoutSec = 300,
		model = EVAL_MODEL,
		setup,
		resume,
		save = false,
	} = opts;

	const workDir = opts.cwd ?? createWorkDir();

	if (setup) {
		await setup(workDir);
	}

	const args = [
		CLI,
		"-p",
		"--force",
		"--json",
		"--verbose",
		...(save ? [] : ["--no-save"]),
		"--timeout",
		String(timeoutSec),
		"--model",
		model,
		...(resume ? ["--resume", resume] : []),
		prompt,
	];

	const result = await new Promise<{
		stdout: string;
		stderr: string;
		code: number | null;
	}>((resolvePromise) => {
		const env = { ...dotEnvVars, ...process.env, NO_COLOR: "1" };
		const child = nodeSpawn(process.execPath, args, {
			env,
			cwd: workDir,
			stdio: ["pipe", "pipe", "pipe"],
		});

		const stdoutBufs: Buffer[] = [];
		const stderrBufs: Buffer[] = [];
		child.stdout.on("data", (d) => stdoutBufs.push(d));
		child.stderr.on("data", (d) => stderrBufs.push(d));
		child.stdin.end();

		child.on("close", (code) => {
			resolvePromise({
				stdout: Buffer.concat(stdoutBufs).toString(),
				stderr: Buffer.concat(stderrBufs).toString(),
				code,
			});
		});
	});

	let json: HeadlessResult;
	try {
		json = JSON.parse(result.stdout.trim());
	} catch {
		throw new Error(
			`Failed to parse CLI JSON output.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
		);
	}

	// Diagnostic output so failures are debuggable
	console.log("\n--- eval result ---");
	console.log(`  exit code: ${result.code}`);
	console.log(`  json.exitCode: ${json.exitCode}`);
	console.log(`  json.error: ${json.error ?? "(none)"}`);
	console.log(`  json.tokens: ${json.tokens}`);
	console.log(`  json.steps: ${json.steps}`);
	console.log(`  json.toolCalls: ${json.toolCalls}`);
	console.log(`  json.output length: ${json.output.length}`);
	if (json.error) {
		console.log(`  json.output: ${json.output.slice(0, 500)}`);
	}
	if (result.stderr) {
		console.log(`  stderr (last 500): ${result.stderr.slice(-500)}`);
	}
	console.log("--- end eval result ---\n");

	if (json.error) {
		throw new Error(
			`CLI returned error: ${json.error}\nstderr: ${result.stderr.slice(-1000)}`,
		);
	}

	return {
		json,
		stdout: result.stdout,
		stderr: result.stderr,
		code: result.code,
		workDir,
	};
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

export function assertFileExists(dir: string, relativePath: string): void {
	const full = join(dir, relativePath);
	expect(existsSync(full)).toBe(true);
}

export function assertNoFile(dir: string, relativePath: string): void {
	const full = join(dir, relativePath);
	expect(existsSync(full)).toBe(false);
}

export function assertFileContains(
	dir: string,
	relativePath: string,
	pattern: string | RegExp,
): void {
	const full = join(dir, relativePath);
	expect(existsSync(full)).toBe(true);
	const content = readFileSync(full, "utf8");
	if (typeof pattern === "string") {
		expect(content).toContain(pattern);
	} else {
		expect(content).toMatch(pattern);
	}
}

/**
 * Recursively check whether any file matching a glob-like extension
 * contains the given pattern. Uses grep for speed.
 */
export function assertAnyFileContains(
	dir: string,
	extensions: string[],
	pattern: string,
): void {
	const extArgs = extensions.map((e) => `--include=*.${e}`).join(" ");
	try {
		execSync(`grep -r ${extArgs} -l ${JSON.stringify(pattern)} .`, {
			cwd: dir,
			stdio: "pipe",
		});
	} catch {
		throw new Error(
			`No file with extensions [${extensions.join(", ")}] in ${dir} contains "${pattern}"`,
		);
	}
}

export function assertCommandSucceeds(
	dir: string,
	cmd: string,
	timeoutMs = 120_000,
): void {
	try {
		execSync(cmd, { cwd: dir, stdio: "pipe", timeout: timeoutMs });
	} catch (error) {
		const stderr =
			error && typeof error === "object" && "stderr" in error
				? (error as { stderr: Buffer }).stderr?.toString()
				: "";
		throw new Error(`Command failed in ${dir}: ${cmd}\n${stderr}`, {
			cause: e,
		});
	}
}

/**
 * Check that at least one of the given files exists.
 * Useful for "next.config.ts OR next.config.mjs OR next.config.js".
 */
export function assertAnyFileExists(
	dir: string,
	relativePaths: string[],
): void {
	const found = relativePaths.some((p) => existsSync(join(dir, p)));
	if (!found) {
		throw new Error(`None of [${relativePaths.join(", ")}] exist in ${dir}`);
	}
}

export function assertStepCount(
	result: EvalResult,
	bounds: { min?: number; max?: number },
): void {
	const { steps } = result.json;
	if (bounds.min !== undefined) {
		expect(steps).toBeGreaterThanOrEqual(bounds.min);
	}
	if (bounds.max !== undefined) {
		expect(steps).toBeLessThanOrEqual(bounds.max);
	}
}

// ---------------------------------------------------------------------------
// Multi-turn support
// ---------------------------------------------------------------------------

export interface MultiTurnMessage {
	prompt: string;
	/** Optional assertion to run between turns */
	check?: (result: EvalResult, turnIndex: number) => void | Promise<void>;
}

export interface MultiTurnEvalResult {
	turns: EvalResult[];
	workDir: string;
}

export function cleanupChat(chatId: string): void {
	try {
		const chatPath = join(homedir(), ".ai-cli", "chats", `${chatId}.json`);
		unlinkSync(chatPath);
	} catch {}
}

export async function runMultiTurnEval(
	messages: MultiTurnMessage[],
	opts: EvalOptions = {},
): Promise<MultiTurnEvalResult> {
	if (messages.length === 0) {
		throw new Error("runMultiTurnEval requires at least one message");
	}

	const workDir = opts.cwd ?? createWorkDir();
	const turns: EvalResult[] = [];
	let chatId: string | undefined;

	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i];
		const turnLabel = `[turn ${i + 1}/${messages.length}]`;
		console.log(`\n${turnLabel} sending: "${msg.prompt.slice(0, 80)}..."`);

		const result = await runEval(msg.prompt, {
			...opts,
			cwd: workDir,
			save: true,
			resume: chatId,
			setup: i === 0 ? opts.setup : undefined,
		});

		turns.push(result);

		if (!chatId && result.json.chatId) {
			chatId = result.json.chatId;
		}

		if (!chatId && i < messages.length - 1) {
			throw new Error(
				`${turnLabel} no chatId returned — cannot resume for next turn`,
			);
		}

		if (msg.check) {
			await msg.check(result, i);
		}
	}

	return { turns, workDir };
}

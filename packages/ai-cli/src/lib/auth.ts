import { randomUUID } from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const isWindows = process.platform === "win32";

export const API_KEYS_URL =
  "https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%2Fapi-keys";

let keySource: "env" | "login" | "none" = "none";

function configDir(): string {
  return join(
    process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
    "ai-cli"
  );
}

export function authPath(): string {
  return join(configDir(), "auth.json");
}

export async function readStoredKey(): Promise<string | undefined> {
  try {
    const { apiKey } = JSON.parse(await readFile(authPath(), "utf8"));
    return typeof apiKey === "string" && apiKey ? apiKey : undefined;
  } catch {
    return undefined;
  }
}

export async function storeKey(apiKey: string): Promise<void> {
  const dir = configDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  if (!isWindows) {
    // mkdir's mode only applies when the directory is created, so tighten an
    // existing config directory that has group or other permissions.
    const mode = (await stat(dir)).mode & 0o777;
    if (mode !== 0o700) await chmod(dir, 0o700);
  }
  await writePrivateFile(authPath(), JSON.stringify({ apiKey }) + "\n");
}

/**
 * Writes `contents` to a unique temp file next to `path` and renames it into
 * place, so `path` is always either the old file or the fully written new one.
 */
async function writePrivateFile(path: string, contents: string): Promise<void> {
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let handle: FileHandle | undefined;
  try {
    handle = await open(tempPath, "wx", 0o600);
    // The umask can strip bits from open()'s mode, so set 0600 on the
    // descriptor explicitly.
    if (!isWindows) await handle.chmod(0o600);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(tempPath, path);
  } catch (error) {
    await handle?.close().catch(() => {});
    await rm(tempPath, { force: true });
    throw error;
  }
}

export async function deleteStoredKey(): Promise<void> {
  await rm(authPath(), { force: true });
}

/** Uses the key saved by `ai login` unless AI_GATEWAY_API_KEY is set. */
export async function applyStoredKey(): Promise<void> {
  if (process.env.AI_GATEWAY_API_KEY) {
    keySource = "env";
    return;
  }
  const apiKey = await readStoredKey();
  if (apiKey) {
    process.env.AI_GATEWAY_API_KEY = apiKey;
    keySource = "login";
  }
}

/** Returns false when AI Gateway rejects the key. */
export async function verifyKey(apiKey: string): Promise<boolean> {
  const baseURL =
    process.env.AI_GATEWAY_BASE_URL || "https://ai-gateway.vercel.sh";
  const response = await fetch(new URL("/v1/credits", baseURL), {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  if (response.status === 401 || response.status === 403) return false;
  if (!response.ok)
    throw new Error(`AI Gateway returned ${response.status} for the key check`);
  return true;
}

export function isAuthError(err: unknown): boolean {
  return err instanceof Error && err.name === "GatewayAuthenticationError";
}

/** Message for a failed generation, with the auth fix when the Gateway rejected the request. */
export function errorMessage(err: unknown): string {
  if (isAuthError(err)) return authErrorMessage();
  return err instanceof Error ? err.message : String(err);
}

export function authErrorMessage(): string {
  if (keySource === "env")
    return "AI Gateway rejected AI_GATEWAY_API_KEY. Check the key, or unset it and run `ai login`.";
  if (keySource === "login")
    return "AI Gateway rejected the key saved by `ai login`. Run `ai login` again.";
  return "Not signed in to AI Gateway. Run `ai login`, or set AI_GATEWAY_API_KEY.";
}

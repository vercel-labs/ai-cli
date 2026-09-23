import { createHash } from "crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { homedir } from "os";
import { join, resolve } from "path";

import type { Command } from "./command.js";
import { parsePositiveInt } from "./parse.js";

export const DEFAULT_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const CACHE_VERSION = 1;

export interface CacheEntry {
  data: Buffer | string;
  id?: string;
  mediaType?: string;
  createdAt: number;
  ttl: number;
}

export interface CacheStatus {
  dir: string;
  count: number;
  size: number;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export function getCacheDir(): string {
  const envDir =
    process.env.AI_CLI_CACHE_DIR?.trim() ||
    process.env.XDG_CACHE_HOME?.trim();
  if (envDir) return resolve(envDir.endsWith("ai-cli") ? envDir : join(envDir, "ai-cli"));
  return join(homedir(), ".cache", "ai-cli");
}

function metaPath(dir: string, key: string): string {
  return join(dir, "meta", `${key}.json`);
}

function blobPath(dir: string, key: string, isString: boolean): string {
  return join(dir, "blob", `${key}.${isString ? "txt" : "bin"}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function apiKeyHash(): string {
  const key =
    process.env.AI_GATEWAY_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    "";
  if (!key) return "nokey";
  return createHash("sha256").update(key).digest("hex").slice(0, 8);
}

function imageReferenceHash(ref: unknown): string {
  if (typeof ref === "string") {
    return createHash("sha256").update(ref).digest("hex").slice(0, 16);
  }
  if (ref instanceof Uint8Array) {
    return createHash("sha256").update(ref).digest("hex").slice(0, 16);
  }
  // Buffer or other
  try {
    return createHash("sha256")
      .update(ref as Uint8Array)
      .digest("hex")
      .slice(0, 16);
  } catch {
    return createHash("sha256")
      .update(String(ref))
      .digest("hex")
      .slice(0, 16);
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

// ---------------------------------------------------------------------------
// Key
// ---------------------------------------------------------------------------

export interface CacheKeyParams {
  command: string;
  model: string;
  prompt?: unknown;
  system?: string;
  temperature?: number;
  maxTokens?: number;
  imagesHash?: string[];
  providerOptions?: unknown;
  extra?: Record<string, unknown>;
}

export function cacheKey(params: CacheKeyParams): string {
  const canonical = {
    v: CACHE_VERSION,
    apiKeyHash: apiKeyHash(),
    command: params.command,
    model: params.model,
    prompt: params.prompt ?? null,
    system: params.system ?? null,
    temperature: params.temperature ?? null,
    maxTokens: params.maxTokens ?? null,
    imagesHash: params.imagesHash ?? null,
    providerOptions: params.providerOptions ?? null,
    extra: params.extra ?? null,
  };
  const serialized = stableStringify(canonical);
  return createHash("sha256").update(serialized).digest("hex");
}

export function imagesHashForRefs(refs: unknown[]): string[] {
  return refs.map(imageReferenceHash);
}

// ---------------------------------------------------------------------------
// Cache read/write
// ---------------------------------------------------------------------------

export function getCacheEntry(key: string, ttlSeconds?: number): CacheEntry | null {
  const dir = getCacheDir();
  const metaFile = metaPath(dir, key);
  if (!existsSync(metaFile)) return null;
  try {
    const raw = readFileSync(metaFile, "utf-8");
    const meta = JSON.parse(raw) as {
      createdAt: number;
      ttl: number;
      id?: string;
      mediaType?: string;
      isString: boolean;
    };
    const ttl = ttlSeconds ?? meta.ttl ?? DEFAULT_CACHE_TTL_SECONDS;
    if (ttl > 0 && Date.now() - meta.createdAt > ttl * 1000) {
      // expired
      try {
        rmSync(metaFile, { force: true });
      } catch {}
      const blob = blobPath(dir, key, meta.isString);
      try {
        rmSync(blob, { force: true });
      } catch {}
      return null;
    }
    const blob = blobPath(dir, key, meta.isString);
    if (!existsSync(blob)) return null;
    const data = meta.isString ? readFileSync(blob, "utf-8") : readFileSync(blob);
    // Return as Buffer for binary, string for text
    const entryData: Buffer | string = meta.isString ? (data as string) : (data as Buffer);
    return {
      data: entryData,
      id: meta.id,
      mediaType: meta.mediaType,
      createdAt: meta.createdAt,
      ttl: meta.ttl,
    };
  } catch {
    return null;
  }
}

export function setCacheEntry(
  key: string,
  entry: { data: Buffer | string; id?: string; mediaType?: string },
  ttlSeconds: number = DEFAULT_CACHE_TTL_SECONDS
): void {
  const dir = getCacheDir();
  const isString = typeof entry.data === "string";
  const metaFile = metaPath(dir, key);
  const blobFile = blobPath(dir, key, isString);
  // Clean opposite type if exists
  const opposite = blobPath(dir, key, !isString);
  try {
    if (existsSync(opposite)) rmSync(opposite, { force: true });
  } catch {}

  mkdirSync(join(dir, "meta"), { recursive: true });
  mkdirSync(join(dir, "blob"), { recursive: true });

  const meta = {
    v: CACHE_VERSION,
    key,
    createdAt: Date.now(),
    ttl: ttlSeconds,
    id: entry.id,
    mediaType: entry.mediaType,
    isString,
  };
  writeFileSync(metaFile, JSON.stringify(meta, null, 2));
  if (isString) {
    writeFileSync(blobFile, entry.data as string, "utf-8");
  } else {
    writeFileSync(blobFile, entry.data as Buffer);
  }
}

export function clearCache(): void {
  const dir = getCacheDir();
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

export function getCacheStatus(): CacheStatus {
  const dir = getCacheDir();
  if (!existsSync(dir)) return { dir, count: 0, size: 0 };
  let count = 0;
  let size = 0;
  const metaDir = join(dir, "meta");
  const blobDir = join(dir, "blob");
  for (const sub of [metaDir, blobDir]) {
    if (!existsSync(sub)) continue;
    const files = readdirSync(sub);
    count += sub === metaDir ? files.length : 0;
    for (const f of files) {
      try {
        const st = statSync(join(sub, f));
        if (st.isFile()) size += st.size;
      } catch {}
    }
  }
  return { dir, count, size };
}

export function pruneCache(opts: { maxSizeBytes?: number; ttlSeconds?: number }): { pruned: number } {
  const dir = getCacheDir();
  const metaDir = join(dir, "meta");
  if (!existsSync(metaDir)) return { pruned: 0 };
  let pruned = 0;

  // First, expire by TTL
  const ttl = opts.ttlSeconds;
  if (ttl !== undefined && ttl >= 0) {
    const files = readdirSync(metaDir);
    for (const f of files) {
      const key = f.replace(/\.json$/, "");
      const metaFile = join(metaDir, f);
      try {
        const raw = readFileSync(metaFile, "utf-8");
        const meta = JSON.parse(raw) as { createdAt: number; ttl: number; isString: boolean };
        const effectiveTtl = ttl;
        if (effectiveTtl > 0 && Date.now() - meta.createdAt > effectiveTtl * 1000) {
          rmSync(metaFile, { force: true });
          const blob = blobPath(dir, key, meta.isString);
          try {
            rmSync(blob, { force: true });
          } catch {}
          pruned++;
        }
      } catch {}
    }
  }

  // Then by max size (LRU)
  if (opts.maxSizeBytes !== undefined && opts.maxSizeBytes > 0) {
    const status = getCacheStatus();
    if (status.size > opts.maxSizeBytes) {
      // Collect entries sorted by mtime (oldest first)
      const entries: { key: string; mtime: number; size: number; isString: boolean }[] = [];
      const files = readdirSync(metaDir);
      for (const f of files) {
        const key = f.replace(/\.json$/, "");
        const metaFile = join(metaDir, f);
        try {
          const st = statSync(metaFile);
          const raw = readFileSync(metaFile, "utf-8");
          const meta = JSON.parse(raw) as { isString: boolean };
          const blob = blobPath(dir, key, meta.isString);
          let blobSize = 0;
          try {
            blobSize = statSync(blob).size;
          } catch {}
          entries.push({
            key,
            mtime: st.mtimeMs,
            size: st.size + blobSize,
            isString: meta.isString,
          });
        } catch {}
      }
      entries.sort((a, b) => a.mtime - b.mtime);
      let curSize = status.size;
      for (const e of entries) {
        if (curSize <= opts.maxSizeBytes) break;
        try {
          rmSync(metaPath(dir, e.key), { force: true });
          rmSync(blobPath(dir, e.key, e.isString), { force: true });
          // also try opposite
          rmSync(blobPath(dir, e.key, !e.isString), { force: true });
        } catch {}
        curSize -= e.size;
        pruned++;
      }
    }
  }

  return { pruned };
}

// ---------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------

export function parseCacheTtl(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`--cache-ttl must be a non-negative integer, got "${value}"`);
  }
  const n = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error(`--cache-ttl must be a non-negative integer, got "${value}"`);
  }
  return n;
}

export function resolveCacheTtl(opts: { cacheTtl?: string | number }): number {
  if (opts.cacheTtl !== undefined) {
    if (typeof opts.cacheTtl === "number") return opts.cacheTtl;
    return parseCacheTtl(opts.cacheTtl as string);
  }
  const env = process.env.AI_CLI_CACHE_TTL?.trim();
  if (env) return parseCacheTtl(env);
  return DEFAULT_CACHE_TTL_SECONDS;
}

export function shouldUseCache(opts: { cache?: boolean }): boolean {
  if (opts.cache === true) return true;
  if (opts.cache === false) return false;
  const env = process.env.AI_CLI_CACHE?.trim().toLowerCase();
  if (env === "1" || env === "true" || env === "yes") return true;
  if (env === "0" || env === "false" || env === "no") return false;
  return false;
}

export function addCacheOptions(command: Command): Command {
  return command
    .option("--cache", "Enable prompt caching (also via AI_CLI_CACHE=1)")
    .option("--no-cache", "Disable prompt caching even if env enables it")
    .option("--cache-ttl <seconds>", "Cache TTL in seconds", parseCacheTtl as unknown as (value: string, previous: unknown) => unknown);
}

export function parseMaxSize(value: string): number {
  const m = value.trim().toLowerCase();
  const match = m.match(/^(\d+(?:\.\d+)?)\s*(b|kb|k|mb|m|gb|g)?$/);
  if (!match) throw new Error(`--max-size must be like 500M, 1G, 1024 (got "${value}")`);
  const num = parseFloat(match[1]!);
  const unit = (match[2] || "b").toLowerCase();
  const mult: Record<string, number> = {
    b: 1,
    kb: 1024,
    k: 1024,
    mb: 1024 * 1024,
    m: 1024 * 1024,
    gb: 1024 * 1024 * 1024,
    g: 1024 * 1024 * 1024,
  };
  return Math.floor(num * (mult[unit] ?? 1));
}

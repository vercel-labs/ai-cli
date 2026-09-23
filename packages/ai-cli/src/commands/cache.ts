import type { Command } from "../lib/command.js";
import {
  clearCache,
  getCacheDir,
  getCacheStatus,
  parseMaxSize,
  pruneCache,
} from "../lib/cache.js";

export function registerCacheCommand(program: Command) {
  const cache = program
    .command("cache")
    .description("Manage local prompt cache");

  cache
    .command("status")
    .description("Show cache status")
    .option("--json", "Output as JSON")
    .action(async (_: unknown, opts: { json?: boolean }) => {
      const status = getCacheStatus();
      if (opts.json) {
        process.stdout.write(JSON.stringify(status, null, 2) + "\n");
        return;
      }
      const sizeStr = formatSize(status.size);
      process.stdout.write(`Cache dir: ${status.dir}\n`);
      process.stdout.write(`Entries: ${status.count}\n`);
      process.stdout.write(`Size: ${sizeStr} (${status.size} bytes)\n`);
    });

  cache
    .command("clear")
    .description("Clear all cached entries")
    .action(async () => {
      clearCache();
      process.stderr.write("Cache cleared\n");
    });

  cache
    .command("prune")
    .description("Prune expired and oversized cache entries")
    .option("--max-size <size>", "Max size (e.g. 500M, 1G)")
    .option("--ttl <seconds>", "Expire entries older than TTL")
    .action(async (_: unknown, opts: { maxSize?: string; ttl?: string }) => {
      let maxSizeBytes: number | undefined;
      if (opts.maxSize) maxSizeBytes = parseMaxSize(opts.maxSize);
      let ttlSeconds: number | undefined;
      if (opts.ttl) {
        const n = Number(opts.ttl);
        if (!/^\d+$/.test(opts.ttl) || !Number.isSafeInteger(n) || n < 0) {
          throw new Error(`--ttl must be a non-negative integer, got "${opts.ttl}"`);
        }
        ttlSeconds = n;
      } else {
        // default prune uses default TTL to expire old entries
        ttlSeconds = undefined;
      }
      // if no ttl given, use env/default TTL for expiry check
      // if ttl is undefined, pruneCache will skip TTL pass; we still want to expire old entries
      // So we pass TTL only if explicit, otherwise pruneCache handles max-size only plus we manually expire via default TTL
      // For simplicity, if no flags, prune expired entries using default TTL
      if (maxSizeBytes === undefined && ttlSeconds === undefined) {
        // expire old entries
        const { DEFAULT_CACHE_TTL_SECONDS } = await import("../lib/cache.js");
        ttlSeconds = DEFAULT_CACHE_TTL_SECONDS;
      }
      const result = pruneCache({ maxSizeBytes, ttlSeconds });
      process.stderr.write(`Pruned ${result.pruned} entries\n`);
    });

  cache
    .command("path")
    .description("Print cache directory path")
    .action(async () => {
      process.stdout.write(getCacheDir() + "\n");
    });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

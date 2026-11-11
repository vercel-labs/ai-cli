import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { authPath, readStoredKey, storeKey } from "./auth.js";

const posix = process.platform !== "win32";

async function modeOf(path: string): Promise<number> {
  return (await stat(path)).mode & 0o777;
}

describe.skipIf(!posix)("storeKey file permissions", () => {
  let root: string;
  let configDir: string;
  let previousConfigHome: string | undefined;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "ai-cli-auth-"));
    configDir = join(root, "ai-cli");
    previousConfigHome = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = root;
  });

  afterEach(async () => {
    if (previousConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousConfigHome;
    await rm(root, { recursive: true, force: true });
  });

  test("tightens an existing loose config dir and auth file", async () => {
    await mkdir(configDir, { mode: 0o755 });
    const path = authPath();
    await writeFile(path, JSON.stringify({ apiKey: "old" }) + "\n", {
      mode: 0o644,
    });
    await chmod(path, 0o644);

    await storeKey("new");

    expect(await modeOf(path)).toBe(0o600);
    expect(await modeOf(configDir)).toBe(0o700);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ apiKey: "new" });
    expect(await readdir(configDir)).toEqual(["auth.json"]);
  });

  test("creates a private config dir and auth file on a fresh install", async () => {
    await storeKey("fresh");

    expect(await modeOf(authPath())).toBe(0o600);
    expect(await modeOf(configDir)).toBe(0o700);
  });

  test("readStoredKey returns the key written by storeKey", async () => {
    await storeKey("fresh");

    expect(await readStoredKey()).toBe("fresh");
  });
});

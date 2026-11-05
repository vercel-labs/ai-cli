import { spawn } from "node:child_process";

import {
  API_KEYS_URL,
  authPath,
  deleteStoredKey,
  storeKey,
  verifyKey,
} from "../lib/auth.js";
import type { Command } from "../lib/command.js";
import { readStdin, stdinAsText } from "../lib/stdin.js";

function openBrowser(url: string): void {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "explorer.exe"
        : "xdg-open";
  const child = spawn(command, [url], { stdio: "ignore", detached: true });
  child.on("error", () => {});
  child.unref();
}

/** Reads one line from the terminal without echoing it. */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stderr.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const done = (result: string | Error) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      process.stderr.write("\n");
      if (result instanceof Error) reject(result);
      else resolve(result);
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") return done(value);
        if (char === "\u0003") {
          done(new Error("Login cancelled."));
          process.exit(130);
        }
        if (char === "\u007f") value = value.slice(0, -1);
        else value += char;
      }
    };
    stdin.on("data", onData);
  });
}

export function registerAuthCommands(program: Command): void {
  program
    .command("login")
    .description("Save an AI Gateway API key (prompts, or reads it from stdin)")
    .option("--no-open", "Do not open the API keys page")
    .option("--no-browser", "Do not open the API keys page")
    .hideOption("--no-browser")
    .action(
      async (_arg: unknown, opts: { open?: boolean; browser?: boolean }) => {
        let apiKey = "";
        if (!process.stdin.isTTY) {
          const input = await readStdin();
          apiKey = input ? stdinAsText(input) : "";
        } else if (process.env.CI === undefined && process.stderr.isTTY) {
          process.stderr.write(`Create an API key at ${API_KEYS_URL}\n`);
          if (opts.open !== false && opts.browser !== false)
            openBrowser(API_KEYS_URL);
          apiKey = await promptHidden("Paste your API key: ");
        }
        apiKey = apiKey.trim();
        if (!apiKey)
          throw new Error(
            "No API key provided. Pipe a key with `echo $KEY | ai login`, or set AI_GATEWAY_API_KEY."
          );
        process.stderr.write("Checking key with AI Gateway...\n");
        if (!(await verifyKey(apiKey)))
          throw new Error(
            "Invalid API key: AI Gateway rejected it. Nothing was saved."
          );
        await storeKey(apiKey);
        process.stderr.write(`Valid key. Saved to ${authPath()}\n`);
      }
    );

  program
    .command("logout")
    .description("Delete the API key saved by `ai login`")
    .action(async () => {
      await deleteStoredKey();
      process.stderr.write("Signed out.\n");
    });
}

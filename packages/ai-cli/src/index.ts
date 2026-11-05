#!/usr/bin/env node

import { runMcp } from "./commands/mcp.js";
import { applyStoredKey, authErrorMessage, isAuthError } from "./lib/auth.js";
import { CliUsageError } from "./lib/command.js";
import { redact } from "./lib/redact.js";
import { createProgram } from "./program.js";

const program = createProgram();

process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});

const terminatorIndex = process.argv.indexOf("--");
const noColorIndex = process.argv.indexOf("--no-color");
if (
  noColorIndex !== -1 &&
  (terminatorIndex === -1 || noColorIndex < terminatorIndex)
) {
  process.argv.splice(noColorIndex, 1);
  process.env.NO_COLOR = "1";
}

const args = process.argv.slice(2);
if (
  !["login", "logout", "mcp", "help"].includes(args[0] ?? "") &&
  !args.some((arg) => ["-h", "--help", "-v", "-V", "--version"].includes(arg))
) {
  await applyStoredKey();
}

if (process.argv[2] === "mcp") {
  await runMcp(program, process.argv.slice(3));
} else {
  program.parseAsync(process.argv).catch((caught: unknown) => {
    const err = isAuthError(caught) ? new Error(authErrorMessage()) : caught;
    const args = process.argv.slice(2);
    const flags = args.slice(
      0,
      args.indexOf("--") === -1 ? args.length : args.indexOf("--")
    );
    if (
      ["image", "video"].includes(args[0] ?? "") &&
      (flags.includes("--json") ||
        (args[0] === "video" && ["start", "status"].includes(args[1] ?? "")))
    ) {
      const error =
        err instanceof Error
          ? { name: redact(err.name), message: redact(err.message) }
          : { name: "Error", message: redact(String(err)) };
      process.stdout.write(JSON.stringify({ success: false, error }) + "\n");
    }
    if (err instanceof CliUsageError) {
      if (err.message) process.stderr.write(`Error: ${redact(err.message)}\n`);
      process.exit(1);
    }
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${redact(msg)}\n`);
    process.exit(1);
  });
}

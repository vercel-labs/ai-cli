#!/usr/bin/env node

import { runMcp } from "./commands/mcp.js";
import { CliUsageError } from "./lib/command.js";
import { createProgram } from "./program.js";

const program = createProgram();

if (process.argv[2] === "mcp") {
  await runMcp(program, process.argv.slice(3));
} else {
  program.parseAsync(process.argv).catch((err: unknown) => {
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
          ? { name: err.name, message: err.message }
          : { name: "Error", message: String(err) };
      process.stdout.write(JSON.stringify({ success: false, error }) + "\n");
    }
    if (err instanceof CliUsageError) {
      if (err.message) process.stderr.write(`error: ${err.message}\n`);
      process.exit(1);
    }
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${msg}\n`);
    process.exit(1);
  });
}

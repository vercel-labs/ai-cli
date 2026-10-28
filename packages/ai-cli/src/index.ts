#!/usr/bin/env node

import pkg from "../package.json";
import { registerAudioCommand } from "./commands/audio.js";
import { registerDecideCommand } from "./commands/decide.js";
import { registerImageCommand } from "./commands/image.js";
import { registerModelsCommand } from "./commands/models.js";
import { registerTextCommand } from "./commands/text.js";
import { registerVideoCommand } from "./commands/video.js";
import { CliUsageError, Command } from "./lib/command.js";
import { runInteractive } from "./lib/interactive.js";

const program = new Command();

program
  .name("ai")
  .description("Generate anything from your terminal")
  .version(pkg.version)
  .option("-i, --interactive", "Open the interactive terminal UI");

registerTextCommand(program);
registerImageCommand(program);
registerVideoCommand(program);
registerAudioCommand(program);
registerDecideCommand(program);
registerModelsCommand(program);

const [flag, ...extra] = process.argv.slice(2);
const interactive =
  (flag === "-i" || flag === "--interactive") && extra.length === 0;
const run = !interactive
  ? program.parseAsync(process.argv)
  : process.stdin.isTTY && process.stdout.isTTY
    ? runInteractive(program, pkg.version)
    : Promise.reject(new Error("--interactive needs a terminal"));

run.catch((err: unknown) => {
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

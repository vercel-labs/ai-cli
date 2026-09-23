#!/usr/bin/env node

import pkg from "../package.json";
import { registerAudioCommand } from "./commands/audio.js";
import { registerCacheCommand } from "./commands/cache.js";
import { registerEvaluateCommand } from "./commands/evaluate.js";
import { registerImageCommand } from "./commands/image.js";
import { registerModelsCommand } from "./commands/models.js";
import { registerTextCommand } from "./commands/text.js";
import { registerVideoCommand } from "./commands/video.js";
import { CliUsageError, Command } from "./lib/command.js";

const program = new Command();

program
  .name("ai")
  .description(
    "The AI SDK for your terminal: generate text and media, and evaluate typed questions"
  )
  .version(pkg.version);

registerTextCommand(program);
registerImageCommand(program);
registerVideoCommand(program);
registerAudioCommand(program);
registerEvaluateCommand(program);
registerModelsCommand(program);
registerCacheCommand(program);

program.parseAsync(process.argv).catch((err: unknown) => {
  if (err instanceof CliUsageError) {
    if (err.message) process.stderr.write(`error: ${err.message}\n`);
    process.exit(1);
  }
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Error: ${msg}\n`);
  process.exit(1);
});

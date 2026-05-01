#!/usr/bin/env bun
import { Command } from "commander";

import pkg from "../package.json";
import { registerCompletionsCommand } from "./commands/completions.js";
import { registerImageCommand } from "./commands/image.js";
import { registerModelsCommand } from "./commands/models.js";
import { registerTextCommand } from "./commands/text.js";
import { registerVideoCommand } from "./commands/video.js";

const program = new Command();

program
  .name("ai")
  .description(
    "A tiny, agent-native CLI for generating images, video and text with dead-simple commands, stdin support and predictable artifact outputs"
  )
  .version(pkg.version);

registerTextCommand(program);
registerImageCommand(program);
registerVideoCommand(program);
registerModelsCommand(program);
registerCompletionsCommand(program);

program.parseAsync(process.argv).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Error: ${msg}\n`);
  process.exit(1);
});

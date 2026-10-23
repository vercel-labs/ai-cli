import pkg from "../package.json";
import { registerAudioCommand } from "./commands/audio.js";
import { registerDecideCommand } from "./commands/decide.js";
import { registerImageCommand } from "./commands/image.js";
import { registerModelsCommand } from "./commands/models.js";
import { registerTextCommand } from "./commands/text.js";
import { registerVideoCommand } from "./commands/video.js";
import { Command } from "./lib/command.js";

export function createProgram(): Command {
  const program = new Command();

  program
    .name("ai")
    .description("Generate anything from your terminal")
    .version(pkg.version);

  registerTextCommand(program);
  registerImageCommand(program);
  registerVideoCommand(program);
  registerAudioCommand(program);
  registerDecideCommand(program);
  registerModelsCommand(program);
  program
    .command("mcp")
    .description("Start an MCP server over stdio (tools for every ai command)");

  return program;
}

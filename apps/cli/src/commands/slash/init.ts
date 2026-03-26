import type { CommandHandler } from "./types.js";

export const init: CommandHandler = () => ({
	output: 'run "ai init" from command line to setup api key',
});

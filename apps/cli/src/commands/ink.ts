import { terminal } from '../ui/terminal.js';

interface Options {
  model: string;
  version: string;
  resume?: string;
}

export async function inkCommand(options: Options): Promise<void> {
  await terminal(options.model, options.version, options.resume);
}

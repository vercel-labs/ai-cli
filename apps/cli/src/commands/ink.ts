import { terminal } from "../ui/terminal.js";

interface Options {
	model: string;
	version: string;
	resume?: string;
	planMode?: boolean;
	system?: string;
	fast?: boolean;
}

export async function inkCommand(options: Options): Promise<void> {
	await terminal(options.model, options.version, options.resume, {
		planMode: options.planMode,
		system: options.system,
		fast: options.fast,
	});
}

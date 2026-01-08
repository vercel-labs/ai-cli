import { render } from 'ink';
import { App } from '../components/app.js';

interface Options {
  model: string;
  version: string;
}

export async function inkCommand(options: Options): Promise<void> {
  const { waitUntilExit } = render(<App model={options.model} version={options.version} />);
  await waitUntilExit();
}

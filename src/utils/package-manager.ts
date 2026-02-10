import * as fs from 'node:fs';
import * as path from 'node:path';

export function detectPackageManager(): { pm: string; run: string } {
  const cwd = process.cwd();

  if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) {
    return { pm: 'pnpm', run: 'pnpm' };
  }
  if (fs.existsSync(path.join(cwd, 'bun.lockb'))) {
    return { pm: 'bun', run: 'bun' };
  }
  if (fs.existsSync(path.join(cwd, 'yarn.lock'))) {
    return { pm: 'yarn', run: 'yarn' };
  }
  if (fs.existsSync(path.join(cwd, 'package-lock.json'))) {
    return { pm: 'npm', run: 'npm run' };
  }

  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(cwd, 'package.json'), 'utf-8'),
    );
    if (pkg.packageManager) {
      const pm = pkg.packageManager.split('@')[0];
      return { pm, run: pm === 'npm' ? 'npm run' : pm };
    }
  } catch {}

  return { pm: 'npm', run: 'npm run' };
}

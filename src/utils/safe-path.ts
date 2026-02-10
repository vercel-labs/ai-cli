import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Resolves a file path and checks that it stays within the project directory.
 * Follows symlinks when the target exists to prevent symlink escapes.
 * Returns the resolved path or null if it escapes the boundary.
 */
export function safePath(filePath: string): string | null {
  const cwd = fs.realpathSync(process.cwd());
  let resolved: string;
  try {
    resolved = fs.realpathSync(path.resolve(filePath));
  } catch {
    // File may not exist yet (e.g. write-file); fall back to path.resolve
    resolved = path.resolve(filePath);
  }
  if (resolved.startsWith(cwd + path.sep) || resolved === cwd) {
    return resolved;
  }
  return null;
}

/**
 * Returns a human-readable error when a path escapes the project boundary.
 */
export function pathError(filePath: string): string {
  return `path outside project: ${filePath}`;
}

import * as path from 'node:path';

const cwd = process.cwd();

/**
 * Resolves a file path and checks that it stays within the project directory.
 * Returns the resolved path or null if it escapes the boundary.
 */
export function safePath(filePath: string): string | null {
  const resolved = path.resolve(filePath);
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

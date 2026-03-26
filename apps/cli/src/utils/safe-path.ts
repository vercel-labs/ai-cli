import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Expands a leading `~` or `~user` to the home directory.
 */
function expandTilde(filePath: string): string {
	if (filePath === "~" || filePath.startsWith("~/")) {
		return path.join(os.homedir(), filePath.slice(1));
	}
	return filePath;
}

/**
 * Resolves a file path and checks that it stays within the project directory.
 * Follows symlinks when the target exists to prevent symlink escapes.
 * Returns the resolved path or null if it escapes the boundary.
 */
export function safePath(filePath: string): string | null {
	const cwd = fs.realpathSync(process.cwd());
	let resolved: string;
	try {
		resolved = fs.realpathSync(path.resolve(expandTilde(filePath)));
	} catch {
		// File may not exist yet (e.g. write-file); fall back to path.resolve
		resolved = path.resolve(expandTilde(filePath));
	}
	if (resolved.startsWith(cwd + path.sep) || resolved === cwd) {
		return resolved;
	}
	return null;
}

/**
 * Resolves a file path without enforcing the project boundary.
 * Use only after the user has explicitly confirmed access.
 */
export function resolveAnyPath(filePath: string): string {
	const expanded = expandTilde(filePath);
	try {
		return fs.realpathSync(path.resolve(expanded));
	} catch {
		return path.resolve(expanded);
	}
}

/**
 * Returns a human-readable error when a path escapes the project boundary.
 */
export function pathError(filePath: string): string {
	return `path outside project: ${filePath}`;
}

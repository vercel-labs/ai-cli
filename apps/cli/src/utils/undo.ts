import * as fs from "node:fs";
import * as path from "node:path";

type Operation =
	| { type: "write"; path: string; previous: string | null; timestamp: number }
	| { type: "delete"; path: string; content: string; timestamp: number }
	| { type: "rename"; oldPath: string; newPath: string; timestamp: number };

const stack: Operation[] = [];
const MAX_STACK = 50;

export function saveWrite(filePath: string): void {
	const fullPath = path.resolve(filePath);
	let previous: string | null = null;
	if (fs.existsSync(fullPath)) {
		try {
			previous = fs.readFileSync(fullPath, "utf8");
		} catch {
			// File exists but unreadable (e.g. binary) - treat as no previous content
			previous = null;
		}
	}
	stack.push({
		type: "write",
		path: fullPath,
		previous,
		timestamp: Date.now(),
	});
	if (stack.length > MAX_STACK) {
		stack.shift();
	}
}

export function saveDelete(filePath: string): void {
	const fullPath = path.resolve(filePath);
	try {
		const content = fs.readFileSync(fullPath, "utf8");
		stack.push({
			type: "delete",
			path: fullPath,
			content,
			timestamp: Date.now(),
		});
		if (stack.length > MAX_STACK) {
			stack.shift();
		}
	} catch {
		// File may be binary or inaccessible - skip undo tracking
	}
}

export function saveRename(oldPath: string, newPath: string): void {
	const fullOld = path.resolve(oldPath);
	const fullNew = path.resolve(newPath);
	stack.push({
		type: "rename",
		oldPath: fullOld,
		newPath: fullNew,
		timestamp: Date.now(),
	});
	if (stack.length > MAX_STACK) {
		stack.shift();
	}
}

export function canUndo(): boolean {
	return stack.length > 0;
}

export function undoOne(): { success: boolean; message: string } {
	const op = stack.pop();
	if (!op) {
		return { success: false, message: "nothing to undo" };
	}
	return applyUndo(op);
}

function applyUndo(op: Operation): { success: boolean; message: string } {
	try {
		if (op.type === "write") {
			if (op.previous === null) {
				if (fs.existsSync(op.path)) {
					fs.unlinkSync(op.path);
				}
				return { success: true, message: `deleted ${path.basename(op.path)}` };
			}
			fs.writeFileSync(op.path, op.previous, "utf8");
			return { success: true, message: `restored ${path.basename(op.path)}` };
		}

		if (op.type === "delete") {
			const dir = path.dirname(op.path);
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true });
			}
			fs.writeFileSync(op.path, op.content, "utf8");
			return { success: true, message: `restored ${path.basename(op.path)}` };
		}

		if (op.type === "rename") {
			if (fs.existsSync(op.newPath)) {
				const oldDir = path.dirname(op.oldPath);
				if (!fs.existsSync(oldDir)) {
					fs.mkdirSync(oldDir, { recursive: true });
				}
				fs.renameSync(op.newPath, op.oldPath);
				return {
					success: true,
					message: `renamed back to ${path.basename(op.oldPath)}`,
				};
			}
			return { success: false, message: "file no longer exists" };
		}

		return { success: false, message: "unknown operation" };
	} catch (error) {
		return {
			success: false,
			message: error instanceof Error ? error.message : String(error),
		};
	}
}

export function undoCount(): number {
	return stack.length;
}

export function getStack(): {
	index: number;
	action: string;
	file: string;
	time: string;
}[] {
	return stack
		.map((op, i) => {
			const time = formatTime(op.timestamp);
			if (op.type === "write") {
				const action = op.previous === null ? "created" : "modified";
				return { index: i + 1, action, file: path.basename(op.path), time };
			}
			if (op.type === "delete") {
				return {
					index: i + 1,
					action: "deleted",
					file: path.basename(op.path),
					time,
				};
			}
			if (op.type === "rename") {
				return {
					index: i + 1,
					action: "renamed",
					file: path.basename(op.oldPath),
					time,
				};
			}
			return { index: i + 1, action: "unknown", file: "", time };
		})
		.toReversed();
}

export function rollbackTo(index: number): {
	success: boolean;
	message: string;
	count: number;
} {
	if (index < 1 || index > stack.length) {
		return { success: false, message: "invalid index", count: 0 };
	}

	const target = stack.length - index;
	let count = 0;
	const errors: string[] = [];

	while (stack.length > target) {
		const op = stack.pop();
		if (op) {
			const result = applyUndo(op);
			if (result.success) {
				count++;
			} else {
				errors.push(result.message);
			}
		}
	}

	if (errors.length > 0) {
		return { success: false, message: errors.join(", "), count };
	}
	return { success: true, message: `rolled back ${count} change(s)`, count };
}

export function hasChangedFiles(): boolean {
	return stack.some((op) => op.type === "write" || op.type === "delete");
}

export function getChangedFilesWithOriginals(): {
	path: string;
	original: string | null;
}[] {
	const seen = new Map<string, string | null>();
	for (const op of stack) {
		if (op.type === "write" && !seen.has(op.path)) {
			seen.set(op.path, op.previous);
		} else if (op.type === "delete" && !seen.has(op.path)) {
			seen.set(op.path, op.content);
		}
	}
	return [...seen.entries()].map(([p, original]) => ({ path: p, original }));
}

function formatTime(ts: number): string {
	const diff = Math.floor((Date.now() - ts) / 1000);
	if (diff < 60) {
		return `${diff}s ago`;
	}
	if (diff < 3600) {
		return `${Math.floor(diff / 60)}m ago`;
	}
	return `${Math.floor(diff / 3600)}h ago`;
}

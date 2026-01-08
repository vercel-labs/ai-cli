import * as fs from 'node:fs';
import * as path from 'node:path';

type Operation =
  | { type: 'write'; path: string; previous: string | null }
  | { type: 'delete'; path: string; content: string }
  | { type: 'rename'; oldPath: string; newPath: string };

const stack: Operation[] = [];
const MAX_STACK = 50;

export function saveWrite(filePath: string): void {
  const fullPath = path.resolve(filePath);
  let previous: string | null = null;
  if (fs.existsSync(fullPath)) {
    try {
      previous = fs.readFileSync(fullPath, 'utf-8');
    } catch {
      previous = null;
    }
  }
  stack.push({ type: 'write', path: fullPath, previous });
  if (stack.length > MAX_STACK) stack.shift();
}

export function saveDelete(filePath: string): void {
  const fullPath = path.resolve(filePath);
  try {
    const content = fs.readFileSync(fullPath, 'utf-8');
    stack.push({ type: 'delete', path: fullPath, content });
    if (stack.length > MAX_STACK) stack.shift();
  } catch {
  }
}

export function saveRename(oldPath: string, newPath: string): void {
  const fullOld = path.resolve(oldPath);
  const fullNew = path.resolve(newPath);
  stack.push({ type: 'rename', oldPath: fullOld, newPath: fullNew });
  if (stack.length > MAX_STACK) stack.shift();
}

export function canUndo(): boolean {
  return stack.length > 0;
}

export function undo(): { success: boolean; message: string } {
  const op = stack.pop();
  if (!op) {
    return { success: false, message: 'nothing to undo' };
  }

  try {
    if (op.type === 'write') {
      if (op.previous === null) {
        if (fs.existsSync(op.path)) {
          fs.unlinkSync(op.path);
        }
        return { success: true, message: `deleted ${path.basename(op.path)}` };
      }
      fs.writeFileSync(op.path, op.previous, 'utf-8');
      return { success: true, message: `restored ${path.basename(op.path)}` };
    }

    if (op.type === 'delete') {
      const dir = path.dirname(op.path);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(op.path, op.content, 'utf-8');
      return { success: true, message: `restored ${path.basename(op.path)}` };
    }

    if (op.type === 'rename') {
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
      return { success: false, message: 'file no longer exists' };
    }

    return { success: false, message: 'unknown operation' };
  } catch (e) {
    return { success: false, message: (e as Error).message };
  }
}

export function undoCount(): number {
  return stack.length;
}

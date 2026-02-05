import * as fs from 'node:fs';
import * as path from 'node:path';
import { getClipboardImage } from '../../utils/clipboard.js';
import type { CommandHandler } from './types.js';

const imageTypes: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

export interface PendingImage {
  data: string;
  mimeType: string;
}

let pendingImage: PendingImage | null = null;

export function getPendingImage(): PendingImage | null {
  const img = pendingImage;
  pendingImage = null;
  return img;
}

export function hasPendingImage(): boolean {
  return pendingImage !== null;
}

export function clearPendingImage(): void {
  pendingImage = null;
}

export const image: CommandHandler = (_ctx, args) => {
  if (args === 'clear') {
    pendingImage = null;
    return { output: 'image cleared' };
  }

  if (args && args !== 'paste') {
    const filePath = path.resolve(args);
    if (!fs.existsSync(filePath)) {
      return { output: 'file not found' };
    }
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = imageTypes[ext];
    if (!mimeType) {
      return { output: 'unsupported format (use png, jpg, gif, webp)' };
    }
    const buffer = fs.readFileSync(filePath);
    pendingImage = { data: buffer.toString('base64'), mimeType };
    return { output: '[image attached]' };
  }

  const buffer = getClipboardImage();
  if (!buffer) {
    return { output: 'no image in clipboard' };
  }

  pendingImage = { data: buffer.toString('base64'), mimeType: 'image/png' };
  return { output: '[image attached from clipboard]' };
};

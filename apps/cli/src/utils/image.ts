import * as fs from "node:fs";
import * as path from "node:path";

export const IMAGE_MIME_TYPES: Record<string, string> = {
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".png": "image/png",
	".gif": "image/gif",
	".webp": "image/webp",
};

export interface PendingImage {
	data: string;
	mimeType: string;
}

export function loadImage(imagePath: string): PendingImage {
	const resolved = path.resolve(imagePath);
	if (!fs.existsSync(resolved)) {
		throw new Error(`image not found: ${imagePath}`);
	}
	const ext = path.extname(resolved).toLowerCase();
	const mimeType = IMAGE_MIME_TYPES[ext];
	if (!mimeType) {
		throw new Error("unsupported format. use: png, jpg, gif, webp");
	}
	const buffer = fs.readFileSync(resolved);
	return { data: buffer.toString("base64"), mimeType };
}

export function extractJsonStringValue(
	text: string,
	key: string,
): { value: string; complete: boolean } | null {
	const marker = `"${key}":"`;
	const idx = text.indexOf(marker);
	if (idx === -1) {
		return null;
	}

	const start = idx + marker.length;
	let value = "";
	let escaped = false;
	let complete = false;

	for (let i = start; i < text.length; i++) {
		const ch = text[i];
		if (escaped) {
			switch (ch) {
				case "n": {
					value += "\n";
					break;
				}
				case "t": {
					value += "\t";
					break;
				}
				case '"': {
					value += '"';
					break;
				}
				case "\\": {
					value += "\\";
					break;
				}
				case "r": {
					value += "\r";
					break;
				}
				case "u": {
					const hex = text.slice(i + 1, i + 5);
					if (hex.length === 4 && /^[0-9a-fA-F]{4}$/.test(hex)) {
						value += String.fromCodePoint(Number.parseInt(hex, 16));
						i += 4;
					} else {
						value += "u";
					}
					break;
				}
				default: {
					value += ch;
				}
			}
			escaped = false;
		} else if (ch === "\\") {
			escaped = true;
		} else if (ch === '"') {
			complete = true;
			break;
		} else {
			value += ch;
		}
	}

	return { value, complete };
}

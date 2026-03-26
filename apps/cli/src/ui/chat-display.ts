import { getSetting } from "../config/settings.js";
import { dim, dimmer } from "../utils/color.js";
import { renderMarkdown } from "../utils/markdown.js";
import { mask } from "../utils/mask.js";
import { wrap } from "../utils/wrap.js";

export type MessageType = "user" | "assistant" | "tool" | "error" | "info";

export interface Message {
	type: MessageType;
	content: string;
}

export function trimLeadingBlankLines(text: string): string {
	return text.replace(/^(?:\r?\n)+/, "");
}

export function formatToolOutput(text: string): string {
	const TAIL = 5;
	const lines = text.split("\n");

	if (lines[0]?.startsWith("$ ")) {
		const command = lines[0].slice(2);
		const body = lines.slice(1);
		const header = `Ran ${command}`;

		if (body.length === 0) {
			return header;
		}

		if (body.length > TAIL) {
			const hidden = body.length - TAIL;
			const tail = body.slice(-TAIL).map((l) => `  ${l}`);
			return `${header}\n  ... ${hidden} lines ...\n${tail.join("\n")}`;
		}
		return `${header}\n${body.map((l) => `  ${l}`).join("\n")}`;
	}

	if (lines[0]?.startsWith("> ")) {
		const header = lines[0].slice(2);
		const body = lines.slice(1);

		if (body.length === 0) {
			return header;
		}

		if (body.length > TAIL) {
			const hidden = body.length - TAIL;
			const tail = body.slice(-TAIL).map((l) => `  ${l}`);
			return `${header}\n  ... ${hidden} lines ...\n${tail.join("\n")}`;
		}
		return `${header}\n${body.map((l) => `  ${l}`).join("\n")}`;
	}

	if (lines.length > TAIL) {
		const hidden = lines.length - TAIL;
		const tail = lines.slice(-TAIL).map((l) => `  ${l}`);
		return `  ... ${hidden} lines ...\n${tail.join("\n")}`;
	}
	return lines.map((l) => `  ${l}`).join("\n");
}

export function printMessage(
	msg: Message,
	write: (text: string) => void,
	trailing = true,
): void {
	const markdown = getSetting("markdown");
	switch (msg.type) {
		case "user": {
			const wrapped = wrap(msg.content);
			const userLines = wrapped.split("\n");
			const formatted = userLines
				.map((l, i) => (i === 0 ? `${dim("› ")}${l}` : `${dim("  ")}${l}`))
				.join("\n");
			write(`${formatted}\n${trailing ? "\n" : ""}`);
			break;
		}
		case "assistant": {
			const assistant = trimLeadingBlankLines(msg.content);
			const content = markdown ? renderMarkdown(assistant) : assistant;
			write(`${wrap(mask(content))}\n`);
			break;
		}
		case "tool": {
			const formatted = formatToolOutput(mask(msg.content));
			const nlIdx = formatted.indexOf("\n");
			if (nlIdx !== -1) {
				const header = formatted.slice(0, nlIdx);
				const body = formatted.slice(nlIdx + 1);
				write(`${dim(header)}\n${dimmer(body)}\n${trailing ? "\n" : ""}`);
			} else {
				write(`${dim(formatted)}\n${trailing ? "\n" : ""}`);
			}
			break;
		}
		case "info": {
			const nlIdx = msg.content.indexOf("\n");
			const firstLine =
				nlIdx !== -1 ? msg.content.slice(0, nlIdx) : msg.content;
			write(`${dim(firstLine)}\n`);
			if (nlIdx !== -1) {
				write(`${msg.content.slice(nlIdx + 1)}\n`);
			}
			if (trailing) {
				write("\n");
			}
			break;
		}
		case "error": {
			write(`${dim(`error: ${wrap(msg.content)}`)}\n`);
			break;
		}
	}
}

export function renderChatDisplay(
	display: { type: string; content: string }[],
	write: (text: string) => void,
	addAndPrint: (type: MessageType, content: string) => void,
): void {
	const spacingLines = getSetting("spacing") ?? 1;
	let lastType = "";
	for (let i = 0; i < display.length; i++) {
		const m = display[i];
		const isLast = i === display.length - 1;
		if (lastType === "info" && m.type !== "info") {
			write("\n".repeat(spacingLines));
		}
		addAndPrint(m.type as MessageType, m.content);
		if (!isLast && m.type !== "user" && m.type !== "info") {
			write("\n".repeat(spacingLines));
		}
		lastType = m.type;
	}
}

export function getChatDisplay(chatData: {
	display?: { type: string; content: string }[];
	messages: { role: string; content: string }[];
}): { type: string; content: string }[] {
	return chatData.display?.length
		? chatData.display
		: chatData.messages.map((m) => ({
				type: m.role,
				content: m.content,
			}));
}

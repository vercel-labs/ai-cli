import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
}

export interface DisplayMessage {
  type: 'user' | 'assistant' | 'tool' | 'error' | 'info';
  content: string;
}

export interface Chat {
  id: string;
  title: string;
  messages: ChatMessage[];
  display?: DisplayMessage[];
  model: string;
  tokens: number;
  cost: number;
  summary?: string;
  createdAt: number;
  updatedAt: number;
}

const CHATS_DIR = path.join(os.homedir(), '.ai-chats');

function ensureChatsDir() {
  if (!fs.existsSync(CHATS_DIR)) {
    fs.mkdirSync(CHATS_DIR, { recursive: true });
  }
}

function getChatPath(id: string) {
  return path.join(CHATS_DIR, `${id}.json`);
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function createChat(model: string): Chat {
  ensureChatsDir();
  const chat: Chat = {
    id: generateId(),
    title: 'New chat',
    messages: [],
    model,
    tokens: 0,
    cost: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  saveChat(chat);
  return chat;
}

export function saveChat(chat: Chat): void {
  ensureChatsDir();
  chat.updatedAt = Date.now();
  if (chat.messages.length > 0 && chat.title === 'New chat') {
    const firstMsg = chat.messages.find((m) => m.role === 'user');
    if (firstMsg) {
      chat.title = firstMsg.content.slice(0, 50).trim();
      if (firstMsg.content.length > 50) chat.title += '...';
    }
  }
  fs.writeFileSync(getChatPath(chat.id), JSON.stringify(chat));
}

export function loadChat(id: string): Chat | null {
  try {
    const data = fs.readFileSync(getChatPath(id), 'utf-8');
    return JSON.parse(data) as Chat;
  } catch {
    return null;
  }
}

export function listChats(): Chat[] {
  ensureChatsDir();
  try {
    const files = fs.readdirSync(CHATS_DIR).filter((f) => f.endsWith('.json'));
    const chats: Chat[] = [];
    for (const file of files) {
      try {
        const data = fs.readFileSync(path.join(CHATS_DIR, file), 'utf-8');
        chats.push(JSON.parse(data) as Chat);
      } catch {
        // skip invalid files
      }
    }
    return chats.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export function deleteChat(id: string): boolean {
  try {
    fs.unlinkSync(getChatPath(id));
    return true;
  } catch {
    return false;
  }
}

export function deleteAllChats(): number {
  const chats = listChats();
  let deleted = 0;
  for (const chat of chats) {
    if (deleteChat(chat.id)) deleted++;
  }
  return deleted;
}

export function searchChats(query: string): Chat[] {
  const chats = listChats();
  const q = query.toLowerCase();
  return chats.filter(
    (c) =>
      c.title.toLowerCase().includes(q) ||
      c.messages.some(
        (m) => m.role === 'user' && m.content.toLowerCase().includes(q),
      ),
  );
}

export function findEmptyChat(): Chat | null {
  const chats = listChats();
  return chats.find((c) => c.messages.length === 0) || null;
}

export function getOrCreateChat(model: string): Chat {
  const empty = findEmptyChat();
  if (empty) {
    empty.model = model;
    saveChat(empty);
    return empty;
  }
  return createChat(model);
}

import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { tool } from 'ai';
import { z } from 'zod';

async function fetchWithJina(url: string): Promise<{ content: string } | null> {
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      signal: AbortSignal.timeout(30000),
      headers: { 'Accept': 'text/plain' },
    });
    if (res.ok) {
      const text = await res.text();
      if (text.length > 100) {
        return { content: text.slice(0, 20000) };
      }
    }
  } catch {
    return null;
  }
  return null;
}

async function fetchWithReadability(url: string): Promise<Record<string, string> | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(30000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8',
      },
      redirect: 'follow',
    });
    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') || '';
    const html = await res.text();

    if (contentType.includes('application/json')) {
      try {
        return { content: JSON.stringify(JSON.parse(html), null, 2).slice(0, 20000), type: 'json' };
      } catch {
        return { content: html.slice(0, 20000), type: 'json' };
      }
    }

    if (contentType.includes('text/plain') || contentType.includes('text/markdown')) {
      return { content: html.slice(0, 20000), type: 'text' };
    }

    const { document } = parseHTML(html);
    const reader = new Readability(document);
    const article = reader.parse();

    if (article?.textContent) {
      const result: Record<string, string> = {};
      if (article.title) result.title = article.title;
      if (article.byline) result.author = article.byline;
      result.content = article.textContent.slice(0, 20000);
      return result;
    }
  } catch {
    return null;
  }
  return null;
}

function normalizeUrl(url: string): string {
  let normalized = url.trim();
  if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    normalized = 'https://' + normalized;
  }
  return normalized;
}

export const fetchUrl = tool({
  description: 'Fetch and read content from a URL. Use for reading webpages, documentation, articles.',
  inputSchema: z.object({
    url: z.string().describe('The URL to fetch'),
  }),
  execute: async ({ url }): Promise<{ content?: string; title?: string; author?: string; type?: string; error?: string }> => {
    try {
      const normalized = normalizeUrl(url);

      const jina = await fetchWithJina(normalized);
      if (jina && jina.content) return jina;

      const readability = await fetchWithReadability(normalized);
      if (readability && readability.content) return readability;

      return { error: 'fetch failed' };
    } catch {
      return { error: 'fetch failed' };
    }
  },
});

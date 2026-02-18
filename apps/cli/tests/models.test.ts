import { describe, expect, test } from 'bun:test';
import { getModelCapabilities } from '../src/utils/models.js';

describe('getModelCapabilities reasoning detection', () => {
  const reasoning = [
    'openai/o1',
    'openai/o1-mini',
    'openai/o3-mini',
    'openai/o4-mini',
    'anthropic/claude-3.5-sonnet-thinking',
    'some-reasoner',
    'deep-reasoning-v2',
    'custom/reason-model',
  ];

  const nonReasoning = [
    'anthropic/claude-sonnet-4.5',
    'google/gemini-2.0-flash',
    'openai/gpt-4o',
    'openai/gpt-4o-mini',
    'meta/llama-3-70b',
    'mistral/mistral-large',
  ];

  for (const id of reasoning) {
    test(`detects reasoning for ${id}`, async () => {
      const caps = await getModelCapabilities(id);
      expect(caps.reasoning).toBe(true);
    });
  }

  for (const id of nonReasoning) {
    test(`no reasoning for ${id}`, async () => {
      const caps = await getModelCapabilities(id);
      expect(caps.reasoning).toBe(false);
    });
  }
});

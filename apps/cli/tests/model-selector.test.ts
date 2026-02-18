import { describe, expect, test } from 'bun:test';
import { ModelSelector } from '../src/ui/model-selector.js';

const models = [
  'openai/gpt-4o',
  'anthropic/claude-sonnet-4.5',
  'google/gemini-2.0-flash',
];

function create(): { selector: ModelSelector; output: string[] } {
  const output: string[] = [];
  const selector = new ModelSelector((text) => {
    output.push(text);
  });
  return { selector, output };
}

describe('ModelSelector', () => {
  test('enter activates selector and selects first model', () => {
    const { selector } = create();
    expect(selector.active).toBe(false);
    selector.enter(models, models[0]);
    expect(selector.active).toBe(true);
    expect(selector.getSelected()).toBe(models[0]);
  });

  test('enter pre-selects the current model', () => {
    const { selector } = create();
    selector.enter(models, 'anthropic/claude-sonnet-4.5');
    expect(selector.getSelected()).toBe('anthropic/claude-sonnet-4.5');
  });

  test('exit deactivates selector', () => {
    const { selector } = create();
    selector.enter(models, models[0]);
    selector.exit();
    expect(selector.active).toBe(false);
    expect(selector.buffer).toBe('');
  });

  test('escape returns cancel', () => {
    const { selector } = create();
    selector.enter(models, models[0]);
    expect(selector.handleInput('\x1b')).toBe('cancel');
  });

  test('ctrl+c returns cancel', () => {
    const { selector } = create();
    selector.enter(models, models[0]);
    expect(selector.handleInput('\x03')).toBe('cancel');
  });

  test('backspace on empty buffer returns cancel', () => {
    const { selector } = create();
    selector.enter(models, models[0]);
    expect(selector.handleInput('\x7f')).toBe('cancel');
  });

  test('enter key returns select', () => {
    const { selector } = create();
    selector.enter(models, models[0]);
    expect(selector.handleInput('\r')).toBe('select');
  });

  test('printable characters append to buffer', () => {
    const { selector } = create();
    selector.enter(models, models[0]);
    expect(selector.handleInput('g')).toBe('handled');
    expect(selector.handleInput('p')).toBe('handled');
    expect(selector.handleInput('t')).toBe('handled');
    expect(selector.buffer).toBe('gpt');
  });

  test('backspace removes last character from buffer', () => {
    const { selector } = create();
    selector.enter(models, models[0]);
    selector.handleInput('a');
    selector.handleInput('b');
    expect(selector.buffer).toBe('ab');
    expect(selector.handleInput('\x7f')).toBe('handled');
    expect(selector.buffer).toBe('a');
  });

  test('arrow keys return handled', () => {
    const { selector } = create();
    selector.enter(models, models[0]);
    expect(selector.handleInput('\x1b[A')).toBe('handled');
    expect(selector.handleInput('\x1b[B')).toBe('handled');
  });

  test('tab completes with selected model', () => {
    const { selector } = create();
    selector.enter(models, models[0]);
    expect(selector.handleInput('\t')).toBe('handled');
    expect(selector.buffer).toBe(models[0]);
  });

  test('redraw uses injected write function', () => {
    const { selector, output } = create();
    selector.enter(models, models[0]);
    expect(output.length).toBeGreaterThan(0);
    expect(output.some((s) => s.includes('model'))).toBe(true);
  });
});

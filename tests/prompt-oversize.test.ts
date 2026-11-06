import { describe, expect, it } from 'vitest';
import { LlmError } from '@deepseek-ai/dsh-llm';
import { buildPrompt } from '../src/prompt.js';
import { resolveConfig } from '../src/config.js';

// Requests that still exceed the budget used to be sent anyway, and the
// official server silently dropped everything past 192,000 bytes.
const msg = (role: string, kind: string, t: string) => ({
  role,
  content: [{ type: 'text' as const, text: t }],
  source: { kind },
});
const bytes = (s: string) => Buffer.byteLength(s, 'utf8');
const build = (messages: unknown[]) =>
  buildPrompt({ messages } as never, resolveConfig({ toolPolicy: 'text-only' }));

describe('oversized requests are never truncated silently', () => {
  it('restates only an excerpt of a very long latest message', () => {
    const pasted = 'PASTE_START ' + 'x'.repeat(120000) + ' PASTE_END';
    const prompt = build([
      msg('user', 'agent-instructions', 'AGENTS_MD_RULES'),
      msg('user', 'user', pasted),
    ]);
    expect(bytes(prompt)).toBeLessThanOrEqual(180000);
    expect(prompt.match(/PASTE_END/g)).toHaveLength(1);
    const tail = prompt.slice(prompt.lastIndexOf('}') + 1);
    expect(tail).toContain('PASTE_START');
    expect(tail).toMatch(/excerpt/i);
  });

  it('keeps short latest messages restated in full', () => {
    const prompt = build([msg('user', 'user', 'qué modelo eres?')]);
    const tail = prompt.slice(prompt.lastIndexOf('}') + 1);
    expect(tail).toContain('qué modelo eres?');
    expect(tail).not.toMatch(/excerpt/i);
  });

  it('fails with a clear error when the request cannot fit at all', () => {
    const huge = 'y'.repeat(200000);
    let error: unknown;
    try {
      build([msg('user', 'user', huge)]);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).code).toBe('ACP_PROMPT_TOO_LARGE');
    expect((error as Error).message).toMatch(/KB/);
  });
});

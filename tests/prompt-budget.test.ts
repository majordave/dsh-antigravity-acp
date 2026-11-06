import { describe, expect, it } from 'vitest';
import { buildPrompt } from '../src/prompt.js';
import { resolveConfig } from '../src/config.js';

// The official Antigravity server keeps only the first 192,000 bytes of a
// prompt and silently drops the rest, so the newest messages (including the
// human's latest request) never reached the model in long sessions.
const text = (t: string) => [{ type: 'text' as const, text: t }];
const msg = (role: string, kind: string, t: string, extra: object = {}) => ({
  role,
  content: text(t),
  source: { kind },
  ...extra,
});
const bytes = (s: string) => Buffer.byteLength(s, 'utf8');

function longSession() {
  const messages: unknown[] = [
    msg('system', 'system-prompt', 'You are an AI agent powered by DeepSeek Harness.'),
    msg('user', 'agent-instructions', 'AGENTS_MD_RULES ' + 'r'.repeat(15000)),
    msg('user', 'skill-catalog', 'SKILL_CATALOG ' + 's'.repeat(25000)),
  ];
  for (let i = 0; i < 40; i++) {
    messages.push(msg('user', 'user', `OLD_REQUEST_${i}`));
    messages.push(msg('assistant', 'model', `OLD_ANSWER_${i} ` + 'a'.repeat(1500)));
    messages.push(
      msg('tool', 'tool', `OLD_TOOL_OUTPUT_${i} ` + 'o'.repeat(20000), {
        toolCallId: `call_${i}`,
        isError: false,
      }),
    );
  }
  messages.push(msg('user', 'user', 'LATEST_HUMAN_REQUEST el de slack, no del correo'));
  messages.push(msg('user', 'mem0-recall', 'Retrieved facts from shared Mem0'));
  messages.push(msg('assistant', 'model', 'CURRENT_TURN_ANSWER'));
  messages.push(
    msg('tool', 'tool', 'CURRENT_TURN_TOOL_OUTPUT ' + 'c'.repeat(6000), {
      toolCallId: 'call_now',
      isError: false,
    }),
  );
  return messages;
}

const tools = Array.from({ length: 30 }, (_, i) => ({
  name: `tool_${i}`,
  description: 'TOOL_DESCRIPTION ' + 'd'.repeat(800),
  parameters: { type: 'object', properties: {} },
}));

function build(messages: unknown[], budget?: number) {
  return buildPrompt(
    { messages, tools } as never,
    resolveConfig(budget ? { promptBudgetBytes: budget } : {}),
  );
}

describe('prompt fits the Antigravity input limit', () => {
  it('stays within the configured byte budget for a long session', () => {
    expect(bytes(build(longSession()))).toBeLessThanOrEqual(180000);
    expect(bytes(build(longSession(), 60000))).toBeLessThanOrEqual(60000);
  });

  it('keeps the session preamble, the latest request and the current turn', () => {
    const prompt = build(longSession(), 60000);
    expect(prompt).toContain('AGENTS_MD_RULES');
    expect(prompt).toContain('SKILL_CATALOG');
    expect(prompt).toContain('LATEST_HUMAN_REQUEST');
    expect(prompt).toContain('CURRENT_TURN_ANSWER');
    expect(prompt).toContain('CURRENT_TURN_TOOL_OUTPUT');
    const tail = prompt.slice(prompt.lastIndexOf('}') + 1);
    expect(tail).toContain('LATEST_HUMAN_REQUEST');
  });

  it('prefers recent history and marks what was omitted', () => {
    const prompt = build(longSession(), 120000);
    expect(prompt).toContain('OLD_REQUEST_39');
    expect(prompt).not.toContain('OLD_REQUEST_0"');
    expect(prompt).toMatch(/earlier messages omitted/);
  });

  it('shortens old tool outputs before dropping messages', () => {
    const prompt = build(longSession(), 180000);
    expect(prompt).toContain('OLD_TOOL_OUTPUT_39');
    expect(prompt).not.toContain('o'.repeat(5000));
    expect(prompt).toMatch(/truncated \d+ bytes/);
  });

  it('does not duplicate the MCP tool catalog inside the prompt', () => {
    expect(build(longSession())).not.toContain('TOOL_DESCRIPTION');
  });

  it('leaves a short conversation untouched', () => {
    const prompt = build([
      msg('user', 'user', 'hola'),
      msg('assistant', 'model', 'hola, ¿en qué te ayudo?'),
      msg('user', 'user', 'qué modelo eres?'),
    ]);
    expect(prompt).not.toMatch(/messages omitted to fit|truncated \d+ bytes/);
    expect(prompt).toContain('hola, ¿en qué te ayudo?');
  });
});

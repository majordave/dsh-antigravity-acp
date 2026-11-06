import { describe, expect, it } from 'vitest';
import { buildPrompt } from '../src/prompt.js';
import { resolveConfig } from '../src/config.js';

// DSH appends user-role context after the human's message (Mem0 recall, time
// context, reminders). Asking the agent to answer "the final user message" made
// it answer the time stamp and fall back to an older request in the transcript.
const user = (text: string, kind: string) => ({
  role: 'user' as const,
  content: [{ type: 'text' as const, text }],
  source: { kind },
});
const assistant = (text: string) => ({
  role: 'assistant' as const,
  content: [{ type: 'text' as const, text }],
  source: { kind: 'model' },
});

function promptFor(messages: unknown[]) {
  return buildPrompt({ messages } as never, resolveConfig({ toolPolicy: 'text-only' }));
}

describe('prompt points the agent at the latest human message', () => {
  const history = [
    user('roberto adjuntó un link al final', 'user'),
    assistant('Revisé el enlace de mail-tester…'),
    user('envia en el hilo la pregunta a jovanna', 'user'),
    user('Retrieved facts from shared Mem0 follow…', 'mem0-recall'),
    user('Time sampled while preparing turn 3, step 1', 'time-context'),
  ];

  it('restates the latest human message after the transcript', () => {
    const prompt = promptFor(history);
    const tail = prompt.slice(prompt.lastIndexOf('}') + 1);
    expect(tail).toContain('envia en el hilo la pregunta a jovanna');
    expect(tail).not.toContain('roberto adjuntó un link al final');
    expect(tail).not.toContain('Time sampled');
  });

  it('keeps each message source in the transcript so context is distinguishable', () => {
    const json = promptFor(history).match(/\{"system".*\}/s)![0];
    const parsed = JSON.parse(json) as { messages: { source?: string }[] };
    expect(parsed.messages.map((m) => m.source)).toEqual([
      'user',
      'model',
      'user',
      'mem0-recall',
      'time-context',
    ]);
  });

  it('treats a source-less request input after the history as the latest request', () => {
    const prompt = promptFor([
      user('OLD_USER', 'user'),
      assistant('OLD_ASSISTANT'),
      { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
    ]);
    const tail = prompt.slice(prompt.lastIndexOf('}') + 1);
    expect(tail).toContain('Hello');
    expect(prompt.match(/OLD_USER/g)).toHaveLength(1);
  });

  it('falls back to the last user-role message when no human source exists', () => {
    const prompt = promptFor([
      { role: 'user', content: [{ type: 'text', text: 'Create a concise title' }] },
    ]);
    const tail = prompt.slice(prompt.lastIndexOf('}') + 1);
    expect(tail).toContain('Create a concise title');
  });
});

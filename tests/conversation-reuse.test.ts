import { afterEach, describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local';
import {
  createAssistantMessage,
  createMessage,
  createToolResultMessage,
  type StreamChunk,
  type ToolCallBlock,
} from '@deepseek-ai/dsh-llm';
import { fileURLToPath } from 'node:url';
import { AntigravityAcpAdapter } from '../src/adapter.js';
import { resolveConfig } from '../src/config.js';
import { buildContinuationPrompt } from '../src/prompt.js';
import type { AcpGenerateOptions as GenerateOptions } from '../src/request.js';

const live: AntigravityAcpAdapter[] = [];
const contexts: Context[] = [];
const SessionId = (id: string) => id as GenerateOptions['sessionId'];
afterEach(async () => {
  await Promise.all(live.splice(0).map((a) => a.dispose()));
  await Promise.all(contexts.splice(0).map((c) => c.fiber.dispose()));
});

const readTool = {
  name: 'read_file',
  description: 'Read',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
    additionalProperties: false,
  },
};

function fixture(extra = {}) {
  const ctx = new Context();
  contexts.push(ctx);
  const adapter = new AntigravityAcpAdapter(
    resolveConfig({
      command: process.execPath,
      args: [fileURLToPath(new URL('./fake-acp-server.mjs', import.meta.url)), 'bridge-chat'],
      requestTimeoutMs: 3000,
      timeoutMs: 3000,
      disposeGraceMs: 100,
      maxIdleConversations: 2,
      ...extra,
    }),
    new LocalSubprocessRuntime(ctx),
  );
  live.push(adapter);
  return adapter;
}

const human = (text: string) =>
  createMessage({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] });
const context = (kind: string, text: string) =>
  createMessage({
    role: 'user',
    source: { kind } as never,
    content: [{ type: 'text', text }],
  });

function start(text: string, sessionId = 'dsh-session'): GenerateOptions {
  return {
    provider: 'antigravity-acp',
    model: 'fake-model',
    sessionId: SessionId(sessionId),
    messages: [human(text)],
    tools: [readTool],
  };
}

async function collect(a: AntigravityAcpAdapter, o: GenerateOptions) {
  const chunks: StreamChunk[] = [];
  for await (const c of a.stream(o)) chunks.push(c);
  return chunks;
}
const text = (chunks: StreamChunk[]) =>
  chunks
    .filter((c) => c.type === 'text-delta')
    .map((c) => c.text)
    .join('');
const sid = (chunks: StreamChunk[]) => /SID=(\S+)/.exec(text(chunks))?.[1];
const calls = (chunks: StreamChunk[]): ToolCallBlock[] =>
  chunks.flatMap((c) => (c.type === 'block-end' && c.block.type === 'tool-call' ? [c.block] : []));

/** DSH appends the streamed reply as an assistant message, then new messages. */
function next(
  o: GenerateOptions,
  chunks: StreamChunk[],
  ...added: GenerateOptions['messages']
): GenerateOptions {
  const blocks = chunks.flatMap((c) => (c.type === 'block-end' ? [c.block] : []));
  return {
    ...o,
    messages: [
      ...o.messages,
      createAssistantMessage({ source: { provider: o.provider, model: o.model }, content: blocks }),
      ...added,
    ],
  };
}
function withToolResults(
  o: GenerateOptions,
  chunks: StreamChunk[],
  ...added: GenerateOptions['messages']
): GenerateOptions {
  const results = calls(chunks).map((call) =>
    createToolResultMessage({
      callId: call.id,
      isError: false,
      content: [{ type: 'text', text: 'CONTENT_' + JSON.parse(call.arguments).path }],
    }),
  );
  return next(o, chunks, ...results, ...added);
}

describe('conversation reuse across DSH turns', () => {
  it('continues the resting ACP session with only the new messages', async () => {
    const adapter = fixture();
    const first = start('FIRST_QUESTION');
    const one = await collect(adapter, first);
    expect(one.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } });
    const second = next(first, one, human('SECOND_QUESTION'), context('mem0-recall', 'RECALLED'));
    const two = await collect(adapter, second);
    expect(two.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } });
    expect(sid(two)).toBe(sid(one));
    const prompt = text(two);
    expect(prompt).toContain('SECOND_QUESTION');
    expect(prompt).toContain('RECALLED');
    expect(prompt).toContain('Latest human request:\n<<<\nSECOND_QUESTION\n>>>');
    expect(prompt).not.toContain('FIRST_QUESTION');
  });

  it('continues the session after a tool loop ends', async () => {
    const adapter = fixture();
    const first = start('CALL_TOOL please');
    const tool = await collect(adapter, first);
    expect(tool.at(-1)).toEqual({ type: 'finish', reason: { kind: 'tool-calls' } });
    const resumed = withToolResults(first, tool);
    const done = await collect(adapter, resumed);
    expect(done.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } });
    const later = await collect(adapter, next(resumed, done, human('FOLLOW_UP')));
    expect(sid(later)).toBe(sid(done));
    expect(text(later)).toContain('FOLLOW_UP');
    expect(text(later)).not.toContain('CALL_TOOL please');
  });

  it('rebuilds from the full history when an earlier DSH message changed', async () => {
    const adapter = fixture();
    const first = start('FIRST_QUESTION');
    const one = await collect(adapter, first);
    const edited = next({ ...first, messages: [human('EDITED_FIRST')] }, one, human('SECOND'));
    const two = await collect(adapter, edited);
    expect(sid(two)).not.toBe(sid(one));
    expect(text(two)).toContain('EDITED_FIRST');
  });

  it('rebuilds when the model or the tool catalog changes', async () => {
    const adapter = fixture();
    const first = start('FIRST_QUESTION');
    const one = await collect(adapter, first);
    const changed = next(
      { ...first, tools: [{ ...readTool, name: 'updated_read' }] },
      one,
      human('SECOND'),
    );
    const two = await collect(adapter, changed);
    expect(sid(two)).not.toBe(sid(one));
    expect(text(two)).toContain('FIRST_QUESTION');
  });

  it('rebuilds when the recorded reply is not the one that was streamed', async () => {
    const adapter = fixture();
    const first = start('FIRST_QUESTION');
    const one = await collect(adapter, first);
    const forged: StreamChunk[] = [
      { type: 'block-end', index: 0, block: { type: 'text', text: 'SOMETHING ELSE' } },
    ];
    const two = await collect(adapter, next(first, forged, human('SECOND')));
    expect(sid(two)).not.toBe(sid(one));
  });

  it('rebuilds when the new messages are not only user messages', async () => {
    const adapter = fixture();
    const first = start('FIRST_QUESTION');
    const one = await collect(adapter, first);
    const extra = createAssistantMessage({
      source: { provider: 'antigravity-acp', model: 'fake-model' },
      content: [{ type: 'text', text: 'INJECTED ASSISTANT' }],
    });
    const two = await collect(adapter, next(first, one, extra, human('SECOND')));
    expect(sid(two)).not.toBe(sid(one));
  });

  it('expires a resting conversation after the idle timeout', async () => {
    const adapter = fixture({ conversationIdleMs: 50 });
    const first = start('FIRST_QUESTION');
    const one = await collect(adapter, first);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const two = await collect(adapter, next(first, one, human('SECOND')));
    expect(sid(two)).not.toBe(sid(one));
    expect(text(two)).toContain('FIRST_QUESTION');
  });

  it('keeps at most the configured number of resting conversations, closing the oldest', async () => {
    const adapter = fixture({ maxIdleConversations: 1 });
    const a = start('QUESTION_A', 'session-a');
    const b = start('QUESTION_B', 'session-b');
    const aOne = await collect(adapter, a);
    const bOne = await collect(adapter, b);
    const bTwo = await collect(adapter, next(b, bOne, human('B_AGAIN')));
    expect(sid(bTwo)).toBe(sid(bOne));
    const aTwo = await collect(adapter, next(a, aOne, human('A_AGAIN')));
    expect(sid(aTwo)).not.toBe(sid(aOne));
  });

  it('opens a fresh session every turn when reuse is disabled', async () => {
    const adapter = fixture({ maxIdleConversations: 0 });
    const first = start('FIRST_QUESTION');
    const one = await collect(adapter, first);
    const two = await collect(adapter, next(first, one, human('SECOND')));
    expect(sid(two)).not.toBe(sid(one));
  });

  it('does not route a request without tools to a resting conversation', async () => {
    const adapter = fixture();
    const first = start('FIRST_QUESTION');
    const one = await collect(adapter, first);
    const textOnly = await collect(adapter, { ...first, tools: [] });
    expect(textOnly.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } });
    expect(text(textOnly)).not.toContain('SID=');
    const two = await collect(adapter, next(first, one, human('SECOND')));
    expect(sid(two)).toBe(sid(one));
  });

  it('delivers a context message added after a tool result without rebuilding the loop', async () => {
    const adapter = fixture();
    const first = start('CALL_TOOL please');
    const tool = await collect(adapter, first);
    expect(tool.at(-1)).toEqual({ type: 'finish', reason: { kind: 'tool-calls' } });
    const resumed = withToolResults(first, tool, context('skill-catalog', 'CATALOG_UPDATE'));
    const done = await collect(adapter, resumed);
    expect(done.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } });
    const reply = text(done);
    expect(reply).toContain('PROMPTS=1 '); // Same ACP prompt resumed, not a rebuild.
    expect(reply).toContain('CONTENT_x');
    expect(reply).toContain('CATALOG_UPDATE');
  });
});

describe('continuation prompt', () => {
  const config = resolveConfig({});

  it('carries the new messages and restates the latest human request', () => {
    const prompt = buildContinuationPrompt(
      start('ignored'),
      [human('NEW_REQUEST'), context('time-context', 'NOW')],
      config,
    );
    expect(prompt).toBeDefined();
    expect(prompt).toContain('"source":"user"');
    expect(prompt).toContain('NOW');
    expect(prompt).toContain('Latest human request:\n<<<\nNEW_REQUEST\n>>>');
    expect(prompt).not.toContain('ignored');
  });

  it('asks for a response to context-only updates without restating an old request', () => {
    const prompt = buildContinuationPrompt(
      start('ignored'),
      [context('agent-inbox', 'SUBAGENT_DONE')],
      config,
    );
    expect(prompt).toContain('SUBAGENT_DONE');
    expect(prompt).not.toContain('Latest human request');
  });

  it('returns nothing when the new messages do not fit the input budget', () => {
    const small = resolveConfig({ promptBudgetBytes: 2000 });
    expect(
      buildContinuationPrompt(start('ignored'), [human('x'.repeat(3000))], small),
    ).toBeUndefined();
  });

  it('enables reuse by default with a small cap and a 15-minute idle timeout', () => {
    expect(config.maxIdleConversations).toBe(2);
    expect(config.conversationIdleMs).toBe(900000);
  });
});

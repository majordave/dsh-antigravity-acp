import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { EventMapper } from '../src/acp/events.js';
import { readLastCallUsage } from '../src/acp/usage-store.js';
// @ts-expect-error -- plain .mjs fixture shared with the fake ACP server.
import { genMetadataRecord, writeConversation } from './gen-metadata-fixture.mjs';

const dirs: string[] = [];
const store = () => {
  const dir = mkdtempSync(join(tmpdir(), 'acp-usage-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe('per-call usage from the official server conversation store', () => {
  it('reads uncached input, cache hits, output and reasoning of the latest model call', () => {
    const dir = store();
    writeConversation(dir, 'd83d0795-b605-401f-9bfe-6b61f3aa57e8', [
      genMetadataRecord({ input: 64988, output: 1530, reasoning: 1446 }),
      genMetadataRecord({ input: 3732, output: 302, cacheRead: 62934, reasoning: 161 }),
    ]);
    expect(readLastCallUsage(dir, 'd83d0795-b605-401f-9bfe-6b61f3aa57e8')).toEqual({
      inputTokens: 3732,
      outputTokens: 302,
      cacheReadTokens: 62934,
      reasoningTokens: 161,
    });
  });

  it('reports zero cache hits for a cold call instead of omitting them', () => {
    const dir = store();
    writeConversation(dir, 'cold', [genMetadataRecord({ input: 22541, output: 7 })]);
    expect(readLastCallUsage(dir, 'cold')).toEqual({
      inputTokens: 22541,
      outputTokens: 7,
      cacheReadTokens: 0,
    });
  });

  it('returns nothing when the conversation store is missing, empty or unreadable', () => {
    const dir = store();
    expect(readLastCallUsage(dir, 'missing')).toBeUndefined();
    writeConversation(dir, 'empty', []);
    expect(readLastCallUsage(dir, 'empty')).toBeUndefined();
    writeFileSync(join(dir, 'garbage.db'), 'not a database');
    expect(readLastCallUsage(dir, 'garbage')).toBeUndefined();
  });

  it('returns nothing for a record without usage instead of inventing zeros', () => {
    const dir = store();
    writeConversation(dir, 'no-usage', [Buffer.from([0x18, 0x05])]);
    expect(readLastCallUsage(dir, 'no-usage')).toBeUndefined();
  });

  it('never resolves a session id outside the conversation store', () => {
    const dir = store();
    writeConversation(dir, 'outside', [genMetadataRecord({ input: 1, output: 1 })]);
    // The store would resolve inside `dir` if traversal were followed.
    expect(readLastCallUsage(join(dir, 'conversations'), '../outside')).toBeUndefined();
    expect(readLastCallUsage(dir, '/etc/passwd')).toBeUndefined();
  });
});

describe('usage chunk emitted before finish', () => {
  const occupancy = {
    sessionUpdate: 'usage_update',
    used: 22548,
    size: 1048576,
  } as unknown as SessionUpdate;

  it('prefers the per-call usage, which carries the cache hits, over occupancy', () => {
    const mapper = new EventMapper();
    mapper.update(occupancy);
    const call = { inputTokens: 3732, outputTokens: 302, cacheReadTokens: 62934 };
    expect(mapper.usage(call)).toEqual([{ type: 'usage', usage: call }]);
  });

  it('falls back to occupancy when the per-call usage is unavailable', () => {
    const mapper = new EventMapper();
    mapper.update(occupancy);
    expect(mapper.usage(undefined)).toEqual([
      { type: 'usage', usage: { inputTokens: 22548, outputTokens: 0 } },
    ]);
  });
});

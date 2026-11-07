import { describe, expect, it } from 'vitest';
import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { EventMapper } from '../src/acp/events.js';

const occupancy = (used: unknown, size = 1048576) =>
  ({ sessionUpdate: 'usage_update', used, size }) as unknown as SessionUpdate;

describe('context occupancy from ACP usage_update', () => {
  it('reports nothing when the server never sent a usage_update', () => {
    const mapper = new EventMapper();
    mapper.update({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'hi' },
    } as SessionUpdate);
    expect(mapper.usage()).toEqual([]);
  });

  it('reports the latest occupancy as prompt-side tokens without inventing output', () => {
    const mapper = new EventMapper();
    expect(mapper.update(occupancy(1200))).toEqual([]);
    mapper.update(occupancy(1850));
    expect(mapper.usage()).toEqual([
      { type: 'usage', usage: { inputTokens: 1850, outputTokens: 0 } },
    ]);
  });

  it('ignores malformed occupancy values instead of reporting them', () => {
    const mapper = new EventMapper();
    mapper.update(occupancy(-3));
    mapper.update(occupancy(12.5));
    mapper.update(occupancy('900'));
    expect(mapper.usage()).toEqual([]);
  });
});

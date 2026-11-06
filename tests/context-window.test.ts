import { describe, expect, it } from 'vitest';
import { contextWindowFor } from '../src/models.js';
import { resolveConfig } from '../src/config.js';

// DSH compaction refuses a model switch when the adapter model has no
// context capacity ("no context capacity ... configure contextWindow").
describe('context window metadata for announced models', () => {
  const config = resolveConfig();

  it('declares a 1M-token window for Gemini models', () => {
    expect(contextWindowFor('gemini-3.8-flash-high', config)).toBe(1048576);
    expect(contextWindowFor('gemini-pro-agent', config)).toBe(1048576);
  });

  it('declares a 200K-token window for Claude models', () => {
    expect(contextWindowFor('claude-sonnet-4-5-thinking', config)).toBe(200000);
  });

  it('declares a 128K-token window for GPT-OSS models', () => {
    expect(contextWindowFor('gpt-oss-120b-medium', config)).toBe(131072);
  });

  it('falls back to a conservative window for unknown models and server-default', () => {
    expect(contextWindowFor('server-default', config)).toBe(200000);
    expect(contextWindowFor('some-future-model', config)).toBe(200000);
  });

  it('lets configuration override the default and individual models', () => {
    const custom = resolveConfig({
      contextWindow: 500000,
      contextWindows: { 'gemini-3.8-flash-high': 900000 },
    });
    expect(contextWindowFor('gemini-3.8-flash-high', custom)).toBe(900000);
    expect(contextWindowFor('some-future-model', custom)).toBe(500000);
    expect(contextWindowFor('claude-sonnet-4-5', custom)).toBe(200000);
  });
});

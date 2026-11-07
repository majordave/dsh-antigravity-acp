import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { TokenUsage } from '@deepseek-ai/dsh-llm';

/**
 * Where the official server keeps one SQLite store per ACP session
 * (`<sessionId>.db`), relative to the home of the user running it.
 */
export function defaultConversationsDir(): string {
  return join(homedir(), '.gemini', 'antigravity-acp', 'conversations');
}

/** Per-call usage of a session, from the configured store or the default one. */
export function lastCallUsage(
  configuredDir: string,
  sessionId: string | undefined,
): TokenUsage | undefined {
  if (!sessionId) return undefined;
  return readLastCallUsage(configuredDir || defaultConversationsDir(), sessionId);
}

// Real ids are UUIDs; anything with separators or dots is never a store name.
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/**
 * Usage of the latest model call of an ACP session, read from the official
 * server's conversation store.
 *
 * ACP only streams `usage_update` (context occupancy) and agy-acp-server 1.3.0
 * sends no `PromptResponse.usage`, so cache hits never reach the wire. The
 * server does persist each model call in `gen_metadata`: a protobuf record
 * whose field 1.4 holds 2 uncached input, 3 output, 5 cache read and
 * 9 reasoning tokens. Input and cache read are disjoint, as DSH expects.
 *
 * Returns undefined on any doubt (missing store, no record, unknown shape) so
 * the caller can fall back to occupancy instead of reporting invented numbers.
 */
export function readLastCallUsage(dir: string, sessionId: string): TokenUsage | undefined {
  if (!SESSION_ID.test(sessionId)) return undefined;
  const file = join(dir, `${sessionId}.db`);
  if (!existsSync(file)) return undefined;
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const row = db.prepare('SELECT data FROM gen_metadata ORDER BY idx DESC LIMIT 1').get() as
      | { data?: unknown }
      | undefined;
    if (!(row?.data instanceof Uint8Array)) return undefined;
    const call = field(row.data, 1);
    const usage = call && field(call, 4);
    if (!usage) return undefined;
    const counts = varints(usage);
    const input = counts.get(2);
    const output = counts.get(3);
    if (input === undefined || output === undefined) return undefined;
    const result: TokenUsage = {
      inputTokens: input,
      outputTokens: output,
      cacheReadTokens: counts.get(5) ?? 0,
    };
    const reasoning = counts.get(9);
    if (reasoning !== undefined) result.reasoningTokens = reasoning;
    return result;
  } catch {
    return undefined;
  } finally {
    try {
      db?.close();
    } catch {
      // Already closed or never opened.
    }
  }
}

interface Field {
  number: number;
  wire: number;
  value?: number;
  bytes?: Uint8Array;
}

function readVarint(buf: Uint8Array, start: number): [number, number] {
  let value = 0;
  let scale = 1;
  let pos = start;
  for (;;) {
    if (pos >= buf.length || scale > 2 ** 56) throw new Error('truncated varint');
    const byte = buf[pos++]!;
    value += (byte & 0x7f) * scale;
    if (!(byte & 0x80)) return [value, pos];
    scale *= 128;
  }
}

function* fields(buf: Uint8Array): Generator<Field> {
  let pos = 0;
  while (pos < buf.length) {
    const [key, afterKey] = readVarint(buf, pos);
    const number = Math.floor(key / 8);
    const wire = key % 8;
    pos = afterKey;
    if (wire === 0) {
      const [value, next] = readVarint(buf, pos);
      pos = next;
      yield { number, wire, value };
    } else if (wire === 2) {
      const [length, next] = readVarint(buf, pos);
      if (next + length > buf.length) throw new Error('truncated field');
      yield { number, wire, bytes: buf.subarray(next, next + length) };
      pos = next + length;
    } else if (wire === 1) {
      pos += 8;
    } else if (wire === 5) {
      pos += 4;
    } else {
      throw new Error('unsupported wire type');
    }
    if (pos > buf.length) throw new Error('truncated field');
  }
}

function field(buf: Uint8Array, number: number): Uint8Array | undefined {
  for (const f of fields(buf)) if (f.number === number && f.bytes) return f.bytes;
  return undefined;
}

function varints(buf: Uint8Array): Map<number, number> {
  const out = new Map<number, number>();
  for (const f of fields(buf))
    if (f.value !== undefined && Number.isSafeInteger(f.value)) out.set(f.number, f.value);
  return out;
}

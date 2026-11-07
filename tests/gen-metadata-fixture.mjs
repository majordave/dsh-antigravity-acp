// Writes conversation stores shaped like the official server's
// <conversations>/<sessionId>.db: a `gen_metadata` table whose blobs are
// protobuf records with the per-call usage at field 1.4.
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

function varint(value) {
  const bytes = [];
  let rest = value;
  while (rest > 0x7f) {
    bytes.push((rest & 0x7f) | 0x80);
    rest = Math.floor(rest / 128);
  }
  bytes.push(rest);
  return Buffer.from(bytes);
}

const tag = (field, wire) => varint(field * 8 + wire);
const uint = (field, value) => Buffer.concat([tag(field, 0), varint(value)]);
const bytes = (field, payload) => Buffer.concat([tag(field, 2), varint(payload.length), payload]);
const fixed64 = (field) => Buffer.concat([tag(field, 1), Buffer.alloc(8, 7)]);

/**
 * One gen_metadata record. Usage fields observed in agy-acp-server 1.3.0:
 * 2 uncached input, 3 output, 5 cache read, 9 reasoning, 10 visible output.
 */
export function genMetadataRecord({ input, output, cacheRead, reasoning }) {
  const usage = [uint(2, input), uint(3, output)];
  if (cacheRead !== undefined) usage.push(uint(5, cacheRead));
  if (reasoning !== undefined) usage.push(uint(9, reasoning), uint(10, output - reasoning));
  // Unrelated fields around the usage, as in real records, must be skipped.
  const call = Buffer.concat([
    bytes(2, Buffer.concat([uint(2, 1), uint(4, 432)])),
    bytes(4, Buffer.concat(usage)),
    bytes(17, bytes(2, Buffer.concat(usage))),
  ]);
  return Buffer.concat([fixed64(2), bytes(1, call), uint(3, 326)]);
}

export function writeConversation(dir, sessionId, records) {
  const db = new DatabaseSync(join(dir, `${sessionId}.db`));
  db.exec(
    'CREATE TABLE IF NOT EXISTS gen_metadata (idx integer, data blob, size integer NOT NULL DEFAULT 0, PRIMARY KEY (idx))',
  );
  const next = db.prepare('SELECT COALESCE(MAX(idx) + 1, 0) AS idx FROM gen_metadata').get().idx;
  const insert = db.prepare('INSERT INTO gen_metadata (idx, data, size) VALUES (?, ?, ?)');
  records.forEach((record, offset) => insert.run(next + offset, record, record.length));
  db.close();
}

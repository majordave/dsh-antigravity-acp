import type { TokenUsage } from '@deepseek-ai/dsh-llm';
/**
 * Where the official server keeps one SQLite store per ACP session
 * (`<sessionId>.db`), relative to the home of the user running it.
 */
export declare function defaultConversationsDir(): string;
/** Per-call usage of a session, from the configured store or the default one. */
export declare function lastCallUsage(configuredDir: string, sessionId: string | undefined): TokenUsage | undefined;
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
export declare function readLastCallUsage(dir: string, sessionId: string): TokenUsage | undefined;

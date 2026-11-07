import type { SessionUpdate } from '@agentclientprotocol/sdk';
import type { StreamChunk, FinishReason, TokenUsage } from '@deepseek-ai/dsh-llm';
export declare class EventMapper {
    private blocks;
    /** Latest ACP usage_update `used`: tokens currently occupying the context window. */
    private occupiedTokens;
    get blockCount(): number;
    /** Assistant text streamed so far (reasoning excluded). */
    get text(): string;
    get hasText(): boolean;
    update(update: SessionUpdate): StreamChunk[];
    /**
     * The usage chunk emitted just before `finish`.
     *
     * `call` is the per-call usage from the official conversation store (input,
     * cache hits, output); it is preferred because it is the only source of the
     * cache hit rate. Without it, context occupancy is reported instead.
     *
     * ACP's usage_update is occupancy, not billing. DSH's token meter reads the
     * prompt side of usage (input + cache) as context pressure, so occupancy is
     * reported there and output stays 0 instead of being invented. Without it the
     * DSH context meters and compaction pressure have no reading at all. The
     * occupancy may already include the reply, so the next-request projection can
     * run slightly high; that errs toward compacting early, never late.
     */
    usage(call?: TokenUsage): StreamChunk[];
    end(): StreamChunk[];
}
export declare function finishReason(reason: string): FinishReason;

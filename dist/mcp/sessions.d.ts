import { type StreamChunk } from '@deepseek-ai/dsh-llm';
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess';
import { AcpClient } from '../acp/client.js';
import type { Config } from '../config.js';
import type { AcpGenerateOptions as GenerateOptions } from '../request.js';
/** Active turns own separate ACP processes, avoiding subagent deadlocks.
 * A completed turn's ACP session can rest so the next turn of the same DSH
 * session continues it with only the new messages (see docs/conversation-reuse.md);
 * otherwise its process returns to the ready pool and the next turn rebuilds.
 */
export declare class ToolSessions {
    private config;
    private runtime;
    private notify;
    private bindings;
    private closing;
    private idleClients;
    private borrowedClients;
    private counts;
    private disposed;
    private restOrder;
    processStarts: number;
    authentications: number;
    generations: number;
    constructor(config: Config, runtime: SubprocessRuntime, notify: (message: string) => void);
    get active(): number;
    get idle(): number;
    get connected(): boolean;
    private account;
    private track;
    borrowReadyClient(): AcpClient | undefined;
    private takeClient;
    private keepClient;
    acceptReadyClient(client: AcpClient): Promise<void>;
    discardReadyClient(client: AcpClient): Promise<void>;
    private find;
    /** True only for a turn parked on DSH tool calls; a resting conversation never reroutes. */
    has(o: GenerateOptions): boolean;
    private deadline;
    private fail;
    private watch;
    private queueTool;
    private oldestResting;
    private create;
    private matches;
    /**
     * The DSH messages added since a resting conversation's last reply, when the
     * new request extends exactly what that ACP session already holds.
     */
    private continuation;
    /** Reopen a resting conversation for the next DSH turn. */
    private wake;
    /** Keep a completed turn's ACP session for the next turn of the same DSH session. */
    private rest;
    private canRest;
    private resume;
    stream(o: GenerateOptions): AsyncIterable<StreamChunk>;
    private close;
    dispose(): Promise<void>;
}

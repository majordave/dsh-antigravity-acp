import type { AcpGenerateOptions as GenerateOptions } from './request.js';
import type { Config } from './config.js';
export declare function buildPrompt(options: GenerateOptions, config: Config): string;
/**
 * Prompt for a resting ACP session that already holds the earlier history:
 * only the DSH messages added since the agent's last reply. Returns undefined
 * when they do not fit the input budget, so the caller rebuilds instead.
 */
export declare function buildContinuationPrompt(options: GenerateOptions, added: GenerateOptions['messages'], config: Config): string | undefined;
type PromptMessage = GenerateOptions['messages'][number];
export declare const isHuman: (m: PromptMessage) => boolean;
export declare function sourceKind(message: PromptMessage): string | undefined;
export declare function messageText(message: PromptMessage): string;
export {};

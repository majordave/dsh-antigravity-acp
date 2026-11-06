import type { NewSessionResponse, SessionConfigOption, SessionConfigSelectOption } from '@agentclientprotocol/sdk';
import type { Config } from './config.js';
export declare function selectValues(option: SessionConfigOption): SessionConfigSelectOption[];
export declare function modelOption(session: NewSessionResponse): SessionConfigOption | undefined;
export declare function contextWindowFor(model: string, config: Pick<Config, 'contextWindow' | 'contextWindows'>): number;
export declare function modelCatalog(session: NewSessionResponse): {
    id: string;
    name: string;
}[];

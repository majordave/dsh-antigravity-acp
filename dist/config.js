import z from '@deepseek-ai/schemastery';
export const Config = z.object({
    provider: z.string().default('antigravity-acp'),
    command: z.string().default(''),
    autoInstall: z.boolean().default(true),
    installTimeoutMs: z.natural().default(180000),
    args: z.array(z.string()).default([]),
    auth: z.const('oauth-personal').default('oauth-personal'),
    defaultModel: z.string().default(''),
    models: z.array(z.string()).default([]),
    // Fallback window for models outside the known Gemini/Claude/GPT-OSS families.
    contextWindow: z.natural().default(200000),
    // Exact per-model overrides, e.g. { "gemini-3.8-flash-high": 1048576 }.
    contextWindows: z.dict(z.natural()).default({}),
    // The official server keeps only the first 192,000 bytes of a prompt.
    promptBudgetBytes: z.natural().default(180000),
    // Official server's per-session SQLite stores, read for per-call cache hits.
    // Empty means ~/.gemini/antigravity-acp/conversations of the current user.
    conversationsDir: z.string().default(''),
    toolPolicy: z.union(['bridge', 'text-only', 'reject']).default('bridge'),
    toolTimeoutMs: z.natural().default(900000),
    maxActiveToolSessions: z.natural().default(16),
    idleProcessTimeoutMs: z.natural().default(300000),
    timeoutMs: z.natural().default(600000),
    requestTimeoutMs: z.natural().default(30000),
    authTimeoutMs: z.natural().default(600000),
    cancelGraceMs: z.natural().default(1500),
    disposeGraceMs: z.natural().default(3000),
    maxSessionsPerProcess: z.natural().default(100),
});
export function resolveConfig(input = {}) {
    const config = Config(input);
    if (!config.provider.trim())
        throw new Error('provider must not be empty');
    for (const key of [
        'installTimeoutMs',
        'timeoutMs',
        'requestTimeoutMs',
        'authTimeoutMs',
        'cancelGraceMs',
        'disposeGraceMs',
        'maxSessionsPerProcess',
        'toolTimeoutMs',
        'maxActiveToolSessions',
        'idleProcessTimeoutMs',
        'contextWindow',
        'promptBudgetBytes',
    ]) {
        if (!Number.isSafeInteger(config[key]) || config[key] <= 0 || config[key] > 2147483647)
            throw new Error(`${key} must be a positive integer <= 2147483647`);
    }
    return config;
}

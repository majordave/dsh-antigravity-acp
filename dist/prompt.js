import { acpError } from './acp/errors.js';
export function buildPrompt(options, config) {
    // Host reasoning metadata accepts the request field; ACP's exact model ID
    // selects the thinking tier, so reasoningEffort is intentionally not forwarded.
    for (const key of ['temperature', 'maxTokens']) {
        if (options[key] !== undefined)
            throw acpError(`ACP does not expose ${key}. Remove that request option; select an exact model ID for its reasoning tier.`, 'UNSUPPORTED_OPTION');
    }
    if (options.stop?.length)
        throw acpError('ACP does not expose stop sequences.', 'UNSUPPORTED_OPTION');
    if (config.toolPolicy === 'reject' &&
        (options.tools?.length || options.toolHistory?.tools.length))
        throw acpError('toolPolicy: reject refuses tool schemas. Use the default bridge policy to execute DSH tools.', 'UNSUPPORTED_OPTION');
    const messages = renderMessages(options.messages);
    const header = [
        'DeepSeek Harness owns this conversation. Produce only the next assistant response using the supplied conversation.',
        ...(config.toolPolicy === 'bridge' && options.tools?.length
            ? [
                'Use only tools supplied by the dsh-bridge MCP server. These are the real DeepSeek Harness tools, including file and terminal tools. Call them using their MCP names and schemas.',
                'Never use built-in Antigravity tools, slash commands, skills, file access, terminals, or network tools outside dsh-bridge. Do not use a native tool to find MCP tools; the MCP catalog is already supplied.',
                'Each MCP call is executed by DSH with its current permissions. A denied or failed tool result is authoritative; do not bypass it or repeat the action through another tool.',
            ]
            : [
                'This is a text-only backend. Do not invoke native tools, slash commands, skills, file access, terminals, network tools, or MCP.',
                'DSH tools are unavailable on this request. If an action needs tools, explain that limitation in your answer.',
            ]),
        'The JSON below is the DSH-controlled history, with roles, message sources and historical tool results. Long sessions are condensed to fit the input limit: old tool outputs may be shortened and the oldest middle messages omitted. Do not repeat the transcript.',
    ];
    const footer = latestHumanRequest(options.messages);
    const render = (history) => [
        ...header,
        // The MCP tool catalog is not repeated here: the server already receives
        // every dsh-bridge tool with its schema over MCP.
        JSON.stringify({ system: options.system ?? null, messages: history }),
        ...footer,
    ].join('\n\n');
    return fitToBudget(messages, options.messages, render, config.promptBudgetBytes);
}
/**
 * Prompt for a resting ACP session that already holds the earlier history:
 * only the DSH messages added since the agent's last reply. Returns undefined
 * when they do not fit the input budget, so the caller rebuilds instead.
 */
export function buildContinuationPrompt(options, added, config) {
    const tools = config.toolPolicy === 'bridge' && !!options.tools?.length;
    const footer = latestHumanRequest(added);
    const prompt = [
        'DeepSeek Harness continues this conversation. The JSON below holds only the DSH messages added since your last reply, with roles and message sources; everything before them is already in this conversation.',
        tools
            ? 'The same rules apply: use only tools supplied by the dsh-bridge MCP server, never built-in Antigravity tools.'
            : 'The same rules apply: this is a text-only backend without tools.',
        JSON.stringify({ messages: renderMessages(added) }),
        ...(footer.length
            ? footer
            : [
                'No new human request arrived: these are context updates from DSH (such as subagent results or reminders). Respond to them as the conversation requires.',
            ]),
    ].join('\n\n');
    return byteLength(prompt) <= config.promptBudgetBytes ? prompt : undefined;
}
function renderMessages(messages) {
    return messages.map((m) => ({
        role: m.role,
        ...(sourceKind(m) ? { source: sourceKind(m) } : {}),
        ...('toolCallId' in m ? { toolCallId: m.toolCallId, isError: m.isError ?? false } : {}),
        content: m.content.map((b) => {
            if (b.type === 'image' || b.type === 'file')
                throw acpError('This version accepts text context only. Attachments must be projected by DSH before calling the adapter.', 'UNSUPPORTED_OPTION');
            return b; // Preserve historical text, reasoning, tool calls/results and developer updates.
        }),
    }));
}
const OLD_TOOL_OUTPUT_BYTES = 4000;
const byteLength = (s) => Buffer.byteLength(s, 'utf8');
function shortenText(value, maxBytes) {
    if (byteLength(value) <= maxBytes)
        return value;
    let cut = value.slice(0, maxBytes);
    while (cut.length && byteLength(cut) > maxBytes)
        cut = cut.slice(0, -64);
    return `${cut}\n…[truncated ${byteLength(value) - byteLength(cut)} bytes to fit the Antigravity input limit]`;
}
// Shortens long tool outputs and long tool-call arguments in one message.
function shortenMessage(message, maxBytes) {
    const isToolOutput = message.role === 'tool';
    return {
        ...message,
        content: message.content.map((block) => ({
            ...block,
            ...(isToolOutput && typeof block.text === 'string'
                ? { text: shortenText(block.text, maxBytes) }
                : {}),
            ...(typeof block.arguments === 'string'
                ? { arguments: shortenText(block.arguments, maxBytes) }
                : {}),
        })),
    };
}
// Last resort for oversized preamble messages: shortens every text block too.
function shortenAll(message, maxBytes) {
    const shortened = shortenMessage(message, maxBytes);
    return {
        ...shortened,
        content: shortened.content.map((block) => typeof block.text === 'string'
            ? { ...block, text: shortenText(block.text, maxBytes) }
            : block),
    };
}
export const isHuman = (m) => m.role === 'user' && (sourceKind(m) ?? 'user') === 'user';
// The official Antigravity server keeps only the first 192,000 bytes of a
// prompt and silently drops the rest, which hid the newest messages (and the
// human's latest request) from the model. Keep the session preamble (system
// prompt, AGENTS.md instructions, skill catalog) and everything from the latest
// human request onward; condense the middle, newest first.
function fitToBudget(messages, originals, render, budget) {
    let prompt = render(messages);
    if (byteLength(prompt) <= budget)
        return prompt;
    const firstHuman = originals.findIndex(isHuman);
    const latestHuman = originals.length - 1 - [...originals].reverse().findIndex(isHuman);
    const hasHuman = firstHuman >= 0;
    const preamble = hasHuman ? messages.slice(0, firstHuman) : [];
    const tail = hasHuman ? messages.slice(latestHuman) : messages.slice(-1);
    let middle = hasHuman
        ? messages.slice(firstHuman, latestHuman)
        : messages.slice(0, Math.max(0, messages.length - 1));
    // 1. Shorten old tool outputs and arguments.
    middle = middle.map((m) => shortenMessage(m, OLD_TOOL_OUTPUT_BYTES));
    const omissionNote = (count) => ({
        role: 'user',
        source: 'dsh-antigravity-acp',
        content: [
            {
                type: 'text',
                text: `[${count} earlier messages omitted to fit the Antigravity input limit]`,
            },
        ],
    });
    const assemble = (head, kept, end, omitted) => [
        ...head,
        ...(omitted ? [omissionNote(omitted)] : []),
        ...kept,
        ...end,
    ];
    // 2. Drop the oldest middle messages until the prompt fits.
    const sizes = middle.map((m) => byteLength(JSON.stringify(m)) + 1);
    let omitted = 0;
    let excess = byteLength(render(assemble(preamble, middle, tail, 0))) - budget;
    if (excess > 0) {
        const noteBytes = byteLength(JSON.stringify(omissionNote(middle.length))) + 1;
        excess += noteBytes;
        while (omitted < middle.length && excess > 0)
            excess -= sizes[omitted++];
    }
    let kept = middle.slice(omitted);
    prompt = render(assemble(preamble, kept, tail, omitted));
    while (byteLength(prompt) > budget && kept.length) {
        kept = kept.slice(1);
        omitted++;
        prompt = render(assemble(preamble, kept, tail, omitted));
    }
    // 3. Still too large: shorten the current turn and the preamble progressively.
    let head = preamble;
    let end = tail;
    for (let limit = 16000; byteLength(prompt) > budget && limit >= 500; limit = Math.floor(limit / 2)) {
        end = tail.map((m, i) => (i === 0 ? m : shortenMessage(m, limit)));
        head = preamble.map((m) => shortenAll(m, limit));
        prompt = render(assemble(head, kept, end, omitted));
    }
    // 4. Never send an oversized prompt: the server would drop its end silently.
    const size = byteLength(prompt);
    if (size > budget)
        throw acpError(`This request is ${Math.ceil(size / 1000)} KB even after condensing the history, above the ${Math.floor(budget / 1000)} KB Antigravity input budget (the server ignores everything past 192 KB). Shorten the latest message or attach the content as a file the model can read with tools.`, 'ACP_PROMPT_TOO_LARGE');
    return prompt;
}
export function sourceKind(message) {
    const source = message.source;
    return typeof source?.kind === 'string' ? source.kind : undefined;
}
export function messageText(message) {
    return message.content
        .map((block) => ('text' in block && typeof block.text === 'string' ? block.text : ''))
        .join('\n')
        .trim();
}
// DSH appends user-role context (Mem0 recall, time context, reminders) after the
// human's message, so "the final user message" is often not the request. Restate
// the latest request after the transcript: a human message (source kind "user")
// or a source-less request input (one-shot prompts such as titles or subagent
// tasks). User-role messages from other producers are context, not requests.
function latestHumanRequest(messages) {
    const human = [...messages]
        .reverse()
        .find((m) => m.role === 'user' && (sourceKind(m) ?? 'user') === 'user');
    const text = human && messageText(human);
    if (!text)
        return [];
    // A long pasted message is already in the transcript; restating it in full
    // would double its size against the input limit, so only an excerpt repeats.
    const excerpt = byteLength(text) > RESTATE_FULL_BYTES;
    return [
        'Respond to the latest request from the human user, quoted below. Later user-role messages with other sources (such as mem0-recall or time-context) are background context, not requests. Earlier requests in the transcript were already answered; do not answer them again unless this message asks for it.',
        excerpt
            ? `Latest human request (excerpt; the full text is the last message with source "user" in the transcript):\n<<<\n${shortenText(text, RESTATE_EXCERPT_BYTES)}\n>>>`
            : `Latest human request:\n<<<\n${text}\n>>>`,
    ];
}
const RESTATE_FULL_BYTES = 8000;
const RESTATE_EXCERPT_BYTES = 4000;

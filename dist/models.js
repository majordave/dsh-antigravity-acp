export function selectValues(option) {
    if (option.type !== 'select')
        return [];
    return option.options.flatMap((entry) => ('options' in entry ? entry.options : [entry]));
}
export function modelOption(session) {
    return (session.configOptions?.find((c) => c.category === 'model') ??
        session.configOptions?.find((c) => c.id === 'model'));
}
// The official server announces model IDs but no context capacity. DSH needs a
// positive contextWindow to plan compaction (including on model switches).
const FAMILY_WINDOWS = [
    [/gemini/i, 1048576],
    [/claude/i, 200000],
    [/gpt-oss/i, 131072],
];
export function contextWindowFor(model, config) {
    const explicit = config.contextWindows[model];
    if (explicit)
        return explicit;
    const family = FAMILY_WINDOWS.find(([pattern]) => pattern.test(model));
    return family ? family[1] : config.contextWindow;
}
export function modelCatalog(session) {
    const option = modelOption(session);
    if (option)
        return selectValues(option).map((c) => ({ id: c.value, name: c.name }));
    return []; // Never rely on the deprecated/unstable models extension.
}

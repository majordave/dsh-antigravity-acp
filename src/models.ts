import type {
  NewSessionResponse,
  SessionConfigOption,
  SessionConfigSelectOption,
} from '@agentclientprotocol/sdk';
import type { Config } from './config.js';
export function selectValues(option: SessionConfigOption): SessionConfigSelectOption[] {
  if (option.type !== 'select') return [];
  return option.options.flatMap((entry) => ('options' in entry ? entry.options : [entry]));
}
export function modelOption(session: NewSessionResponse): SessionConfigOption | undefined {
  return (
    session.configOptions?.find((c) => c.category === 'model') ??
    session.configOptions?.find((c) => c.id === 'model')
  );
}
// The official server announces model IDs but no context capacity. DSH needs a
// positive contextWindow to plan compaction (including on model switches).
const FAMILY_WINDOWS: [RegExp, number][] = [
  [/gemini/i, 1048576],
  [/claude/i, 200000],
  [/gpt-oss/i, 131072],
];
export function contextWindowFor(
  model: string,
  config: Pick<Config, 'contextWindow' | 'contextWindows'>,
): number {
  const explicit = config.contextWindows[model];
  if (explicit) return explicit;
  const family = FAMILY_WINDOWS.find(([pattern]) => pattern.test(model));
  return family ? family[1] : config.contextWindow;
}
export function modelCatalog(session: NewSessionResponse): { id: string; name: string }[] {
  const option = modelOption(session);
  if (option) return selectValues(option).map((c) => ({ id: c.value, name: c.name }));
  return []; // Never rely on the deprecated/unstable models extension.
}

// Speech-to-text engines the dictation button can use, and which one is really used. Shared by the engine (detection)
// and the window (the choice), so the rule «a missing engine falls back to Windows» lives in one place.
export const DICTATION_ENGINES = Object.freeze(['windows', 'handy', 'whisper']);

export const dictationChoice = (config) => (DICTATION_ENGINES.includes(config?.ui?.dictation) ? config.ui.dictation : 'windows');

// found: { handy: boolean, whisper: boolean } as src/engine/host/dictation.mjs › detectEngines reports.
// reason: why Windows is used instead of the chosen engine ('missing'), null when the choice stands.
export function resolveDictation(choice, found = {}) {
  const wanted = DICTATION_ENGINES.includes(choice) ? choice : 'windows';
  if (wanted === 'windows') return { engine: 'windows', wanted, fellBack: false, reason: null };
  if (!found?.[wanted]) return { engine: 'windows', wanted, fellBack: true, reason: 'missing' };
  return { engine: wanted, wanted, fellBack: false, reason: null };
}

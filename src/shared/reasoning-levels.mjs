// Every reasoning level Orb knows, from the least to the most. Each agent and model takes a subset of them (what its
// own CLI reports), so this list only fixes the order and the words Orb accepts.
export const REASONING_LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
// What a model is assumed to take when its agent did not say.
export const USUAL_LEVELS = ['low', 'medium', 'high'];

// Only the levels Orb knows, in order and without repeats.
export function knownLevels(list) {
  return Array.isArray(list) ? REASONING_LEVELS.filter((l) => list.includes(l)) : [];
}

// The level to use when `level` is not among `allowed` (a saved value the new model does not take): the closest one,
// the lower one on a tie so a saved choice never costs more than it did. Without a list, the level stays as it is.
export function nearestLevel(level, allowed) {
  const ok = knownLevels(allowed);
  if (!ok.length || ok.includes(level)) return level;
  const at = REASONING_LEVELS.indexOf(level);
  if (at < 0) return ok.includes('medium') ? 'medium' : ok[0];
  let best = ok[0];
  for (const l of ok) { if (Math.abs(REASONING_LEVELS.indexOf(l) - at) < Math.abs(REASONING_LEVELS.indexOf(best) - at)) best = l; }
  return best;
}

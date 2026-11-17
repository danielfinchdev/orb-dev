// Favourite brains: a model + reasoning level + account the user marked with the star in the brain picker. Alt+] and
// Alt+[ walk through them. Pure (no DOM, no storage): the window keeps the list (src/ui/lib/favorite-brains.js).

export const MAX_FAVORITES = 12;
const LEVELS = new Set(['low', 'medium', 'high', 'xhigh']);
const text = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');

// → { agent, model, account, reasoning } or null when it is not a usable brain.
export function cleanBrain(b) {
  if (!b || typeof b !== 'object') return null;
  const agent = text(b.agent, 40);
  if (!/^[\w.-]{1,40}$/.test(agent)) return null;
  const model = text(b.model, 80);
  if (model && !/^[A-Za-z0-9][\w.:\-/[\]=,@]{0,79}$/.test(model)) return null;
  const account = text(b.account, 40) || agent;
  const reasoning = LEVELS.has(b.reasoning) ? b.reasoning : 'medium';
  return { agent, model, account, reasoning };
}

const sameBrain = (a, b) => Boolean(a && b) && a.agent === b.agent && (a.model ?? '') === (b.model ?? '')
  && (a.account || a.agent) === (b.account || b.agent) && (a.reasoning ?? 'medium') === (b.reasoning ?? 'medium');

// What storage held (anything) → a clean list without repeats.
export function parseFavorites(raw) {
  let data = raw;
  if (typeof raw === 'string') { try { data = JSON.parse(raw); } catch { return []; } }
  if (!Array.isArray(data)) return [];
  const out = [];
  for (const item of data) {
    const b = cleanBrain(item);
    if (b && !out.some((x) => sameBrain(x, b))) out.push(b);
    if (out.length >= MAX_FAVORITES) break;
  }
  return out;
}

export const isFavorite = (list, brain) => list.some((x) => sameBrain(x, cleanBrain(brain)));

// Marks or unmarks `brain`. A new favourite goes to the end; the list never passes MAX_FAVORITES.
export function toggleFavorite(list, brain) {
  const b = cleanBrain(brain);
  if (!b) return list;
  if (list.some((x) => sameBrain(x, b))) return list.filter((x) => !sameBrain(x, b));
  return list.length >= MAX_FAVORITES ? list : [...list, b];
}

// The favourite after (step 1) or before (step -1) `current`, going round. When the current brain is not a favourite,
// forwards starts at the first one and backwards at the last. null when there is nothing to move to.
export function stepFavorite(list, current, step = 1) {
  if (!list.length) return null;
  const at = list.findIndex((x) => sameBrain(x, cleanBrain(current)));
  if (at < 0) return step > 0 ? list[0] : list[list.length - 1];
  if (list.length === 1) return null;
  return list[(at + (step > 0 ? 1 : list.length - 1)) % list.length];
}

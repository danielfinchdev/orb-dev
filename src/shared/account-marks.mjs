// The mark of an account (a short tag and a colour) shown wherever the same agent has several accounts. Pure: the engine
// validates and defaults with it, the window draws with it.

export const ACCOUNT_COLORS = ['orange', 'blue', 'green', 'violet', 'rose', 'teal'];
export const TAG_RE = /^[\p{L}\p{N}]{2,4}$/u;

// 2-4 characters from the name: the initials of its words, else its first letters («Personal» -> PE, «Work Max» -> WM).
export function defaultTag(label, id = '') {
  const words = String(label || id).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const raw = words.length > 1 ? words.slice(0, 3).map((w) => w[0]).join('') : (words[0] ?? '').slice(0, 3);
  const tag = raw.toUpperCase();
  return tag.length >= 2 ? tag : (tag + String(id).toUpperCase().replace(/[^\p{L}\p{N}]/gu, '') + 'AC').slice(0, 2);
}

// The account's own tag and colour when it has them; otherwise the colour follows its place among the agent's accounts, so
// neighbours differ without anyone choosing.
export function markOf(acc, index = 0) {
  const tag = TAG_RE.test(acc?.tag ?? '') ? acc.tag.toUpperCase() : defaultTag(acc?.label, acc?.id);
  const color = ACCOUNT_COLORS.includes(acc?.color) ? acc.color : ACCOUNT_COLORS[Math.max(0, index) % ACCOUNT_COLORS.length];
  return { tag, color };
}

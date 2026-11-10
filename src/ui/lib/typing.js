// 3.8.3: the typing of a streamed answer. The engine sends the answer in pieces (one every ~50 ms, or a big one now and
// then); drawn as they come, the text jumps a piece at a time. Here the text on screen follows the received one at its
// own steady pace, one character (grapheme) at a time:
//
//   - adaptive: the pace is the text still to show divided by a short lag (LAG_S), never slower than MIN_CPS, and it
//     changes smoothly (RISE_S up, FALL_S down): it settles at the agent's own speed, about LAG_S behind it, catches up
//     faster when a big piece comes, and never falls more than MAX_BEHIND characters behind;
//   - when the turn ends, what is left is shown quickly (DONE_LAG_S, at least DONE_MIN_CPS);
//   - never half a character: an emoji with its modifiers, a letter with its accents (combining marks) show whole;
//   - Markdown-safe: the shown text is tidied before it is drawn (safeMarkdown): a half-written **bold**, `code` or link,
//     the first line of a table or of a code fence, are not drawn as stray symbols that change a moment later.
//
// No React here (test/escritura.test.mjs); components/markdown.jsx › TypingMarkdown draws it, with one shared frame loop.

export const LAG_S = 0.32;
export const MIN_CPS = 45;
export const RISE_S = 0.05;
export const FALL_S = 0.15;
export const DONE_LAG_S = 0.12;
export const DONE_MIN_CPS = 600;
export const MAX_BEHIND = 3000;

const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
const JOINS = /[\p{M}‍︎️\u{1f3fb}-\u{1f3ff}\u{e0020}-\u{e007f}]/u;

// The last grapheme boundary at or before i (a place where the text can be cut without splitting a character).
// fallback: without Intl.Segmenter (or to test that path).
export function boundaryAtOrBefore(text, i, fallback = !segmenter) {
  if (i <= 0) return 0;
  if (i >= text.length) return text.length;
  if (!fallback) {
    const from = Math.max(0, i - 48);
    let best = from === 0 ? 0 : -1;
    for (const { index } of segmenter.segment(text.slice(from, Math.min(text.length, i + 48)))) {
      if (from + index > i) break;
      best = from + index;
    }
    if (best > 0 || from === 0) return best;
  }
  // Never between the halves of a surrogate pair, nor before a mark, a joiner, a variation selector or a skin tone.
  let j = i;
  while (j > 0) {
    const c = text.charCodeAt(j);
    if ((c >= 0xdc00 && c <= 0xdfff) || JOINS.test(String.fromCodePoint(text.codePointAt(j))) || text.charCodeAt(j - 1) === 0x200d) { j--; continue; }
    return j;
  }
  return 0;
}

// One answer's typing. → { setTarget(text, done), advance(ms) → shown length, shown, target, done, finished }.
// reduced (prefers-reduced-motion, or «Movimiento: mínimo»): the whole text at once. start: what is already on screen.
export function createReveal({ reduced = false, start = 0 } = {}) {
  let target = '';
  let done = false;
  let pos = start; // where the typing is, in UTF-16 units (fractional)
  let shown = start;
  let rate = 0; // characters per second, smoothed
  return {
    get target() { return target; },
    get shown() { return shown; },
    get done() { return done; },
    get finished() { return done && shown >= target.length; },
    setTarget(text, end = false) {
      const next = String(text ?? '');
      // A text that does not continue the one being typed (the answer was rewritten): typing restarts where both agree.
      // A text kept to its last part (an agent's long answer, views/session.jsx): the start that went is taken off.
      if (shown > 0 && target && !next.startsWith(target.slice(0, Math.min(shown, 64)))) {
        const d = target.indexOf(next.slice(0, 64));
        if (d > 0 && next.startsWith(target.slice(d))) { shown = Math.max(0, boundaryAtOrBefore(next, shown - d)); pos = Math.max(shown, pos - d); target = next; }
      }
      if (shown > 0 && target && next.slice(0, shown) !== target.slice(0, shown)) {
        let k = 0; const n = Math.min(shown, next.length);
        while (k < n && next.charCodeAt(k) === target.charCodeAt(k)) k++;
        shown = boundaryAtOrBefore(next, k); pos = shown;
      }
      target = next; done = Boolean(end);
      if (shown > target.length) { shown = target.length; pos = shown; }
      if (reduced) { shown = target.length; pos = shown; }
      return shown;
    },
    advance(ms) {
      if (shown >= target.length) { pos = shown; return shown; }
      const dt = Math.min(Math.max(Number(ms) || 0, 0), 250) / 1000;
      if (target.length - pos > MAX_BEHIND) pos = target.length - MAX_BEHIND;
      const left = target.length - pos;
      const want = done ? Math.max(DONE_MIN_CPS, left / DONE_LAG_S) : Math.max(MIN_CPS, left / LAG_S);
      // The pace follows smoothly (faster to rise than to fall): a pause between pieces does not stutter. At the end, at once.
      // The first word shows in the first frame (the answer starts as soon as it comes, as before), and the pace starts
      // at what the text asks for, not from zero.
      if (shown === 0) { const word = /^\s*\S{1,24}/.exec(target); if (word) pos = Math.max(pos, word[0].length); }
      rate = done || rate === 0 ? Math.max(rate, want) : rate + (want - rate) * (1 - Math.exp(-dt / (want > rate ? RISE_S : FALL_S)));
      pos = Math.min(target.length, pos + Math.max(rate, MIN_CPS) * dt);
      const cut = pos >= target.length ? target.length : boundaryAtOrBefore(target, Math.floor(pos));
      if (cut > shown) shown = cut;
      return shown;
    }
  };
}

// The shown part of an answer, tidied so its last line draws as it will when it is whole. Only the end of the text is
// changed (the finished blocks are left as they are). The whole text (complete): nothing is changed.
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').length;
const TABLE_RULE = /^ {0,3}\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const RICH_FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*(mermaid|math)\b/i;
const MATH_FENCE = /^ {0,3}\$\$\s*$/;
const BLOCK_MARK = /^ {0,3}(#{1,6}|[-*+]|\d+[.)]|>|--)\s*$/;
export function safeMarkdown(text, complete = false) {
  if (complete || !text) return text;
  const lines = text.split('\n');
  // Inside a code fence: shown as code as it is; only the fence's own first line («```js») waits until it is whole.
  let fence = null; let fenceLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const f = lines[i].match(FENCE);
    if (fence) { if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !lines[i].slice(f[0].length).trim()) fence = null; }
    else if (f) { fence = f[1]; fenceLine = i; }
  }
  if (fence) {
    if (fenceLine === lines.length - 1) return lines.slice(0, -1).join('\n');
    // A diagram or a formula still being written is plain code until its fence closes: drawing it (mermaid, KaTeX)
    // on every frame with a half-written source is heavy main-thread work for a picture that is wrong anyway.
    if (RICH_FENCE.test(lines[fenceLine])) { lines[fenceLine] = lines[fenceLine].match(FENCE)[0]; return lines.join('\n'); }
    return text;
  }
  // A `$` block left open: the same, as code until it closes.
  const dollars = lines.reduce((n, l, i) => (MATH_FENCE.test(l) ? [...n, i] : n), []);
  if (dollars.length % 2) { lines[dollars[dollars.length - 1]] = '```'; return lines.join('\n'); }
  let last = lines[lines.length - 1];
  // A block marker alone on the last line («#», «-», «1.», «>»): nothing to draw yet (an empty heading or list item would
  // flash); it shows with its first word.
  if (BLOCK_MARK.test(last)) return lines.slice(0, -1).join('\n');
  // A table at the end: its header waits for the line under it (which makes it a table); a row still being written is
  // drawn without its open cell.
  if (/^ {0,3}\|/.test(last)) {
    let k = lines.length - 1;
    while (k >= 0 && /^ {0,3}\|/.test(lines[k])) k--;
    const table = lines.slice(k + 1);
    if (!(table.length >= 2 && TABLE_RULE.test(table[1]) && cells(table[1]) === cells(table[0]))) return lines.slice(0, k + 1).join('\n');
    if (table.length > 2 && !/\|\s*$/.test(last)) lines[lines.length - 1] = last.slice(0, last.lastIndexOf('|') + 1);
    return lines.join('\n');
  }
  // A link still being written: its words only, as plain text until it is whole («[texto](https://ejem» → «texto»).
  // A picture still being written is not shown yet. «[ ]» and «[x]» (a list of things to do) stay as they are.
  last = last
    .replace(/(!?)\[([^\]\n]*)\](\([^)\s]*)?$/, (m, bang, words, open) => (bang ? '' : (open != null || words.length > 1 ? words : m)))
    .replace(/(!?)\[([^\]\n]*)$/, (m, bang, words) => (bang ? '' : words));
  // Inline code, bold and strike left open are closed for now (they close for real a moment later).
  let tail = '';
  if (((last.match(/`/g) ?? []).length) % 2) tail += '`';
  const plain = last.replace(/`[^`]*`?/g, '');
  for (const mark of ['**', '~~']) {
    if (((plain.split(mark).length - 1) % 2) === 0) continue;
    // A mark at the very end (nothing after it yet) is just hidden.
    if (last.trimEnd().endsWith(mark)) last = last.trimEnd().slice(0, -mark.length).trimEnd(); else { last = last.trimEnd(); tail += mark; }
  }
  // A single star (italics) left open, not one of a list («- item») or a bold pair: closed for now, as the bold.
  const singles = (plain.replace(/\*\*/g, '').match(/(?<!^\s*)\*(?!\s)|(?<=\S)\*/g) ?? []).length;
  if (singles % 2 && !/^ {0,3}\* /.test(last)) { if (last.trimEnd().endsWith('*')) last = last.trimEnd().slice(0, -1).trimEnd(); else tail = `*${tail}`; }
  lines[lines.length - 1] = last + tail;
  return lines.join('\n');
}

// Whether text should appear at once: the system asks for less motion, or «Movimiento: mínimo» in Ajustes.
export function wantsStill(motion) {
  if (motion === 'minima') return true;
  try { return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches); } catch { return false; }
}

// One frame loop for every answer being typed (at most a few): each registered step gets the time since the last frame.
const steps = new Set();
let frame = null; let lastT = 0;
function loop(t) {
  const dt = lastT ? t - lastT : 16;
  lastT = t;
  for (const step of [...steps]) step(dt);
  frame = steps.size ? requestAnimationFrame(loop) : null;
  if (frame == null) lastT = 0;
}
export function onFrame(step) {
  steps.add(step);
  if (frame == null && typeof requestAnimationFrame === 'function') { lastT = 0; frame = requestAnimationFrame(loop); }
  return () => { steps.delete(step); };
}

// The hand-over from the live answer to the saved message: while an answer is typed, what is on screen is noted here
// (by conversation); when the saved message replaces it, it goes on typing from there instead of jumping to the end.
// Only a message that starts with that text, within a few seconds, takes it, and only once: a chat opened later, a
// reload or the history are drawn whole. → { start, tail } or null.
const tails = new Map(); // key → { text (shown), at }
export function noteShown(key, text) { if (key != null) tails.set(key, { text, at: Date.now() }); }
// key: the conversation's own key; only its tail is considered (a message of another chat that starts with the same
// words must not go on typing from it, nor take its place from the live answer).
export function takeShown(body, key) {
  const now = Date.now();
  const text = String(body ?? '');
  for (const [k, tail] of tails) {
    if (now - tail.at > 10000) { tails.delete(k); continue; }
    if (!tail.text || (key != null && k !== key)) continue;
    if (text.startsWith(tail.text)) { tails.delete(k); return { start: tail.text.length, tail: k }; }
  }
  return null;
}

// Highlights what a search found inside rendered text. The Markdown is already drawn, so the match is wrapped in <mark>
// on the DOM's text nodes only: no HTML is rebuilt, and links, code and an earlier mark are left alone.

// The text folded for comparing (no case, no accents), with where each folded character came from in the original.
function fold(text) {
  let out = '';
  const from = [];
  let i = 0;
  for (const ch of text) {
    const f = ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    for (let k = 0; k < f.length; k++) from.push(i);
    out += f;
    i += ch.length;
  }
  from.push(i);
  return { out, from };
}

// 'Carrito del carro' with «carr» → [{ text: 'Carr', hit: true }, ...]. The query is searched as plain text, never as a pattern.
export function splitMatches(text, query) {
  const s = String(text ?? '');
  const needle = fold(String(query ?? '').trim()).out;
  if (!needle) return [{ text: s, hit: false }];
  const { out, from } = fold(s);
  const parts = [];
  let last = 0;
  for (let at = out.indexOf(needle); at >= 0; at = out.indexOf(needle, at + needle.length)) {
    const a = from[at];
    const b = from[at + needle.length];
    if (a < last) continue;
    if (a > last) parts.push({ text: s.slice(last, a), hit: false });
    parts.push({ text: s.slice(a, b), hit: true });
    last = b;
  }
  if (last < s.length) parts.push({ text: s.slice(last), hit: false });
  return parts.length ? parts : [{ text: s, hit: false }];
}

const SKIP = new Set(['A', 'CODE', 'PRE', 'MARK', 'SCRIPT', 'STYLE', 'BUTTON']);

// Wraps the matches under `root`; returns a function that puts the original text nodes back.
export function highlightIn(root, query) {
  if (!root || !String(query ?? '').trim()) return () => {};
  const walker = document.createTreeWalker(root, window.NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      for (let p = n.parentNode; p && p !== root; p = p.parentNode) if (SKIP.has(p.nodeName)) return window.NodeFilter.FILTER_REJECT;
      return window.NodeFilter.FILTER_ACCEPT;
    }
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  const done = [];
  for (const node of nodes) {
    const parts = splitMatches(node.nodeValue, query);
    if (!parts.some((p) => p.hit)) continue;
    const made = parts.map((p) => {
      if (!p.hit) return document.createTextNode(p.text);
      const m = document.createElement('mark');
      m.textContent = p.text;
      return m;
    });
    node.replaceWith(...made);
    done.push({ node, made });
  }
  return () => {
    for (const { node, made } of done) {
      if (!made[0].parentNode) continue;
      made[0].replaceWith(node);
      for (const m of made.slice(1)) m.remove();
    }
  };
}

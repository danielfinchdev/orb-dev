// Pure helpers of the Logs tab.

// The log file names the engine lists → the three groups of the list. «general» is alone; a deleted project's log
// keeps its name with « eliminado» at the end.
export function groupLogs(logs) {
  const out = { general: null, projects: [], deleted: [] };
  for (const l of logs ?? []) {
    if (l.name === 'general') out.general = l;
    else if (/\beliminad[oa]$/i.test(l.name)) out.deleted.push(l);
    else out.projects.push(l);
  }
  return out;
}

// Entries start at a «### » heading; what comes before the first one (the index and the rules) stays with it.
// Only the entries that mention the text are kept (the text itself is never treated as markup).
export function filterEntries(body, q) {
  const needle = String(q ?? '').trim().toLowerCase();
  if (!needle) return { text: body, count: null };
  const parts = String(body ?? '').split(/^(?=### )/m).filter((p) => p.startsWith('### '));
  const hits = parts.filter((p) => p.toLowerCase().includes(needle));
  return { text: hits.join('\n'), count: hits.length };
}

// The newest entry of a log as { date, topic } for a one-line summary: its headings read «### AAAA-MM-DD HH:MM — author — topic».
export function lastEntry(text) {
  const heads = [...String(text ?? '').matchAll(/^### (\d{4})-(\d{2})-(\d{2})(?: \d{2}:\d{2})?[ \t]*—[ \t]*(.*)$/gm)];
  const h = heads.at(-1);
  if (!h) return null;
  const parts = h[4].split(/[ \t]+—[ \t]+/);
  const topic = (parts.length > 1 ? parts.slice(1).join(' — ') : parts[0]).trim();
  return topic ? { date: new Date(Number(h[1]), Number(h[2]) - 1, Number(h[3])), topic } : null;
}

// The body of a log as cards: what precedes the first «### » heading (the index and the rules) and the entries, each with
// its number (1 = the oldest), the date, the author and the topic of its heading «### AAAA-MM-DD HH:MM — author — topic».
// A heading of another shape keeps its whole text as the topic.
export function parseEntries(body) {
  const parts = String(body ?? '').split(/^(?=### )/m);
  const pre = parts.length && !parts[0].startsWith('### ') ? parts.shift().trim() : '';
  const entries = parts.map((raw, i) => {
    const nl = raw.indexOf('\n');
    const head = (nl === -1 ? raw : raw.slice(0, nl)).replace(/^###\s+/, '').trim();
    const rest = nl === -1 ? '' : raw.slice(nl + 1).trim();
    const m = head.match(/^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?[ \t]*—[ \t]*(.*)$/);
    if (!m) return { n: i + 1, date: null, time: '', author: '', topic: head, body: rest, raw };
    const bits = m[6].split(/[ \t]+—[ \t]+/);
    const author = bits.length > 1 ? bits[0].trim() : '';
    const topic = (bits.length > 1 ? bits.slice(1).join(' — ') : bits[0]).trim();
    return { n: i + 1, date: new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])), time: m[4] ? `${m[4]}:${m[5]}` : '', author, topic, body: rest, raw };
  });
  return { pre, entries };
}

// The agent a log author names, to colour its mark (pieces.css › [data-agent]).
export function authorAgent(author) {
  const a = String(author ?? '').toLowerCase();
  for (const id of ['claude', 'codex', 'cursor', 'gemini', 'orb']) if (a.includes(id)) return id;
  return 'other';
}

// The logs whose text mentions the needle: { name → hits }. Logs with no hit are left out. Plain text, never markup.
export function countHits(bodies, q) {
  const needle = String(q ?? '').trim().toLowerCase();
  const out = {};
  if (!needle) return out;
  for (const [name, body] of Object.entries(bodies ?? {})) {
    const hits = String(body ?? '').split(/^(?=### )/m).filter((p) => p.startsWith('### ') && p.toLowerCase().includes(needle)).length;
    if (hits) out[name] = hits;
  }
  return out;
}

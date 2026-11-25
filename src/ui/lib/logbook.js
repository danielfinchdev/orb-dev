import { foldText } from './mark-matches.js';
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

// The labelled lines of an entry («- Pedido de Dani: …», «- Hecho: …», «- Cómo revertir: …», «- Estado / pendiente: …»)
// as rows { key, text }; the lines under a label (sub-bullets, code) belong to it. `lead` is what precedes the first label
// and `parts` stays empty when the entry has none, so it is drawn as plain Markdown.
const PART_KEYS = [
  [/^pedido(?:\s+(?:de|por)\s+[^:]{1,40})?$/i, 'request'],
  [/^hecho$/i, 'done'],
  [/^c[oó]mo\s+revertir$/i, 'revert'],
  [/^(?:estado\s*\/\s*)?pendiente$|^estado$/i, 'pending'],
];
const PART_LINE = /^[-*][ \t]+(?:\*\*)?([^:\n*]{2,40}?)(?:\*\*)?[ \t]*:(?:\*\*)?[ \t]*(.*)$/;
export function splitParts(text) {
  const lead = [];
  const parts = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = line.match(PART_LINE);
    const key = m ? PART_KEYS.find(([re]) => re.test(m[1].trim()))?.[1] : null;
    if (key) parts.push({ key, label: m[1].trim(), lines: [m[2]] });
    else if (parts.length) parts.at(-1).lines.push(line);
    else lead.push(line);
  }
  if (!parts.length) return { lead: '', parts: [] };
  return {
    lead: lead.join('\n').trim(),
    parts: parts.map((p) => {
      // sub-bullets keep their relative indent but lose the one the label's own bullet gave them
      const tail = p.lines.slice(1);
      const indent = Math.min(...tail.filter((l) => l.trim()).map((l) => l.match(/^[ \t]*/)[0].length), 4);
      const text = [p.lines[0], ...tail.map((l) => l.slice(Math.min(indent, l.match(/^[ \t]*/)[0].length)))].join('\n').trim();
      return { key: p.key, label: p.label, text };
    }).filter((p) => p.text),
  };
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
    if (!m) return { n: i + 1, date: null, time: '', author: '', topic: head, body: rest, ...splitParts(rest), raw };
    const bits = m[6].split(/[ \t]+—[ \t]+/);
    const author = bits.length > 1 ? bits[0].trim() : '';
    const topic = (bits.length > 1 ? bits.slice(1).join(' — ') : bits[0]).trim();
    return { n: i + 1, date: new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])), time: m[4] ? `${m[4]}:${m[5]}` : '', author, topic, body: rest, ...splitParts(rest), raw };
  });
  return { pre, entries };
}

// The agent a log author names, to colour its mark (pieces.css › [data-agent]).
export function authorAgent(author) {
  const a = String(author ?? '').toLowerCase();
  for (const id of ['claude', 'codex', 'cursor', 'gemini', 'orb']) if (a.includes(id)) return id;
  return 'other';
}

// A log cut into its entries and folded once (no case, no accents): the form the searches compare against.
export const foldedEntries = (body) => String(body ?? '').split(/^(?=### )/m).filter((p) => p.startsWith('### ')).map(foldText);

// The logs whose entries mention the needle: { name → hits }, from the folded entries of each. Logs with no hit are left out.
export function countFolded(byLog, q) {
  const needle = foldText(String(q ?? '').trim());
  const out = {};
  if (!needle) return out;
  for (const [name, entries] of Object.entries(byLog ?? {})) {
    const hits = entries.filter((e) => e.includes(needle)).length;
    if (hits) out[name] = hits;
  }
  return out;
}

// The same from whole bodies. Plain text, never markup.
export function countHits(bodies, q) {
  return countFolded(Object.fromEntries(Object.entries(bodies ?? {}).map(([name, body]) => [name, foldedEntries(body)])), q);
}

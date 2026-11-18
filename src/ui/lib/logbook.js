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

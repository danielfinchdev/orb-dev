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

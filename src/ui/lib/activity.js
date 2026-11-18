// The engine's log as a line anyone can read: «Uso de la tarea · 1 min», «Tarea lanzada · Cursor», instead of
// «task.usage {"minutes":1,"tokens":0,"costUsd":null}». The raw event stays for copying and on hover.
// Every view that draws an event goes through activityDetail: JSON and the engine's own names never reach the screen.

const json = (s) => { if (!/^\s*[{[]/.test(String(s ?? ''))) return null; try { return JSON.parse(s); } catch { return null; } };

// The name of an event: its own text when there is one, else the internal name.
export function activityLabel(t, kind) {
  const key = `activity.kind.${String(kind ?? '').replace(/\./g, '_')}`;
  const label = t(key);
  return label === key ? kind : label;
}

// The tools of Orb in plain words; the families collapse (every orb_browser_* is «usar el navegador»).
function toolLabel(t, name) {
  const short = name.replace(/^orb_/, '').replace(/^browser_.*/, 'browser').replace(/^android_.*/, 'android');
  const key = `activity.tool.${short}`;
  const label = t(key);
  return label === key ? t('activity.tool') : label;
}

// Task states travel as internal words («done», «blocked»); they are told with the labels the Tareas view uses.
function stateLabel(t, v) {
  if (typeof v !== 'string' || !/^[a-z_]+$/.test(v)) return v;
  const key = `status.${v}`;
  const label = t(key);
  return label === key ? v : label;
}

const oneLine = (s, max) => {
  const flat = String(s).replace(/\s+/g, ' ').trim();
  return max && flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat;
};

// A text the engine or an agent wrote: Orb's tool names and the quoted states inside it are told in words.
// max: cut to that many characters with «…» on one line (the Actividad list keeps one line per event).
export function activityText(t, raw, max = 0, agents = {}) {
  // a line of a list starts without Markdown marks («## Contexto», «- nota»)
  const lead = max ? /^(?:(?:#{1,6}|>|[-*+])\s+)+/ : /^$^/;
  const text = String(raw ?? '').trim().replace(lead, '')
    .replace(/\s*\(refs\/[^)]+\)/g, '') // git references mean nothing to a person
    .replace(/\brefs\/orb\/\S+/g, '')
    .replace(/\b(orb_[a-z_]+)\b(?:\s+(?:con\s+)?status:?\s*"?([a-z_]+)"?)?/g, (_, name, st) => `${toolLabel(t, name)}${st ? ` · ${String(stateLabel(t, st)).toLowerCase()}` : ''}`)
    .replace(/"([a-z_]+)"/g, (m, w) => { const label = stateLabel(t, w); return label === w ? m : String(label).toLowerCase(); })
    .replace(/\bnull\b/g, '')
    // the engine's own log lines: «código 0» says nothing when all went well, and «estado done» is a task state
    .replace(/\(c[oó]digo 0, /g, '(').replace(/, c[oó]digo 0\)/g, ')').replace(/ ?\(c[oó]digo 0\)/g, '')
    .replace(/\bestado ([a-z_]+)\b/g, (m, w) => { const label = stateLabel(t, w); return label === w ? m : `estado: ${String(label).toLowerCase()}`; })
    // a piece that is exactly an agent's id is told with its name
    .split(' · ').map((part) => agents[part.trim()] ?? part).join(' · ')
    .trim();
  return oneLine(stateLabel(t, text), max);
}

// What happened, in a short line (empty when the raw detail says nothing to a person).
// agents: the names of the agents (labels.js AGENT), passed in so this stays free of the app's store.
export function activityDetail(t, row, locale, agents = {}, max = 0) {
  const raw = String(row?.detail ?? '').trim();
  const data = json(raw);
  // A cut-off object (the engine clips long details) is still JSON: it says nothing to a person.
  if (!data && /^(\{\s*"|\[\s*[{"\d])/.test(raw)) return '';
  const num = (n, opts) => Number(n).toLocaleString(locale, opts);
  if (data) {
    // Only the two events that carry an object have a sentence; any other object or list says nothing to a person.
    if (Array.isArray(data) || typeof data !== 'object') return '';
    if (row?.kind === 'task.usage') {
      const parts = [];
      if (data.minutes != null) parts.push(data.minutes < 1 ? `<1 ${t('activity.min')}` : t('activity.minutes', { n: num(Math.round(data.minutes)) }));
      if (data.tokens) parts.push(t('activity.tokens', { n: num(data.tokens) }));
      if (data.costUsd) parts.push(`$${num(data.costUsd, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
      return parts.join(' · ');
    }
    if (row?.kind === 'task.launch_options') {
      const who = agents[data.agent] ?? data.agent;
      const account = data.account && data.account !== data.agent ? t('activity.account', { account: agents[data.account] ?? data.account }) : null;
      const level = data.reasoning ? t('activity.reasoning', { level: String(t(`reasoning.${data.reasoning}`)).toLowerCase() }) : null;
      return [who, account, data.model ? t('activity.model', { model: data.model }) : null, level].filter(Boolean).join(' · ');
    }
    return '';
  }
  return activityText(t, raw, max, agents);
}

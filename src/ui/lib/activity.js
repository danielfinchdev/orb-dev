// 3.2.1: the engine's log as a line anyone can read: «Uso de la tarea · 1 min», «Tarea lanzada · Cursor», instead of
// «task.usage {"minutes":1,"tokens":0,"costUsd":null}». The raw event stays for copying and on hover.

const json = (s) => { if (!/^\s*[{[]/.test(String(s ?? ''))) return null; try { return JSON.parse(s); } catch { return null; } };

// The name of an event: its own text when there is one, else the internal name.
export function activityLabel(t, kind) {
  const key = `activity.kind.${String(kind ?? '').replace(/\./g, '_')}`;
  const label = t(key);
  return label === key ? kind : label;
}

// What happened, in a short line (empty when the raw detail says nothing to a person).
// agents: the names of the agents (labels.js AGENT), passed in so this stays free of the app's store.
export function activityDetail(t, row, locale, agents = {}) {
  const raw = String(row?.detail ?? '').trim();
  const data = json(raw);
  const num = (n) => Number(n).toLocaleString(locale);
  if (row?.kind === 'task.usage' && data) {
    const parts = [];
    if (data.minutes != null) parts.push(t('activity.minutes', { n: num(data.minutes) }));
    if (data.tokens) parts.push(t('activity.tokens', { n: num(data.tokens) }));
    if (data.costUsd != null) parts.push(`$${Number(data.costUsd).toFixed(2)}`);
    return parts.join(' · ');
  }
  if (row?.kind === 'task.launch_options' && data) {
    const who = agents[data.agent] ?? data.agent;
    return [who, data.model, data.reasoning ? t('activity.reasoning', { level: t(`reasoning.${data.reasoning}`).toLowerCase() }) : null].filter(Boolean).join(' · ');
  }
  if (data) {
    // Any other JSON: its simple values, as «name: value».
    if (Array.isArray(data)) return data.filter((v) => ['string', 'number'].includes(typeof v)).join(', ');
    return Object.entries(data).filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v) && v !== '').slice(0, 4).map(([k, v]) => `${k}: ${v}`).join(' · ');
  }
  // Git references and ids that mean nothing to a person (refs/orb/t24-1791970229048).
  return raw.replace(/\s*\(refs\/[^)]+\)/g, '').replace(/\brefs\/orb\/\S+/g, '').trim();
}

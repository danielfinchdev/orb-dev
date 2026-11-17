import { AGENT } from './labels.js';

// The lines of the card, from the engine's digest (pure: tested without React).
export function digestLines(d, t) {
  if (!d || d.empty) return [];
  const out = [];
  if (d.done?.count) out.push({ key: 'done', text: t('orbchats.digestDone', { n: d.done.count }), items: d.done.items.map((x) => `#${x.id} ${x.title}`) });
  if (d.failed?.count) out.push({ key: 'failed', text: t('orbchats.digestFailed', { n: d.failed.count }), items: d.failed.items.map((x) => `#${x.id} ${x.title}`) });
  if (d.entries?.count) out.push({ key: 'entries', text: t('orbchats.digestEntries', { n: d.entries.count }), items: d.entries.items.map((x) => `${x.project}: ${x.topic}`) });
  if (d.waiting?.approvals) out.push({ key: 'approvals', text: t('orbchats.digestApprovals', { n: d.waiting.approvals }), items: [] });
  if (d.waiting?.held) out.push({ key: 'held', text: t('orbchats.digestHeld', { n: d.waiting.held }), items: [] });
  if (d.usage?.length) out.push({ key: 'usage', text: t('orbchats.digestUsage'), items: d.usage.map((u) => `${AGENT[u.agent] ?? u.agent}: ${t('orbchats.digestTurns', { n: u.turns })}${u.usd ? ` · ${u.usd.toFixed(2)} USD` : ''}`) });
  return out;
}

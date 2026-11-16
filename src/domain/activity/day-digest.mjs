// The summary of a day (the card Orb shows when it opens in the morning, also on the phone): what the logs and the
// board registered for ONE local day, nothing else. A section with nothing registered stays empty: nothing is guessed
// or filled in. Only short titles and counts leave this file (no log bodies, no paths, no task results), and secrets
// are redacted, because the phone link carries it.
import fs from 'node:fs';
import { ctx } from '../../platform/context.mjs';
import { localDay, ownerTz, utcToZoned } from '../../shared/tz.mjs';
import { redactSecrets } from '../../shared/secrets-scan.mjs';
import { cutWords, logFiles } from '../journal/journal.mjs';
import { accounts } from '../usage/accounts.mjs';

const LIST_MAX = 8;
const title = (v, n = 90) => cutWords(redactSecrets(String(v ?? '')), n);

// the local day before `now` ('YYYY-MM-DD'), by calendar days (not 24 h steps, which repeat a day after a clock change).
export function previousDay(now = new Date(), tz = ownerTz(ctx.config)) {
  const [y, m, d] = localDay(now, tz).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

// «### 2026-11-15 09:30 — Author — Topic» headings of one log that fall on `day`.
export function logEntriesOf(text, day) {
  const out = [];
  for (const m of String(text ?? '').matchAll(/^### (\d{4}-\d{2}-\d{2}) \d{2}:\d{2} — (.+?) — (.+)$/gm)) if (m[1] === day) out.push({ author: title(m[2], 60), topic: title(m[3], 100) });
  return out;
}

// → { day, done: { count, items[] }, failed: { count, items[] }, entries: { count, items[{ project, author, topic }] },
//      usage: [{ agent, usd, turns }], waiting: { approvals, held }, empty }
// `waiting` is what needs the user at this moment (not of that day): the card says it apart from the day's facts.
export function dayDigest(board, { day, now = new Date() } = {}) {
  const tz = ownerTz(ctx.config);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(day ?? '')) ? day : previousDay(now, tz);
  const onDay = (iso) => { const t = Date.parse(iso ?? ''); return Number.isFinite(t) && localDay(new Date(t), tz) === d; };
  // a loose UTC window around the day keeps the query small; the exact local-day test is done in JS.
  const t0 = Date.parse(`${d}T00:00:00Z`);
  const lo = new Date(t0 - 36 * 3600e3).toISOString(); const hi = new Date(t0 + 60 * 3600e3).toISOString();
  const tasks = board.all('SELECT id, title, status, updated_at FROM tasks WHERE updated_at >= ? AND updated_at <= ? ORDER BY updated_at', lo, hi).filter((t) => onDay(t.updated_at));
  const list = (rows) => ({ count: rows.length, items: rows.slice(-LIST_MAX).map((t) => ({ id: t.id, title: title(t.title) })) });

  const entries = [];
  for (const [project, file] of logFiles(board)) {
    let text; try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    for (const e of logEntriesOf(text, d)) entries.push({ project, ...e });
  }

  const agentOf = new Map(accounts().map((a) => [a.id, a.agent]));
  const usage = new Map();
  for (const r of board.all(`SELECT u.account_id AS account, u.turns, u.usd, COALESCE(s.agent, t.assigned_to, t.agent, c.agent) AS agent
      FROM usage_ledger u LEFT JOIN sessions s ON s.id = u.session_id LEFT JOIN tasks t ON t.id = u.task_id LEFT JOIN conversations c ON c.id = u.conversation_id
      WHERE u.day = ?`, d)) {
    const agent = agentOf.get(r.account) ?? r.agent ?? 'claude';
    const u = usage.get(agent) ?? usage.set(agent, { agent, usd: 0, turns: 0 }).get(agent);
    u.usd += Number(r.usd) || 0; u.turns += Number(r.turns) || 0;
  }

  const open = board.all("SELECT id, status FROM tasks WHERE status IN ('awaiting_approval', 'blocked')");
  const waiting = { approvals: open.filter((t) => t.status === 'awaiting_approval').length, held: open.filter((t) => t.status === 'blocked' && board.heldInfo(t)).length };

  const out = {
    day: d,
    done: list(tasks.filter((t) => t.status === 'done')),
    failed: list(tasks.filter((t) => t.status === 'failed')),
    entries: { count: entries.length, items: entries.slice(-LIST_MAX) },
    usage: [...usage.values()].sort((a, b) => b.usd - a.usd || b.turns - a.turns).map((u) => ({ ...u, usd: Math.round(u.usd * 100) / 100 })),
    waiting
  };
  out.empty = !out.done.count && !out.failed.count && !out.entries.count && !out.usage.length && !waiting.approvals && !waiting.held;
  return out;
}

// whether the morning card is due: once per local day, not before 05:00, never twice (the day it was last shown is kept).
export function morningDue(shownDay, now = new Date(), tz = ownerTz(ctx.config)) {
  const z = utcToZoned(now, tz);
  return Number(z.iso.slice(11, 13)) >= 5 && shownDay !== localDay(now, tz);
}

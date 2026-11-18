// What the Projects list and a project's page say about it, worked out from what the window already holds (tasks, chats)
// and from one `projects.info` read. Pure on purpose: the tests run them on their own.
import { needsApproval } from './task-approval.js';

const DAY = 86_400_000;
// a failed task counts against a project only while it is recent: an old failure is history, not a warning.
export const FAIL_WINDOW = 7 * DAY;

const newest = (a, b) => (String(a ?? '') >= String(b ?? '') ? a : b);

// The newest sign of life of a project: a task or a chat that moved last.
export function lastActivityAt(name, { tasks = [], sessions = [], conversations = [] } = {}) {
  let best = null;
  for (const list of [tasks, sessions, conversations]) for (const x of list) if (x?.project === name && x.updated_at) best = best ? newest(best, x.updated_at) : x.updated_at;
  return best;
}

// { running, approve, failed }: what is going on in the project's tasks.
export function taskCounts(name, tasks = [], now = Date.now()) {
  const out = { running: 0, approve: 0, failed: 0 };
  for (const x of tasks) {
    if (x?.project !== name) continue;
    if (needsApproval(x)) out.approve += 1;
    else if (x.status === 'running' || x.status === 'queued') out.running += 1;
    else if (['failed', 'blocked', 'limited'].includes(x.status) && !x.held && !x.undone && now - new Date(x.updated_at).getTime() < FAIL_WINDOW) out.failed += 1;
  }
  return out;
}

// «hace 3 min», «ayer», «hace 4 días» (t: the locale's function).
export function since(iso, t, now = Date.now()) {
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '';
  const min = Math.max(0, Math.floor(ms / 60_000));
  if (min < 1) return t('projects.ago.now');
  if (min < 60) return t('projects.ago.min', { n: min });
  if (min < 1440) return t('projects.ago.h', { n: Math.floor(min / 60) });
  const days = Math.floor(ms / DAY);
  return days < 2 ? t('projects.ago.yesterday') : t('projects.ago.days', { n: days });
}

export const plural = (t, base, n, params = {}) => t(`${base}${n === 1 ? 'One' : 'Other'}`, { n, ...params });

// The newest entry of a log file: «### 2026-11-18 10:12 — Who — Topic» and what follows it, as plain text.
export function lastLogEntry(text) {
  const parts = String(text ?? '').split(/^(?=### )/m).filter((x) => x.startsWith('### '));
  const last = parts.at(-1);
  if (!last) return null;
  const [head, ...rest] = last.split(/\r?\n/);
  const m = head.match(/^### (\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}))?[ \t]*—[ \t]*(.*)$/);
  if (!m) return null;
  const bits = m[3].split(/[ \t]+—[ \t]+/);
  const who = bits.length > 1 ? bits[0].trim() : '';
  const topic = (bits.length > 1 ? bits.slice(1).join(' — ') : bits[0]).trim();
  const body = rest.map((l) => l.replace(/\*\*/g, '').replace(/^\s*[-*]\s+/, '').trimEnd()).join('\n').trim();
  return { date: m[1], time: m[2] ?? '', who, topic, body };
}

// One line of the list's row about git, from the project's info: facts the row draws with its own colour.
// kind: ok | warn | muted. Never throws on a project without git.
export function gitFacts(info) {
  if (!info) return [];
  // the read failed or took too long: said apart from a folder that is simply not a repository.
  if (info.unavailable) return [{ key: 'nodata', kind: 'muted' }];
  if (!info.git) return [{ key: 'nogit', kind: 'muted' }];
  const out = [{ key: 'branch', value: info.branch }];
  if (info.changes) out.push({ key: 'changes', n: info.changes, kind: 'warn' });
  if (info.ahead) out.push({ key: 'ahead', n: info.ahead, kind: 'warn' });
  if (!info.changes && !info.ahead) out.push({ key: 'uptodate', kind: 'ok' });
  // a list read without network leaves `prs` out when no PR is known: nothing is said about them then.
  if (info.remote && /github\.com/i.test(info.remote) && Array.isArray(info.prs)) out.push({ key: 'prs', n: info.prs.length });
  return out;
}

// «owner/name» of the repository a pull request's URL names (https://host/owner/name/pull/12, GitHub or Enterprise): the
// one gh will act on, whatever the folder's remotes say. null when the URL is not a pull request's.
export function repoOfPr(url) {
  const m = String(url ?? '').trim().match(/^https?:\/\/[^/\s]+\/([^/\s]+)\/([^/\s]+)\/pull\/\d+(?:[/?#].*)?$/i);
  return m ? `${m[1]}/${m[2]}` : null;
}

// «owner/name» of a GitHub remote (https or ssh, with or without .git); null when it is not one.
export function repoOf(remote) {
  const m = String(remote ?? '').trim().match(/github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  return m ? `${m[1]}/${m[2]}` : null;
}

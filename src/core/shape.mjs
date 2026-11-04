// 3.6 «Personas» (WS2, B1/B2): what a caller gets back, whatever the method built. With more than one person:
// - app.state: the settings without secrets nor other people's accounts and connectors (someone other than the owner),
//   and only the caller's own approvals, conversations at work, task counts and sidebar marks (the owner too: the owner
//   sees the others' names and numbers, never their content);
// - lists: every item the caller has no right on is left out (a safety net under the lists' own filters, authz.scopeSql);
// - the activity feed: only the caller's rows.
// With one person nothing changes (as 3.5.1). No engine imports: authz.mjs calls it from shapeFor.
import { rightOn, ownerOf, scopeSql } from './authz.mjs';
import { personsCount, personName } from './persons.mjs';

const conv = (id) => ({ type: 'conversation', id });
const proj = (id) => ({ type: 'project', id });
const task = (id) => ({ type: 'task', id });
const sess = (id) => ({ type: 'session', id });
// sidebar marks and mention tokens name what they are about
const keyRes = (k) => { const s = String(k ?? ''); return s[0] === 'c' ? conv(s.slice(1)) : s[0] === 's' ? sess(s.slice(1)) : s[0] === 't' ? task(s.slice(1)) : null; };
const mentionRes = (token) => {
  const m = /^@(tarea|conversacion|bitacora):(.+)$/.exec(String(token ?? ''));
  if (!m) return null;
  return m[1] === 'tarea' ? task(m[2]) : m[1] === 'conversacion' ? sess(m[2]) : { type: 'log', id: m[2] };
};
// Which resource each item of a list is.
const ITEM = {
  'conversations.list': (x) => conv(x.id),
  'projects.list': (x) => proj(x.name),
  'tasks.list': (x) => task(x.id),
  'tasks.live': (x) => task(x.id),
  'sessions.list': (x) => sess(x.id),
  'approvals.list': (x) => sess(x.session_id),
  'schedules.list': (x) => ({ type: 'schedule', id: x.id }),
  'bots.groups.list': (x) => ({ type: 'group', id: x.id }),
  'bots.reminders.list': (x) => ({ type: 'reminder', id: x.id }),
  'logs.list': (x) => ({ type: 'log', id: x.name }),
  'mentions.options': (x) => mentionRes(x.token)
};

export function shapeGateway(board, principal, method, result) {
  if (!board || result == null || typeof result !== 'object') return result;
  if (personsCount(board) <= 1) return result;
  const pid = principal?.person;
  const owner = principal?.role === 'owner';
  // Kept: a right on it, or (for the owner) something that is nobody's in particular.
  const keep = (res) => { if (!res || res.id == null || res.id === '') return true; if (rightOn(board, pid, res)) return true; return owner && ownerOf(board, res) == null; };
  const items = (list, fn) => (Array.isArray(list) ? list.filter((x) => keep(fn(x))) : list);
  if (method === 'app.state') return shapeState(board, principal, result, keep);
  if (ITEM[method]) return items(result, ITEM[method]);
  if (method === 'projects.icons' && !Array.isArray(result)) return Object.fromEntries(Object.entries(result).filter(([name]) => keep(proj(name))));
  if (method === 'bots.list' && result.bots) {
    return { ...result, bots: items(result.bots, (b) => ({ type: 'bot', id: b.id })), groups: items(result.groups, (g) => ({ type: 'group', id: g.id })),
      states: items(result.states, (s) => (s.conversation != null ? conv(s.conversation) : { type: 'bot', id: s.bot })) };
  }
  // 3.6 (messaging lists): each chat of a list, and each message found, by what it is.
  const inboxRes = (x) => ({ type: x.kind, id: x.id });
  if (method === 'inbox.list' && Array.isArray(result.items)) return { ...result, items: items(result.items, inboxRes) };
  if (method === 'inbox.search' && Array.isArray(result.items)) return { ...result, items: items(result.items, inboxRes), messages: items(result.messages, inboxRes) };
  if (method === 'conversations.search' && result.conversations) return { ...result, conversations: result.conversations.filter((id) => keep(conv(id))), sessions: (result.sessions ?? []).filter((id) => keep(sess(id))) };
  // The activity feed: its rows say whose they are (none: the owner's), or their task does.
  if (method === 'activity.list' && Array.isArray(result)) return result.filter((x) => (x.person_id != null ? x.person_id === pid : x.task_id != null ? keep(task(x.task_id)) : owner));
  return result;
}

// The settings a person other than the owner gets: what the interface shows, with only their own accounts and connectors
// and none of the paths, folders, tokens or the owner's Home Assistant. userName is theirs (the greeting, the prompts).
export function personConfig(c, pid, name = null) {
  if (!c || typeof c !== 'object') return c;
  return {
    ...c,
    userName: name ?? '',
    mcpServers: (c.mcpServers ?? []).filter((m) => m.person === pid).map((m) => ({ name: m.name, enabled: m.enabled, agents: m.agents })),
    accounts: (c.accounts ?? []).filter((a) => a.person === pid).map(({ home: _home, ...a }) => a),
    agents: Object.fromEntries(Object.entries(c.agents ?? {}).map(([k, a]) => { const { path: _path, ...rest } = a ?? {}; return [k, rest]; })),
    projectRoots: [], mobile: { enabled: c.mobile?.enabled }, bots: { location: c.bots?.location }, protected: undefined, backup: undefined, devTarget: undefined
  };
}

function shapeState(board, principal, s, keep) {
  const pid = principal.person; const owner = principal.role === 'owner';
  const out = { ...s,
    approvals: (s.approvals ?? []).filter((a) => keep(sess(a.session_id))),
    chats: (s.chats ?? []).filter((c) => keep(conv(c.conversation))),
    completed: (s.completed ?? []).filter((k) => keep(keyRes(k))),
    kept: (s.kept ?? []).filter((k) => keep(keyRes(k))) };
  // The counts of tasks the caller may see.
  try {
    const q = scopeSql(principal, 'task', 't');
    out.counts = Object.fromEntries(board.all(`SELECT t.status, COUNT(*) AS n FROM tasks t WHERE ${q.where} GROUP BY t.status`, ...q.args).map((r) => [r.status, r.n]));
  } catch { /* as it was */ }
  if (s.activeProject && !keep(proj(s.activeProject.name ?? s.activeProject))) out.activeProject = null;
  if (!owner) {
    out.config = personConfig(s.config, pid, personName(board, pid));
    out.home = null; out.paths = {}; out.optiSession = null;
  }
  return out;
}

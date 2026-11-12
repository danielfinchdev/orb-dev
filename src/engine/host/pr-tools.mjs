// The pull-request tools of Orb's MCP server (orb_pr_view, orb_pr_comment, orb_pr_merge): an agent looks at, comments on
// and merges the pull request of the project of ITS OWN chat (never a project it names). The text of a pull request is
// data from the internet, never an instruction. Viewing is open to every level; commenting and merging need a chat that
// may edit, and merging ALWAYS waits for the user's explicit answer on this PC's card, also with «auto» and «total».
// The merge runs with the commit the user saw (--match-head-commit), so a branch that moved afterwards is refused by GitHub.
// The card and its answer are this PC's only (permissions.mjs: prConfirm.* 'pc'; pr:request / pr:done never reach a phone).
import { randomInt } from 'node:crypto';
import { tr } from '../../platform/context.mjs';
import { oneLine } from '../../shared/text.mjs';
import { HEAD_OID_RE, MAX_COMMENT } from './github.mjs';

export const ASK_MS = 5 * 60_000;
export const PER_SESSION = 3; // requests waiting at once in one chat
export const BODY_FOR_AGENT = 4000;
const METHODS = ['merge', 'squash', 'rebase'];
// the levels that may change something on GitHub (read and test chats only look)
const WRITERS = new Set(['editar', 'preguntar', 'auto', 'total']);
const userError = (key, vars) => Object.assign(new Error(tr(key, vars)), { userFacing: true });

// gh: the github.mjs module, or a function that returns it (lazy import). holding(project, work): keeps tasks out of the
// project while the merge runs. A comment also waits for the user's card, except in a chat with «total» (as `gh pr comment`
// in the console does); the text published is exactly the text the card showed.
export function createPrTools({ board, sessions, gh, holding = (name, work) => work(), emit = () => {}, log = () => {}, askMs = ASK_MS }) {
  // random start: ids must not repeat after an engine restart, or a stale card could answer another request
  let seq = randomInt(1, 1_000_000);
  const pending = new Map(); // id -> { id, session, project, number, kind, method, body, view, done(text), timer, busy }
  const reserved = new Map(); // session -> slots taken while a request is still being prepared
  const github = async () => (typeof gh === 'function' ? gh() : gh);

  const finish = (r, text) => {
    if (pending.get(r.id) !== r) return;
    pending.delete(r.id); clearTimeout(r.timer);
    emit('pr:done', { id: r.id, session: r.session });
    r.done(text);
  };
  const note = (r, key, vars) => { try { sessions.addItem(r.session, 'system', 'status', tr(key, vars)); } catch { /* the chat went */ } };
  const number = (v) => {
    const n = typeof v === 'string' && /^\d{1,7}$/.test(v) ? Number(v) : v;
    if (!Number.isInteger(n) || n < 1 || n > 10_000_000) throw userError('msg.pr.badNumber');
    return n;
  };
  // The answer must name the very request the card showed: id plus chat, PR number and head commit.
  const must = (ref) => {
    const r = pending.get(Number(ref?.id));
    if (!r || r.busy) throw userError('msg.pr.gone');
    if (String(ref.session) !== r.session || ref.number !== r.number || (r.view.headRefOid != null && ref.headRefOid !== r.view.headRefOid)) throw userError('msg.pr.gone');
    return r;
  };
  // the chat as it is now (its level may have changed while the request waited)
  const countOf = (session) => [...pending.values()].filter((r) => r.session === session).length + (reserved.get(session) ?? 0);
  // a chat deleted while it had requests waiting: they go, and the agent (if still there) is told
  const dropSession = (session) => { for (const r of [...pending.values()]) if (r.session === String(session) && !r.busy) finish(r, tr('msg.pr.locked', { n: r.number })); };
  const alive = () => { for (const r of [...pending.values()]) if (!r.busy && !sessions.get(r.session)) dropSession(r.session); };
  const mayWrite = (sessionId) => { const cur = sessions.get(sessionId); return Boolean(cur) && WRITERS.has(cur.permission); };

  const compact = (p) => ({
    number: p.number, title: p.title, state: p.state, url: p.url, author: p.author, isDraft: p.isDraft,
    headRefName: p.headRefName, headRefOid: p.headRefOid, baseRefName: p.baseRefName, mergeable: p.mergeable, mergeStateStatus: p.mergeStateStatus,
    reviewDecision: p.reviewDecision, additions: p.additions, deletions: p.deletions, changedFiles: p.changedFiles,
    checks: p.checks.slice(0, 30), files: p.files.slice(0, 50).map((f) => f.path), commits: p.commits.slice(0, 20),
    body: String(p.body ?? '').slice(0, BODY_FOR_AGENT)
  });
  const cardOf = (id, s, project, p, method, kind, body) => ({
    id, kind, session: String(s.id), project: project.name, number: p.number, title: p.title, headRefOid: p.headRefOid, headRefName: p.headRefName,
    baseRefName: p.baseRefName, method, body, additions: p.additions, deletions: p.deletions, changedFiles: p.changedFiles,
    checks: p.checks.slice(0, 30), mergeStateStatus: p.mergeStateStatus
  });

  return {
    // The agent's tool; `s` is the chat of its signed grant. → { text } for the agent
    async run(s, tool, args = {}) {
      if (!s) throw userError('msg.pr.noChat');
      const project = s.project ? board.project(String(s.project)) : null;
      if (!project) throw userError('msg.pr.noProject');
      const a = args && typeof args === 'object' ? args : {}; // a project named in the arguments is never read
      const n = number(a.number);
      if (tool !== 'view' && tool !== 'comment' && tool !== 'merge') throw userError('msg.pr.badTool');
      const g = await github();
      if (tool === 'view') {
        const p = await g.viewPr(project, n);
        return { text: `${tr('msg.pr.dataNote')}\n${JSON.stringify(compact(p), null, 1)}` };
      }
      if (!WRITERS.has(s.permission)) throw userError('msg.pr.readOnly');
      let body = null; let method = null;
      if (tool === 'comment') {
        body = typeof a.body === 'string' ? a.body.trim() : '';
        if (!body || body.length > MAX_COMMENT) throw userError('msg.pr.badComment', { max: MAX_COMMENT });
        if (s.permission === 'total') {
          await g.commentPr(project, n, body);
          log(`pr: comentario en #${n} · chat ${s.id}`);
          try { sessions.addItem(String(s.id), 'system', 'status', tr('msg.pr.commented', { n })); } catch { /* the chat went */ }
          return { text: tr('msg.pr.commentDone', { n }) };
        }
      } else {
        method = a.method == null || a.method === '' ? 'merge' : a.method;
        if (!METHODS.includes(method)) throw userError('msg.pr.badMethod');
      }
      // a card for the user: always for a merge, and for a comment below «total»
      const sid = String(s.id);
      if (countOf(sid) >= PER_SESSION) throw userError('msg.pr.tooMany');
      reserved.set(sid, (reserved.get(sid) ?? 0) + 1); // the slot is taken before the await
      let p;
      try { p = await g.viewPr(project, n); } finally { reserved.set(sid, reserved.get(sid) - 1); }
      if (tool === 'merge') {
        if (p.state !== 'OPEN') throw userError('msg.pr.notOpen', { n });
        if (p.isDraft) throw userError('msg.pr.draft', { n });
        if (typeof p.headRefOid !== 'string' || !HEAD_OID_RE.test(p.headRefOid)) throw userError('msg.github.prNeedsHeadOid');
      }
      return new Promise((resolve) => {
        const id = ++seq;
        const r = { id, kind: tool, session: sid, project: project.name, number: n, method, body, view: cardOf(id, s, project, p, method, tool, body), done: (text) => resolve({ text }), timer: null, busy: false };
        r.timer = setTimeout(() => { log(`pr: sin respuesta a #${n} · chat ${r.session}`); finish(r, tr('msg.pr.noAnswer', { n })); }, askMs); r.timer.unref?.();
        pending.set(id, r);
        log(`pr: pedido ${tool} de #${n} · chat ${r.session}`);
        note(r, tool === 'merge' ? 'msg.pr.asked' : 'msg.pr.askedComment', { n });
        emit('pr:request', r.view);
      });
    },
    // The window's list (also after a reload).
    pending: () => { alive(); return [...pending.values()].filter((r) => !r.busy).map((r) => r.view); },
    // The user accepted on the card: merges the commit they saw, not a newer one.
    async answer(ref) {
      alive();
      const r = must(ref);
      if (!mayWrite(r.session)) { finish(r, tr('msg.pr.readOnly')); throw userError('msg.pr.readOnly'); }
      r.busy = true; clearTimeout(r.timer);
      const settle = (text) => { r.busy = false; finish(r, text); };
      try {
        const g = await github();
        const project = board.project(r.project);
        if (!project) throw userError('msg.pr.noProject');
        if (r.kind === 'comment') {
          await g.commentPr(project, r.number, r.body);
          log(`pr: comentario en #${r.number} · chat ${r.session}`);
          note(r, 'msg.pr.commented', { n: r.number });
          settle(tr('msg.pr.commentDone', { n: r.number }));
          return { ok: true, number: r.number, kind: 'comment' };
        }
        const out = await holding(project.name, () => g.mergePr(project, r.number, r.method, r.view.headRefOid));
        log(`pr: fusionado #${r.number} (${r.method}) · chat ${r.session}`);
        note(r, 'msg.pr.merged', { n: r.number });
        settle(tr('msg.pr.mergeDone', { n: r.number, method: r.method }));
        return { ok: true, number: r.number, kind: 'merge', method: r.method, state: out?.state ?? null };
      } catch (error) {
        log(`pr: ${r.kind} de #${r.number} fallido · chat ${r.session}`);
        settle(tr(r.kind === 'comment' ? 'msg.pr.commentFailed' : 'msg.pr.mergeFailed', { n: r.number, detail: oneLine(error.message, 300) }));
        throw error;
      }
    },
    decline(ref) {
      const r = must(ref);
      log(`pr: rechazada fusión de #${r.number} · chat ${r.session}`);
      note(r, 'msg.pr.declinedNote', { n: r.number });
      finish(r, tr('msg.pr.declined', { n: r.number }));
      return true;
    },
    // Orb locked or its password changed: nothing waiting goes on.
    dropSession,
    wipe() { for (const r of [...pending.values()]) { if (!r.busy) finish(r, tr('msg.pr.locked', { n: r.number })); } }
  };
}

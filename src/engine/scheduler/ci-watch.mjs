// «Vigilar la CI del PR»: a chat the user switched on stays with its pull request. Every few minutes (gh pr checks), only
// while the PR is open, a failed check wakes the chat's agent with the end of the log; one attempt per failing commit,
// three in a row at most, and it turns itself off when it is stuck. It NEVER merges (this module has no way to: it only
// reads the PR and writes to the chat) and what the agent then does goes through the guard as in any chat: the message is
// sent with `asked: []`, so a pushed fix in «Auto» still asks the user unless they said so themselves.
// The state lives in the board (settings › ciwatch), so a restart keeps the watches; nothing runs while none is on.
import { tr } from '../../platform/context.mjs';
import { randomBytes } from 'node:crypto';
import { oneLine } from '../../shared/text.mjs';

export const CI_INTERVAL_MS = 3 * 60_000; // 2–5 minutes
export const MAX_ATTEMPTS = 3;
export const STALL_MS = 40 * 60_000; // the same failing commit this long after waking the agent: stuck
export const MAX_ERRORS = 3; // gh failing this many checks in a row: stuck
export const MAX_WATCHES = 5;
const KEY = 'ciwatch';
const WRITERS = new Set(['editar', 'preguntar', 'auto', 'total']);
const userError = (key, vars) => Object.assign(new Error(tr(key, vars)), { userFacing: true });

export function ciMessage({ pr, failed, logs, attempt }) {
  const names = failed.map((c) => `- ${c.workflow ? `${c.workflow} / ` : ''}${c.name}`).join('\n');
  const mark = randomBytes(6).toString('hex'); // the log cannot imitate its own closing line
  const body = logs.filter(Boolean).map((l, i) => `<<${mark}>> ${tr('msg.ciwatch.logOf', { name: failed[i]?.name ?? '' })}
${l}
<</${mark}>>`).join('\n\n');
  return [
    tr('msg.ciwatch.intro', { n: pr.number, title: oneLine(pr.title, 120), branch: pr.headRefName, oid: String(pr.headRefOid ?? '').slice(0, 7), attempt, max: MAX_ATTEMPTS }),
    '', names, body ? `\n${tr('msg.ciwatch.dataNote')}\n${body}` : '', '', tr('msg.ciwatch.outro')
  ].join('\n').slice(0, 19_000);
}

export function createCiWatch({ board, sessions, gh, log = () => {}, emit = () => {}, now = Date.now, intervalMs = CI_INTERVAL_MS }) {
  const github = async () => (typeof gh === 'function' ? gh() : gh);
  const read = () => { const v = board.settingJson(KEY); return Array.isArray(v) ? v : []; };
  const save = (list) => { board.settingJson(KEY, list.length ? list : null); emit('ciwatch:changed', {}); };
  let lastRun = 0; let busy = false;

  const view = (w) => ({ session: w.session, project: w.project, number: w.number, attempts: w.attempts, max: MAX_ATTEMPTS, since: w.since, status: w.status ?? 'watching' });
  const note = (sessionId, key, vars) => { try { sessions.addItem(sessionId, 'system', 'status', tr(key, vars)); } catch { /* the chat went */ } };
  const stop = (w, key, vars) => { save(read().filter((x) => x.session !== w.session)); note(w.session, key, { n: w.number, ...vars }); log(`ci: vigilancia de #${w.number} apagada (${key}) · chat ${w.session}`); };
  const update = (w, patch) => { Object.assign(w, patch); save(read().map((x) => (x.session === w.session && x.since === w.since ? w : x))); };

  async function check(w) {
    const s = sessions.get(w.session);
    const project = s?.project ? board.project(String(s.project)) : null;
    if (!s || !project) return stop(w, 'msg.ciwatch.gone');
    if (!WRITERS.has(s.permission)) return stop(w, 'msg.ciwatch.readOnly');
    const g = await github();
    let pr; let checks;
    try { pr = await g.viewPr(project, w.number); checks = pr.state === 'OPEN' ? await g.prChecks(project, w.number) : []; w.errors = 0; } catch (error) {
      w.errors = (w.errors ?? 0) + 1;
      if (w.errors >= MAX_ERRORS) return stop(w, 'msg.ciwatch.errors', { detail: oneLine(error.message, 200) });
      return save(read().map((x) => (x.session === w.session ? w : x)));
    }
    if (pr.state !== 'OPEN') return stop(w, 'msg.ciwatch.closed');
    if (checks.some((c) => c.bucket === 'pending')) { // let them finish: a half-run is not a verdict, but not for ever
      if (now() - (w.pendingSince ??= now()) > STALL_MS) return stop(w, 'msg.ciwatch.stalled', { minutes: Math.round(STALL_MS / 60_000) });
      return;
    }
    delete w.pendingSince;
    const failed = checks.filter((c) => c.bucket === 'fail');
    if (!failed.length) { if (checks.length && (w.attempts || w.oid)) update(w, { attempts: 0, oid: null, status: 'green' }); return; }
    if (pr.headRefOid && pr.headRefOid === w.oid) { // already woken for this commit: wait for a new one, but not for ever
      if (now() - w.sentAt > STALL_MS) return stop(w, 'msg.ciwatch.stalled', { minutes: Math.round(STALL_MS / 60_000) });
      return;
    }
    if (w.attempts >= MAX_ATTEMPTS) return stop(w, 'msg.ciwatch.tries', { max: MAX_ATTEMPTS });
    if (sessions.isRunning(w.session)) return; // the agent is working: try again at the next round, no attempt is used
    const logs = [];
    for (const c of failed.slice(0, 2)) { try { logs.push(await g.failedLog(project, c.link, 1800)); } catch { logs.push(''); } }
    const still = read().find((x) => x.session === w.session && x.since === w.since);
    if (!still || sessions.isRunning(w.session)) return; // switched off (or the chat got busy) while the logs came
    const attempt = w.attempts + 1;
    sessions.send(s.id, ciMessage({ pr, failed: failed.slice(0, 2), logs, attempt }), { asked: [] });
    update(w, { attempts: attempt, oid: pr.headRefOid ?? `n${now()}`, sentAt: now(), status: 'fixing' });
    log(`ci: aviso ${attempt}/${MAX_ATTEMPTS} de #${w.number} · chat ${w.session}`);
  }

  return {
    list: () => read().map(view),
    // Switch on or off the watch of a chat's pull request. Only the user does this (PC window).
    async set(sessionId, numberArg, on) {
      const id = String(sessionId); const s = sessions.get(id);
      if (!s || s.kind !== 'chat' || !s.project) throw userError('msg.pr.noChat');
      if (!on) { if (read().some((x) => x.session === id)) save(read().filter((x) => x.session !== id)); return { on: false }; }
      const n = Number(numberArg);
      if (!Number.isInteger(n) || n < 1 || n > 10_000_000) throw userError('msg.pr.badNumber');
      if (!WRITERS.has(s.permission)) throw userError('msg.pr.readOnly');
      const project = board.project(String(s.project)); if (!project) throw userError('msg.pr.noProject');
      const pr = await (await github()).viewPr(project, n);
      if (pr.state !== 'OPEN') throw userError('msg.pr.notOpen', { n });
      const list = read().filter((x) => x.session !== id);
      if (list.length >= MAX_WATCHES) throw userError('msg.ciwatch.tooMany', { max: MAX_WATCHES });
      list.push({ session: id, project: project.name, number: n, oid: null, attempts: 0, sentAt: 0, errors: 0, since: now(), status: 'watching' });
      save(list);
      return { on: true };
    },
    // Called every few seconds by the scheduler; does its work at most once per interval and never twice at once.
    async tick() {
      if (busy || !read().length || now() - lastRun < intervalMs) return;
      busy = true; lastRun = now();
      try { for (const w of read()) { try { await check(w); } catch (error) { log(`ci: ${error.message}`); } } } finally { busy = false; }
    },
    check // tests
  };
}

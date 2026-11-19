// Window actions of models, tasks, direct sessions and schedules.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ctx, tr } from '../../platform/context.mjs';
import { AGENT_IDS } from '../../platform/config-file.mjs';
import { accountsOf, accountLabel } from '../../domain/usage/accounts.mjs';
import { slashCommand, modeCommand } from '../../shared/slash.mjs';
import { startGoal, stopGoal, resumeGoal, clearGoal, planTurn, debugMode, goalOf, debugOn } from '../modes.mjs';
import { listSchedules, createSchedule, updateSchedule, removeSchedule, runSchedule, getSchedule, describe as describeSchedule, EVERY } from '../../domain/schedules/schedules.mjs';
import { oneLine } from '../../shared/text.mjs';
import { PERMISSIONS } from '../sessions.mjs';
import { globalAutonomy, permissionOfAutonomy, AUTONOMY } from '../../domain/security/guard.mjs';
import { checkDevTools } from '../../platform/dev-tools.mjs';
import { expandMentions, mentionOptions } from '../mentions.mjs';
import { modelCatalog, REASONING_LEVELS, levelsOf } from '../usage/catalog.mjs';
import { titleFrom } from '../../shared/titles.mjs';
import { autoTitle } from '../titles.mjs';
import { diffBetween, fileBetween, statBetweenAsync } from '../../domain/tasks/checkpoints.mjs';
import { listTurns, turnDiff, commentsBlock } from '../../domain/conversations/turns.mjs';
import { editMessage, undoRewind, rewindInfo } from '../edit-message.mjs';
import { fail, str, int, oneOf, images, DECISION } from './common.mjs';
import { createDedupe, conversationKey } from './dedupe.mjs';
import { joinedByHand, lastLaunchId, runIdentifier, runOfAfter } from '../scheduler/run-id.mjs';
import { cachedBranch, cachedPr, liveBranch } from '../host/pr-cache.mjs';

// Folders compared as the engine writes them: either separator, any case, no trailing separator.
const folderKey = (p) => path.resolve(String(p)).replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase();
const sameFolder = (a, b) => folderKey(a) === folderKey(b);
// true when the folder is outside the assistant's folder: there a phone sees only its last name, so two folders look alike.
function outsideHome(folder) {
  if (!folder || !ctx.home) return false;
  const rel = path.relative(folderKey(ctx.home), folderKey(folder)).replace(/\\/g, '/');
  return rel === '..' || rel.startsWith('../') || path.isAbsolute(rel);
}
// Which run a task has now, so a stale «Deshacer»/«Aceptar» can be refused (run-id.mjs). It changes exactly once per run
// and never when held files are rechecked.
function checkpointIdOf(board, taskId) {
  return runIdentifier(board.settingJson(`checkpoint:${taskId}`)?.before, lastLaunchId(board, taskId));
}
// A phone that sends the checkpointId is refused while the stored end photo still belongs to an earlier run (a task
// re-run in an isolated copy keeps the previous undo point until its work is joined). A point whose run cannot be known
// (an old one) only blocks what touches files: accepting just marks the task, so it passes with { files: false }.
function assertPointCurrent(board, taskId, { files = true } = {}) {
  const cp = board.settingJson(`checkpoint:${taskId}`);
  const run = cp?.after?.run;
  const current = lastLaunchId(board, taskId);
  if (Number.isInteger(run)) { if (run !== current) fail('los cambios de la última ejecución aún no están listos; vuelve a abrirla en un momento'); return; }
  if (!cp?.after || !current || !files) return;
  if (runOfAfter(board, taskId, cp, current) == null) fail('no se puede comprobar a qué ejecución pertenece este punto de vuelta; deshazla desde el PC');
}
export function workMethods({ trash, project, cut, accept, taskRejected, modelLabelOf, grants, board, sessions, scheduler, chatTrees, log }) {
  const runMode = (s, { name, args }) => {
    if (name === 'plan') return planTurn(sessions, s.id, args);
    if (name === 'debug') return debugMode(sessions, s.id, args);
    // a question apart (side.mjs): it answers in the side panel, never in this chat
    if (name === 'side') return { ok: true, side: sessions.side.ask(s.id, args) };
    if (name === 'review') {
      const review = scheduler.reviewChat(s, { actor: 'usuario', focus: str(args, 'foco', 500, { optional: true }) });
      sessions.addItem(s.id, 'system', 'status', tr('msg.modes.reviewStarted', { review: review.id }));
      return { ok: true, review: review.id };
    }
    // goal
    if (/^(parar|stop|detener|cancelar)$/i.test(args)) { stopGoal(sessions, s.id, 'stopped', tr('msg.modes.goalStopped')); if (sessions.isRunning?.(s.id) ?? sessions.running.has(s.id)) sessions.stop(s.id); return { ok: true, goal: goalOf(board, s.id) }; }
    if (/^(continuar|reanudar|resume)$/i.test(args)) return resumeGoal(sessions, s.id);
    if (/^(quitar|borrar|limpiar)$/i.test(args)) return clearGoal(sessions, s.id);
    if (!args) { const g = goalOf(board, s.id); sessions.addItem(s.id, 'system', 'status', g ? tr('msg.modes.goalStatus', { text: g.text, status: tr(`msg.modes.status.${g.status}`), turns: g.turns, max: g.max }) : tr('msg.modes.goalNone')); return { ok: true, goal: g }; }
    return startGoal(sessions, s.id, args);
  };
  const methods = {

    // the list of every view, sent on each refresh: long texts cut (the whole task is tasks.get) and no approval
    // signatures (only the detail needs them).
    // Flutter, the Android SDK and a JDK as they really are on this PC (Ajustes › Android; engine/dev-tools.mjs).
    'devtools.check': () => checkDevTools(),
    'tasks.list': ({ limit }) => {
      // a range of the settings' key (its index), not LIKE (which would read every setting: one per accepted task, …).
      const undone = new Set(board.all("SELECT key FROM settings WHERE key >= 'undone:' AND key < 'undone;' AND value <> '' AND value <> 'null'").map((r) => Number(r.key.slice('undone:'.length))));
      // the tasks whose result the user already accepted (the same index range), so a row can offer «Aceptar resultado» only once.
      const accepted = new Set(board.all("SELECT key FROM settings WHERE key >= 'accepted:' AND key < 'accepted;' AND value = '1'").map((r) => Number(r.key.slice('accepted:'.length))));
      // the rows are new objects: changed in place (copying each task twice would cost more than reading it).
      const paused = board.setting('paused') === '1';
      return board.panelTasks(Math.min(Number(limit) || 150, 500)).map((task) => {
        delete task.approval_hash; delete task.approval_sig;
        // why a queued one waits and what a held one did (src/ui/components/task-state.jsx).
        const waiting = board.waitReason(task, paused); if (waiting) task.waiting = waiting;
        const held = board.heldInfo(task); if (held) task.held = held;
        task.description = cut(task.description); task.result = cut(task.result);
        if (undone.has(task.id)) task.undone = true;
        if (accepted.has(task.id)) task.accepted = true;
        return task;
      });
    },
    'tasks.live': () => scheduler.live(),
    'tasks.get': ({ id }) => {
      const d = board.taskDetail(int(id, 'tarea'));
      const children = board.all('SELECT id, title, status, agent, assigned_to, model FROM tasks WHERE parent_id = ? OR review_of = ? ORDER BY id', d.id, d.id);
      // «Deshecha» (undone: the files are as before the task), the model by its name («Haiku 4.5», not «haiku») and the
      // account that ran it by the name the user gave it («Codex Pro»).
      // folderNow: the folder previewHash covers; it differs from project_path when the project moved after the task was created.
      const who = d.assigned_to ?? d.agent; const acc = d.run_account ?? d.account ?? null;
      const now = board.projectPathNow(d) ?? null;
      const folderMoved = Boolean(now) && Boolean(d.project_path) && sameFolder(now, d.project_path) === false;
      return { ...d, folderMoved, folderOutside: outsideHome(now), checkpointId: checkpointIdOf(board, d.id), waiting: board.waitReason(d), held: board.heldInfo(d), accepted: board.isAccepted(d.id), previewHash: board.previewHash(d), folderNow: board.projectPathNow(d) ?? null, approval: board.approvalInfo(d), hasCheckpoint: Boolean(board.settingJson(`checkpoint:${d.id}`)?.before), review: board.settingJson(`review:${d.id}`), children,
        undone: board.settingJson(`undone:${d.id}`), modelLabel: d.model ? modelLabelOf(who, acc ?? who, d.model) : null, accountLabel: acc && accountsOf(who).length > 1 ? accountLabel(acc) : null };
    },
    'tasks.create': (p) => board.createTask({
      project: project(p.project).name, title: str(p.title, 'título', 200), description: str(p.description, 'descripción', 12000),
      agent: oneOf(p.agent, [...AGENT_IDS, 'any'], 'agente', 'any'), model: str(p.model, 'modelo', 80, { optional: true }) || null,
      reasoning: oneOf(p.reasoning, ['low', 'medium', 'high'], 'razonamiento', 'medium'), mode: oneOf(p.mode, ['carpeta', 'aislada'], 'modo', 'carpeta'),
      readonly: Boolean(p.readonly), account: str(p.account, 'cuenta', 40, { optional: true }) || null, level: oneOf(p.level, ['simple', 'normal', 'complejo'], 'nivel', null), depends_on: Array.isArray(p.depends_on) ? p.depends_on.map((d) => int(d, 'dependencia')) : [],
      origin_session: p.origin_session == null ? null : str(p.origin_session, 'sesión', 64)
    }, 'usuario'),
    'tasks.approve': ({ id, decision, hash }) => {
      const out = board.approve(int(id, 'tarea'), decision === 'approved' ? 'approved' : 'rejected', 'usuario', str(hash, 'huella', 100));
      if (out?.status === 'cancelled') { try { taskRejected(out); } catch (error) { log?.(`rechazo #${out.id}: ${error.message}`); } }
      return out;
    },
    'tasks.retry': ({ id }) => board.retry(int(id, 'tarea'), 'usuario'),
    'tasks.cancel': ({ id }) => scheduler.cancel(int(id, 'tarea'), 'usuario'),
    'tasks.reassign': ({ id, agent, model, reasoning }) => board.reassign(int(id, 'tarea'), { agent: oneOf(agent, [...AGENT_IDS, 'any'], 'agente'), model: str(model, 'modelo', 80, { optional: true }) || null, reasoning: oneOf(reasoning, ['low', 'medium', 'high'], 'razonamiento') }, 'usuario'),
    'tasks.followup': ({ id, text, images: files }) => scheduler.followup(int(id, 'tarea'), str(text, 'mensaje', 20000), images(files)),
    // checkpoint (optional): the checkpointId tasks.get showed. If the task ran again meanwhile it no longer matches and nothing is undone.
    'tasks.undo': ({ id, checkpoint }) => {
      const tid = int(id, 'tarea');
      if (checkpoint != null && checkpoint !== checkpointIdOf(board, tid)) fail('la tarea se ha vuelto a ejecutar desde que abriste «Deshacer»; ábrela de nuevo para revisarla');
      if (checkpoint != null && joinedByHand(board, tid)) fail('esta tarea se unió a mano en el PC; deshazla desde el PC');
      if (checkpoint != null) assertPointCurrent(board, tid);
      return scheduler.undo(tid);
    },
    // what a finished task changed, with each file's diff (read only, against its undo checkpoint: «Deshacer» works
    // the same). Nothing to show while it runs, after it was undone, or without git (a copy checkpoint).
    // stat: true → only the line counts per file, no patch, and nothing else is done (read only, no recheck of held files).
    // file: one file of that diff whole, before and after (checkpoints.mjs › fileBetween), asked when it is opened in that view.
    'tasks.diff': async ({ id, stat, file }, principal) => {
      // a whole file is read only by the PC's window (the phone of 3.8.7 never asks for it)
      if (file != null && principal && principal.channel !== 'desktop') fail(tr('msg.remote.pcOnly'));
      const task = board.task(int(id, 'tarea')) ?? fail(tr('msg.api.noTaskThat'));
      // a held task's diff is read from every file again (safety.mjs › recheckHeld): what accepting it keeps. A whole-file
      // view is read only and was already rechecked when the tab opened, so it does not repeat it.
      if (stat !== true && file == null && board.heldInfo(task)) await scheduler.recheckHeld(task);
      const cp = board.settingJson(`checkpoint:${task.id}`);
      // the reasons only a phone is told (the PC's window keeps what it always got): the stored diff no longer describes the
      // folder (joined by hand), or a finished task whose end photo failed (the undo still works from the point before)
      const phone = Boolean(principal) && principal.channel !== 'desktop';
      if (phone && cp?.before && joinedByHand(board, task.id)) return { available: false, reason: 'joinedbyhand', files: [], more: 0 };
      // the checkpointId of the run this diff belongs to (null when that cannot be known): the phone compares it with tasks.get's
      const diffId = () => {
        const current = lastLaunchId(board, task.id);
        const run = runOfAfter(board, task.id, cp, current);
        return run == null ? null : runIdentifier(cp?.before, run);
      };
      // reason (why there is no diff): nophoto (no checkpoint), nogit (a copy checkpoint, no git), notdone (no photo after
      // the work yet), nophotoafter (phone only: finished without one), joinedbyhand (phone only), gone (the repository is not there any more).
      if (cp?.before?.kind !== 'git' || !cp.after?.commit || !cp.before.repo || !fs.existsSync(cp.before.repo)) {
        const finished = !['queued', 'awaiting_approval', 'waiting', 'running'].includes(task.status);
        const reason = !cp?.before ? 'nophoto' : cp.before.kind !== 'git' ? 'nogit' : !cp.after?.commit ? (phone && finished && !cp.after ? 'nophotoafter' : 'notdone') : 'gone';
        return { available: false, reason, files: [], more: 0 };
      }
      if (typeof file === 'string') return { available: true, ...fileBetween(cp.before.repo, cp.before.commit, cp.after.commit, file), checkpointId: diffId() };
      if (stat === true) return { available: true, ...(await statBetweenAsync(cp.before.repo, cp.before.commit, cp.after.commit)), checkpointId: diffId() };
      return { available: true, ...diffBetween(cp.before.repo, cp.before.commit, cp.after.commit), checkpointId: diffId() };
    },
    // «Iniciar de todos modos» starts that task now, over the usage limit and also with the queue paused (only that
    // one: scheduler.tick). One that waits for other tasks cannot: the answer says which. → { paused }
    'tasks.launchAnyway': ({ id }) => {
      const t = board.task(int(id, 'tarea')); if (t?.status !== 'queued') fail(tr('msg.api.onlyQueued'));
      const why = board.waitReason(t);
      if (why?.kind === 'deps') fail(tr('msg.api.waitsForDeps', { ids: why.on.map((d) => `#${d.id}`).join(', ') }));
      board.setting(`budget_ok:${t.id}`, '1'); board.event(t.id, 'usuario', 'budget.authorised', 'lanzar ahora (aunque supere el límite de uso o la cola esté en pausa)');
      board.changed('tasks');
      return { paused: why?.kind === 'paused' || why?.kind === 'manual' };
    },
    // a task held for review is accepted as it is (its result stays; the tasks waiting for it go on), as the OK
    // to its report does.
    // unheld: true (the phone, which may hold stale data) refuses a task the guard holds or that is no longer awaiting
    // acceptance, so a re-run that Orb held meanwhile is never accepted blind. Without it the PC's window accepts after showing the diff.
    // checkpoint (optional): the checkpointId the phone saw; if the task ran again since, nothing is accepted.
    'tasks.accept': ({ id, unheld, checkpoint }) => {
      const tid = int(id, 'tarea');
      if (checkpoint != null && checkpoint !== checkpointIdOf(board, tid)) fail('la tarea se ha vuelto a ejecutar desde que la viste; ábrela de nuevo para revisarla');
      if (checkpoint != null && !joinedByHand(board, tid)) assertPointCurrent(board, tid, { files: false });
      if (unheld === true) {
        const t = board.task(tid) ?? fail(tr('msg.api.noTaskThat'));
        if (board.heldInfo(t)) fail('la tarea está retenida por la guardia; revisa sus cambios en el PC antes de aceptarla');
        if (t.status !== 'done') fail('la tarea ya no se puede aceptar: su estado ha cambiado; ábrela de nuevo');
      }
      if (board.heldInfo(board.task(tid))) board.patch(tid, { status: 'done' }, 'usuario', 'task.review_accepted');
      return accept([tid]);
    },
    'tasks.discardBranch': ({ id }) => scheduler.discardBranch(int(id, 'tarea')),

    // «/goal», «/plan», «/review» and «/debug» (modes.mjs): none of them changes the chat's permission.
    'sessions.modes': ({ id }) => { const sid = str(id, 'conversación', 64); sessions.must(sid); return { goal: goalOf(board, sid), debug: debugOn(board, sid) }; },
    'sessions.goal': ({ id, action, text }) => {
      const s = sessions.must(str(id, 'conversación', 64)); trash.assertSessionNotTrashed(s);
      const act = oneOf(action, ['start', 'stop', 'resume', 'clear'], 'acción');
      return runMode(s, { name: 'goal', args: act === 'start' ? str(text, 'objetivo', 1500) : { stop: 'parar', resume: 'continuar', clear: 'quitar' }[act] });
    },
    // `branch` and `prNumber` are optional and only read from what the engine already holds (the chats' worktree records, and
    // the branch and open PRs that projects.info / projects.prs last read): this list never runs git or gh.
    'sessions.list': ({ archived }) => {
      // HEAD read first (cheap, 5 s per folder); the older read of projects.info only when HEAD could not be read.
      const currentBranch = (dir) => { const live = liveBranch(dir); return live === undefined ? cachedBranch(dir) : live; };
      const list = sessions.list({ archived: Boolean(archived) });
      let trees = null;
      // `activity`: the short line of what a running chat does now (file names only); absent when it is not working and for «Acceso total» chats, which the phone may not read.
      const withLine = (s) => { const activity = s.kind === 'chat' && s.permission !== 'total' ? sessions.liveLine?.(s.id) : null; return activity ? { ...s, activity } : s; };
      return list.map((s0) => {
        const s = withLine(s0);
        if (s.kind !== 'chat' || !s.project) return s;
        trees ??= new Map(chatTrees.all().filter((r) => !r.removed).map((r) => [r.id, r]));
        const tree = trees.get(s.id);
        // the project's branch is today's: a settled or archived chat did not work on it
        const branch = tree?.branch || (s.archived || s.settled ? null : currentBranch(s.cwd));
        if (!branch) return s;
        const pr = cachedPr(tree?.repo || s.cwd, branch);
        return { ...s, branch, ...(pr ? { prNumber: pr } : {}) };
      });
    },
    'sessions.create': (p) => {
      const proj = p.project ? project(p.project) : null;
      const cwd = proj ? proj.path : ctx.paths.projects;
      // Without a project the agent sits in the assistant's own folder (its database, secret and logs): it may only look.
      if (!proj && p.permission && p.permission !== 'leer') fail(tr('msg.api.readOnlyNoProject'));
      // «Acceso total» only through sessions.grantTotal (the master password), never at creation.
      if (p.permission === 'total') fail(tr('msg.grants.totalNeedsPassword'));
      // «Local» (the project's folder) or «Worktree» (its own git worktree and branch, made below); it changes where the chat works, never what it may do.
      const where = oneOf(p.workspace, ['local', 'worktree'], 'espacio', 'local');
      if (where === 'worktree' && !proj) fail(tr('msg.chatWt.needsProject'));
      const created = sessions.create({ kind: 'chat', agent: oneOf(p.agent, AGENT_IDS, 'agente'), account: str(p.account, 'cuenta', 40, { optional: true }) || null, model: str(p.model, 'modelo', 80, { optional: true }) || null,
        reasoning: oneOf(p.reasoning, REASONING_LEVELS, 'razonamiento', 'medium'), permission: proj ? oneOf(p.permission, PERMISSIONS.filter((x) => x !== 'total'), 'permiso', permissionOfAutonomy(globalAutonomy())) : 'leer',
        project: proj?.name ?? null, cwd, title: str(p.title, 'título', 80, { optional: true }) || tr('msg.api.chatWith', { agent: p.agent }) });
      if (where === 'worktree') {
        try { const made = chatTrees.create({ id: created.id, project: proj, base: str(p.base, 'rama', 200, { optional: true }) || undefined }); sessions.update(created.id, { cwd: made.cwd }); } catch (error) { sessions.remove(created.id); throw error; }
      }
      // a title given here stays; without one, Orb names it from its first message.
      return p.title ? sessions.update(created.id, { titled: true }) : sessions.get(created.id);
    },
    'sessions.items': ({ id, after, before, limit }) => sessions.items(str(id, 'conversación', 64), { after: Number(after) || 0, before: Number(before) || 0, limit: Number(limit) || 200 }),
    // A message to a conversation: a new turn, or (while it works) steer the running turn or wait in its queue.
    // mode: 'auto' (steer when the agent can, else queue), 'steer' or 'queue'.
    'sessions.send': ({ id, text, images: files, mode, comments }, principal) => {
      if (chatTrees.busy.has(String(id))) fail(tr('msg.chatWt.removing'));
      const s = sessions.must(str(id, 'conversación', 64));
      trash.assertSessionNotTrashed(s);
      if (s.kind === 'task') {
        // A running task: the message reaches its agent at once when it can (steer); otherwise after its turn.
        if (sessions.isRunning(s.id) && oneOf(mode, ['auto', 'steer', 'queue'], 'modo', 'auto') !== 'queue' && !(files ?? []).length) {
          const out = sessions.message(s.id, str(text, 'mensaje', 20000), { mode: 'steer' });
          if (out.steered) return out;
        }
        scheduler.followup(s.task_id, str(text, 'mensaje', 20000), images(files));
        return { queued: true };
      }
      // comments written on diff lines go with this message as one block (turns.mjs › commentsBlock)
      const t = str(text, 'mensaje', 20000); const block = commentsBlock(comments);
      const modeCmd = s.kind === 'chat' && !(files ?? []).length ? modeCommand(t) : null;
      // the answer of «/side» is drawn in the PC's side panel only; from a phone it would spend plan and show nothing
      if (modeCmd?.name === 'side' && principal?.device) fail(tr('msg.remote.pcOnly'));
      if (modeCmd) return runMode(s, modeCmd);
      const command = s.kind === 'chat' && !(files ?? []).length ? slashCommand(t) : null;
      if (command) return command === 'compact' ? sessions.compact(s.id) : sessions.clear(s.id);
      // a new direct conversation is named by Orb from its first message (at once a quick title, then a better one).
      if (s.kind === 'chat' && !s.titled) {
        const quick = titleFrom(t) || s.title;
        sessions.update(s.id, { title: quick, titled: true });
        autoTitle(board, { agent: s.agent, account: s.account, text: t }).then((better) => { if (better && sessions.get(s.id)?.title === quick) sessions.update(s.id, { title: better }); }).catch(() => {});
      }
      // the block goes as context, not as typed text: what the user's words ask for (security/approval.mjs › askedByUser) is read from `t` alone,
      // since the paths in the comments come from file names an agent may have chosen.
      return sessions.message(s.id, t, { images: images(files), mode: oneOf(mode, ['auto', 'steer', 'queue'], 'modo', 'auto'), context: `${expandMentions(board, sessions, t) ?? ''}${block ? `

${block}` : ''}` });
    },
    // «Cambios» of a direct chat, turn by turn (turns.mjs): read only, from Orb's light photos of the folder.
    'sessions.turns': async ({ id }) => { const s = sessions.must(str(id, 'conversación', 64)); return s.kind === 'chat' && s.project ? listTurns(s.cwd, s.id) : { available: false, turns: [] }; },
    'sessions.turnDiff': async ({ id, scope, n, stat }) => { const s = sessions.must(str(id, 'conversación', 64)); return s.kind === 'chat' && s.project ? turnDiff(s.cwd, s.id, { scope: oneOf(scope, ['last', 'all', 'turn', 'head'], 'ámbito', 'last'), n, stat: stat === true }) : { available: false, files: [], more: 0 }; },
    'sessions.queue': ({ id }) => sessions.queue(str(id, 'conversación', 64)),
    'sessions.editQueued': ({ id, queueId, text, remove, move }) => sessions.editQueued(str(id, 'conversación', 64), int(queueId, 'mensaje'), { text: text === undefined ? undefined : str(text, 'mensaje', 20000), remove: Boolean(remove), move: oneOf(move, ['up', 'down'], 'mover', undefined) }),
    'sessions.approve': ({ id, request, decision }) => sessions.respond(str(id, 'conversación', 64), str(request, 'petición', 200), oneOf(decision, DECISION, 'decisión')),
    'sessions.resume': ({ id }) => { trash.assertSessionNotTrashed(sessions.must(str(id, 'conversación', 64))); return sessions.resume(str(id, 'conversación', 64)); },
    // agent: go on with another agent (the copy gets a summary of the conversation; the original stays).
    // from: a message of the chat; the copy is cut there (conversation only, never the files).
    'sessions.fork': ({ id, title, agent, from }) => {
      const other = oneOf(agent, AGENT_IDS, 'agente', undefined);
      if (other && !(board.availableAgents() ?? AGENT_IDS).includes(other)) fail(tr('msg.api.agentUnavailable', { agent: other }));
      return sessions.fork(str(id, 'conversación', 64), { title: str(title, 'título', 80, { optional: true }) || undefined, agent: other, from: from === undefined || from === null ? undefined : int(from, 'mensaje') });
    },
    // the same chat goes on with another agent (a bounded summary travels; the chat's permission is kept, never raised).
    'sessions.handoff': ({ id, agent }) => {
      const other = oneOf(agent, AGENT_IDS, 'agente');
      if (!(board.availableAgents() ?? AGENT_IDS).includes(other)) fail(tr('msg.api.agentUnavailable', { agent: other }));
      const s = sessions.must(str(id, 'conversación', 64)); trash.assertSessionNotTrashed(s);
      return sessions.handoff(s.id, { agent: other });
    },
    // «Editar» a message of a chat: the conversation goes on from it; editRewind also puts the project's files back (only from the PC).
    'sessions.edit': ({ id, item, text }) => { const s = sessions.must(str(id, 'conversación', 64)); trash.assertSessionNotTrashed(s); return editMessage(sessions, s.id, int(item, 'mensaje'), str(text, 'mensaje', 20000)); },
    'sessions.editRewind': ({ id, item, text }) => { const s = sessions.must(str(id, 'conversación', 64)); trash.assertSessionNotTrashed(s); return editMessage(sessions, s.id, int(item, 'mensaje'), str(text, 'mensaje', 20000), { rewind: true }); },
    'sessions.rewindUndo': ({ id, item }) => { const s = sessions.must(str(id, 'conversación', 64)); trash.assertSessionNotTrashed(s); return undoRewind(sessions, s.id, int(item, 'mensaje')); },
    'sessions.rewindInfo': ({ id, item }) => rewindInfo(sessions, sessions.must(str(id, 'conversación', 64)).id, int(item, 'mensaje')),
    'sessions.settle': ({ id, settled }) => sessions.update(sessions.must(str(id, 'conversación', 64)).id, { settled: settled !== false }),
    'approvals.list': () => sessions.allPendingApprovals(),
    'mentions.options': () => mentionOptions(board, sessions),
    'schedules.list': () => listSchedules(board).map((s) => ({ ...s, when: describeSchedule({ ...s, hours: s.at_time }) })),
    // only this PC's window may loosen the permission level of a schedule (src/domain/schedules/schedules.mjs, clampAutonomy)
    'schedules.create': (p, principal) => createSchedule(board, { project: project(p.project).name, title: str(p.title, 'título', 120), description: str(p.description, 'descripción', 8000), agent: oneOf(p.agent, [...AGENT_IDS, 'any'], 'agente', 'any'), model: str(p.model, 'modelo', 80, { optional: true }) || null,
      readonly: Boolean(p.readonly), every: oneOf(p.every, EVERY, 'frecuencia'), at_time: str(p.at_time, 'hora', 16, { optional: true }) || '09:00', weekdays: Array.isArray(p.weekdays) ? p.weekdays.map(Number) : [], hours: Number(p.hours) || 6, same_chat: p.same_chat === true,
      month_day: p.month_day == null ? undefined : Number(p.month_day), tz: str(p.tz, 'zona horaria', 64, { optional: true }) || null, autonomy: oneOf(p.autonomy, AUTONOMY, 'permiso', undefined), notify_mobile: p.notify_mobile !== false }, 'usuario', { desktop: principal?.channel === 'desktop' }),
    // every field create takes may change, checked the same way; absent = unchanged
    'schedules.update': (p, principal) => updateSchedule(board, int(p.id, 'programada'), {
      enabled: p.enabled, approved: p.approve === true, title: p.title, description: p.description,
      ...(p.project != null ? { project: project(p.project).name } : {}), ...(p.agent != null ? { agent: oneOf(p.agent, [...AGENT_IDS, 'any'], 'agente') } : {}), ...(p.model !== undefined ? { model: str(p.model, 'modelo', 80, { optional: true }) || null } : {}),
      ...(p.readonly !== undefined ? { readonly: p.readonly === true } : {}), ...(p.every != null ? { every: oneOf(p.every, EVERY, 'frecuencia') } : {}), ...(p.at_time != null ? { at_time: str(p.at_time, 'hora', 16) } : {}),
      ...(p.hours != null ? { hours: Number(p.hours) || 6 } : {}), ...(Array.isArray(p.weekdays) ? { weekdays: p.weekdays.map(Number) } : {}), ...(p.month_day != null ? { month_day: Number(p.month_day) } : {}),
      ...(p.tz !== undefined ? { tz: str(p.tz, 'zona horaria', 64, { optional: true }) || null } : {}), ...(p.same_chat !== undefined ? { same_chat: p.same_chat === true } : {}), ...(p.notify_mobile !== undefined ? { notify_mobile: p.notify_mobile === true } : {}),
      ...(p.autonomy !== undefined ? { autonomy: oneOf(p.autonomy, AUTONOMY, 'permiso', null) } : {})
    }, { desktop: principal?.channel === 'desktop' }),
    'schedules.remove': ({ id }) => removeSchedule(board, int(id, 'programada')),
    'schedules.run': ({ id }) => runSchedule(board, getSchedule(board, int(id, 'programada')) ?? fail(tr('msg.api.noScheduled')), 'usuario'),
    'tasks.review': ({ id, agent, focus }) => scheduler.createReview(board.task(int(id, 'tarea')) ?? fail(tr('msg.api.noTaskThat')), { actor: 'usuario', agent: oneOf(agent, AGENT_IDS, 'agente', null), focus: str(focus, 'foco', 500, { optional: true }) }),
    'projects.review': ({ name, agent, focus }) => scheduler.reviewProject(project(name).name, { actor: 'usuario', agent: oneOf(agent, AGENT_IDS, 'agente', null), focus: str(focus, 'foco', 500, { optional: true }) }),
    'projects.securityReview': ({ name, agent }) => scheduler.securityReview(project(name).name, { actor: 'usuario', agent: oneOf(agent, AGENT_IDS, 'agente', null) }),
    // «Compactar» in a direct conversation: the agent's own compaction (Claude /compact, Codex thread/compact/start).
    'sessions.compact': ({ id }) => sessions.compact(sessions.must(str(id, 'conversación', 64)).id),
    // one subagent of the running turn: «stop» or «background» (sessions.subagent says when the agent cannot)
    'sessions.subagent': ({ id, tool, action }) => sessions.subagent(str(id, 'conversación', 64), str(tool, 'subagente', 200), oneOf(action, ['stop', 'background'], 'acción')),
    // «/side» chats of a conversation: ask (a new one, or the next question of `side`), list, close
    'sessions.sideAsk': ({ id, text, side }) => sessions.side.ask(str(id, 'conversación', 64), str(text, 'pregunta', 4000), side === undefined || side === null ? null : str(side, 'lateral', 64)),
    // the user began to type: the proposed next message is no longer wanted (suggest.mjs)
    'sessions.suggestCancel': ({ id }) => ({ ok: sessions.suggest.cancel(str(id, 'conversación', 64)) }),
    'sessions.sides': ({ id }) => sessions.side.list(str(id, 'conversación', 64)),
    'sessions.sideClose': ({ side }) => sessions.side.close(str(side, 'lateral', 64)),
    'sessions.stop': ({ id }) => { const s = sessions.must(str(id, 'conversación', 64)); if (s.kind === 'task') return scheduler.cancel(s.task_id, 'usuario'); return sessions.stop(s.id); },
    'sessions.update': async ({ id, title, model, reasoning, permission, archived }) => {
      const s = sessions.must(str(id, 'conversación', 64));
      // a chat taken out of the archive gets back the worktree that was removed when it was archived
      // (if it cannot be brought back the chat still comes out, and the user is told)
      if (archived === false && s.archived) { try { await chatTrees.ensure(s.id); } catch (error) { board.notice(tr('msg.chatWt.restoreFailed', { title: s.title, error: error.message }), 'warning'); } }
      if (s.kind === 'task' && (model !== undefined || permission !== undefined || reasoning !== undefined)) fail(tr('msg.api.taskModelFromTask'));
      const fields = {};
      if (title !== undefined) fields.title = oneLine(str(title, 'título', 80), 80);
      if (model !== undefined) fields.model = str(model, 'modelo', 80, { optional: true }) || null;
      if (reasoning !== undefined) fields.reasoning = oneOf(reasoning, REASONING_LEVELS, 'razonamiento');
      // «Extra» only with a model that takes it (the conversation's, or the one chosen now).
      if ((fields.reasoning ?? s.reasoning) === 'xhigh' && (reasoning !== undefined || model !== undefined) && !levelsOf(modelCatalog(board), s.agent, fields.model !== undefined ? fields.model : s.model, s.account).includes('xhigh')) {
        if (reasoning === 'xhigh') fail(tr('msg.api.reasoningUnavailable'));
        fields.reasoning = 'high';
      }
      // into or out of «total» only through grants.mjs (password, audit log, lock).
      if (permission !== undefined && (permission === 'total' || s.permission === 'total') && permission !== s.permission) fail(tr('msg.grants.totalNeedsPassword'));
      if (permission !== undefined) { fields.permission = oneOf(permission, PERMISSIONS, 'permiso'); if (!s.project && fields.permission !== 'leer') fail(tr('msg.api.readOnlyNoProject2')); }
      if (archived !== undefined) fields.archived = Boolean(archived);
      return sessions.update(s.id, fields);
    },
    'sessions.remove': ({ id }) => sessions.remove(str(id, 'conversación', 64)),
    // the worktrees of direct chats (src/engine/chat-worktrees.mjs)
    'worktrees.branches': ({ project: name }) => chatTrees.branches(project(name).path),
    'worktrees.status': ({ id }) => chatTrees.status(str(id, 'conversación', 64)),
    // Every record, with what is left of its chat: Settings lists the copies of chats that are gone or archived.
    'worktrees.list': () => chatTrees.all().map((r) => { const s = sessions.get(r.id); return { ...r, gone: !fs.existsSync(r.path), chat: s ? { title: s.title, archived: Boolean(s.archived) } : null }; }),
    // Never loses work unasked: a folder with changes not committed stays unless force (the user confirmed it).
    'worktrees.discard': async ({ id, force, branch, fingerprint }) => {
      const sid = str(id, 'conversación', 64);
      const r = await chatTrees.release(sid, { force: force === true, branch: oneOf(branch, ['auto', 'keep', 'delete'], 'rama', 'auto'), fingerprint: typeof fingerprint === 'string' ? fingerprint.slice(0, 80) : null });
      if (r.none) fail(tr('msg.chatWt.none'));
      if (r.removed) board.changed('sessions');
      return r;
    },
  };
  // clientId: a retry of the same message gets the first result instead of a second message.
  const sent = createDedupe();
  const send = methods['sessions.send'];
  methods['sessions.send'] = (params, principal) => (params == null ? send(params, principal) : sent.once(`session:${principal?.device ?? 'desktop'}:${conversationKey(params.id)}`, params.clientId, () => send(params, principal)));
  return methods;
}

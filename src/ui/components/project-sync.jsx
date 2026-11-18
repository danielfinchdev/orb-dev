// What the project page does that publishes or writes by hand, each only from a click and a dialog that says what will
// happen: «Sincronizar» (bring in and send, fast-forward only) and «Escribir entrada» (a line of the logbook in the user's
// own name). Neither runs by itself; the engine repeats every check (src/engine/host/github.mjs › syncRun, journal.mjs ›
// writeHandEntry).
import { Field, Input, Textarea } from '@/components/ui/basic.jsx';
import { choose, confirm, form } from '@/components/dialogs.jsx';
import { pushFlow } from '@/components/project-flows.jsx';
import { call, act } from '@/lib/store.js';
import { notifyOk, notifyWarn } from '@/lib/notify.js';
import { plural } from '@/lib/project-status.js';
import { forgetInfo } from '@/lib/use-project-info.js';

// «Traer N commits de origin/rama y subir M»: only what there is to do. Never offered when it would diverge or overwrite.
export const syncSummary = (t, plan) => {
  const parts = [];
  if (plan.behind) parts.push(plural(t, 'projects.sync.pull', plan.behind, { upstream: plan.upstream }));
  if (plan.ahead) parts.push(plural(t, 'projects.sync.push', plan.ahead));
  const text = parts.join(t('projects.sync.and'));
  return text ? `${text[0].toUpperCase()}${text.slice(1)}.` : '';
};

export async function syncFlow(p, t, reload) {
  const plan = await act(call('projects.syncPlan', { name: p.name }));
  if (!plan) return;
  const { upstream, branch } = plan;
  if (plan.busy) { notifyWarn(t('projects.sync.busy')); return; }
  if (plan.state === 'upToDate') { notifyOk(t('projects.sync.upToDate', { upstream })); return; }
  if (plan.state === 'diverged') { notifyWarn(t('projects.sync.diverged', { upstream })); return; }
  if (plan.state === 'unsaved') { notifyWarn(t('projects.sync.unsaved')); return; }
  if (plan.state === 'noRemote') { notifyWarn(t('projects.sync.noRemote')); return; }
  if (plan.state === 'noRemoteBranch') {
    // nothing to bring in: the way to publish a branch is the push that already exists, with its own confirmation
    const pick = await choose(t('projects.sync.title'), t('projects.sync.noBranch', { branch }), [{ value: 'push', label: t('projects.pushBtn') }], { testid: 'project-sync-dialog' });
    if (pick === 'push') await pushFlow(p, { branch, remote: 'origin' }, t, reload);
    return;
  }
  // Bringing in and sending never go together (a branch that needs both has diverged and is refused above). Sending
  // publishes: it names the destination and uses the danger style of «Subir rama».
  if (plan.ahead) {
    if (!(await confirm(t('projects.sync.title'), `${syncSummary(t, plan)}\n\n${t('projects.sync.pushNote', { upstream })}`, { ok: t('projects.sync.ok'), danger: true }))) return;
  } else {
    const pick = await choose(t('projects.sync.title'), `${syncSummary(t, plan)}\n\n${t('projects.sync.note')}`, [{ value: 'sync', label: t('projects.sync.ok') }], { testid: 'project-sync-dialog' });
    if (pick !== 'sync') return;
  }
  // the numbers the user read go with the call: if the remote moved meanwhile the engine refuses and touches nothing
  const out = await act(call('projects.sync', { name: p.name, behind: plan.behind, ahead: plan.ahead }));
  if (!out) return;
  forgetInfo(p.name);
  if (out.pushError) notifyWarn(t('projects.sync.pushFailed', { upstream, detail: out.pushError })); else notifyOk(t('projects.sync.done'));
  reload?.();
}

// «Escribir entrada»: title and text; the engine signs it with the user's name and only ever adds it at the end.
export async function writeEntryFlow(p, t, onDone) {
  const r = await form(t('projects.log.write'), { description: t('projects.log.writeDesc'), initial: { title: '', body: '' }, wide: true,
    body: (v, set) => (<>
      <Field label={t('projects.log.writeTitle')}><Input autoFocus value={v.title} onChange={(e) => set({ title: e.target.value })} maxLength={120} data-testid="project-log-entry-title" /></Field>
      <Field label={t('projects.log.writeBody')}><Textarea value={v.body} onChange={(e) => set({ body: e.target.value })} rows={6} maxLength={5000} data-testid="project-log-entry-body" /></Field>
    </>),
    okDisabled: (v) => !v.title.trim() || !v.body.trim(), ok: t('projects.log.write'),
    onOk: (v) => call('logs.addEntry', { project: p.name, title: v.title.trim(), body: v.body }) });
  if (r) { notifyOk(t('projects.log.written')); onDone?.(); }
}

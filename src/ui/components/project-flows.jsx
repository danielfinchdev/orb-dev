// What can be done with a whole project, as flows (dialog, call, notice): shared by the PC's list and page and by the
// phone's and the browser's detail card, so a confirmation or a call never differs between them.
import { Field, Input } from '@/components/ui/basic.jsx';
import { Checkbox } from '@/components/ui/overlay.jsx';
import { confirm, choose, form } from '@/components/dialogs.jsx';
import { notifyError, notifyOk } from '@/lib/notify.js';
import { call, act, go, bridge, setState } from '@/lib/store.js';
import { unlockCore } from '@/lib/core-access.js';
import { quiet } from '@/lib/quiet.js';

// the end of a project (src/domain/projects/project-close.mjs). Finished: it leaves Orb, its folder stays («Finalizados»
// brings it back). Deleted: its folder goes to the Recycle Bin (the app), behind the master password, only on the PC.
// When the Recycle Bin cannot take it: a folder some program is using offers only «Reintentar»; otherwise «Reintentar»
// or «Borrar para siempre» after a stronger warning. Cancelling gives the project back as it was.
export async function finishFlow(p, t) {
  if (!(await confirm(t('projects.finish.title'), t('projects.finish.body', { name: p.name }), { ok: t('projects.finish.ok'), danger: true }))) return false;
  if ((await act(call('projects.finish', { name: p.name }), t('projects.finish.done'))) !== undefined) { await refresh().catch(quiet); return true; }
  return false;
}
export async function deleteProjectFlow(p, t) {
  if (!(await confirm(t('projects.delete.title'), t('projects.delete.body', { name: p.name, path: p.path }), { ok: t('projects.delete.ok'), danger: true }))) return false;
  const unlock = await unlockCore('deleteProject');
  if (!unlock) return false;
  try {
    let r = await bridge.deleteProject(p.name, unlock);
    while (r && !r.ok) {
      let step = null;
      if (r.locked) step = await choose(t('projects.delete.locked.title'), t('projects.delete.locked.body', { path: r.path }), [{ value: 'retry', label: t('projects.delete.retry') }]);
      else if (r.noTrash) step = await choose(t('projects.delete.noTrash.title'), t('projects.delete.noTrash.body', { path: r.path }), [{ value: 'forever', label: t('projects.delete.noTrash.ok'), variant: 'destructive' }, { value: 'retry', label: t('projects.delete.retry') }]);
      if (!step) { await bridge.deleteProject(p.name, null, 'cancel'); return false; }
      r = await bridge.deleteProject(p.name, null, step);
      if (r?.ok) { notifyOk(t(step === 'forever' ? 'projects.delete.doneForever' : 'projects.delete.done')); return true; }
    }
    if (r?.ok) { notifyOk(t('projects.delete.done')); return true; }
  } catch (error) { notifyError(error); }
  finally { await refresh().catch(quiet); }
  return false;
}

// a new name for the project (and its folder, when it is one of Orb's), only with nothing working in it.
export async function renameFlow(p, t, onRenamed) {
  const r = await form(t('projects.rename.title'), { description: p.inHome ? t('projects.rename.desc') : t('projects.rename.descLinked'), initial: { name: p.name },
    body: (v, set) => <Field label={t('projects.rename.label')}><Input autoFocus value={v.name} onChange={(e) => set({ name: e.target.value })} maxLength={60} /></Field>,
    ok: t('projects.rename.ok'), onOk: (v) => call('projects.rename', { name: p.name, to: v.name.trim() }) });
  if (r) { notifyOk(t('projects.rename.done', { name: r.name })); await refresh().catch(quiet); onRenamed?.(r.name); }
}

// a linked folder only leaves Orb; its folder and files stay.
export async function unlinkFlow(p, t) {
  if (await confirm(t('projects.unlink.title'), t('projects.unlink.body', { name: p.name }), { ok: t('projects.unlink.ok'), danger: true })) return act(call('projects.remove', { name: p.name }), t('projects.unlink.done'));
  return undefined;
}

export async function commitFlow(p, t, onDone) {
  const r = await form(t('projects.commit.title'), { description: t('projects.commit.desc'), initial: { message: '' },
    body: (v, set) => <Field label={t('projects.commit.message')}><Input autoFocus value={v.message} onChange={(e) => set({ message: e.target.value })} maxLength={200} placeholder={t('projects.commit.ph')} /></Field>,
    ok: t('projects.commit.ok'), onOk: (v) => call('projects.commit', { name: p.name, message: v.message }) });
  if (r) { notifyOk(t('projects.commit.done', { files: r.files })); onDone?.(); }
}

export async function publishFlow(p, t, onDone) {
  const r = await form(t('projects.publish.title'), { description: t('projects.publish.desc'), initial: { repo: p.name.replace(/[^\w.-]+/g, '-'), isPrivate: true },
    body: (v, set) => (<><Field label={t('projects.publish.repo')}><Input value={v.repo} onChange={(e) => set({ repo: e.target.value })} /></Field><label className="flex cursor-pointer items-center gap-2 text-sm"><Checkbox checked={v.isPrivate} onCheckedChange={(c) => set({ isPrivate: c === true })} />{t('projects.publish.private')}</label></>),
    ok: t('projects.publish.ok'), onOk: (v) => call('projects.createRepo', { name: p.name, repo: v.repo.trim(), isPrivate: v.isPrivate }) });
  if (r) { notifyOk(t('projects.publish.done', { url: r.url })); onDone?.(); }
}

export async function pushFlow(p, info, t, onDone) {
  if (await confirm(t('projects.push.title'), t('projects.push.body', { branch: info.branch, remote: info.remote }), { ok: t('projects.push.ok'), danger: true })) { await act(call('projects.push', { name: p.name, branch: info.branch }), t('projects.push.done')); onDone?.(); }
}

// «Nuevo chat aquí»: the project becomes the one Orb works in and the chat opens.
export async function chatHereFlow(p) { await act(call('projects.setActive', { name: p.name })); go('chat'); }

// The project's own picture, chosen from a file (the engine keeps a copy) or taken away to go back to the dot.
export async function changeIconFlow(p, t) {
  const files = await bridge.pickFiles?.(t('projects.icon.pick'));
  const file = Array.isArray(files) ? files[0] : files;
  if (!file) return;
  const icon = await act(call('projects.setIcon', { name: p.name, path: file }), t('projects.icon.done'));
  if (icon !== undefined) setState((s) => ({ projectIcons: { ...s.projectIcons, [p.name]: icon } }));
}
export async function clearIconFlow(p, t) {
  const icon = await act(call('projects.clearIcon', { name: p.name }), t('projects.icon.cleared'));
  if (icon !== undefined) setState((s) => ({ projectIcons: { ...s.projectIcons, [p.name]: icon ?? null } }));
}

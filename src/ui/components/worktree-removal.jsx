// Removing a chat's own worktree (src/engine/chat-worktrees.mjs), shared by the chat's «Archive» and Settings › Data. It only
// removes a folder when no work would be lost; with changes not committed it shows them and lets the user remove it anyway
// (with the fingerprint of what they saw), and never silently.
import { call, act } from '@/lib/store.js';
import { notify } from '@/lib/notify.js';
import { confirm } from '@/components/dialogs.jsx';

// s: anything with the chat's id; t: the translator.
export async function offerWorktreeRemoval(s, t) {
  let st; try { st = await call('worktrees.status', { id: s.id }); } catch { return; }
  if (!st?.has || st.gone) return;
  // Work that would be lost: show it and let the user remove the folder anyway (force), never silently.
  const total = st.dirtyTotal ?? st.dirty.length;
  // Orb could not check what the folder holds (no repository, or git failed): it offers no removal, only where the folder is.
  if (st.dirty.length && (st.unknown || st.orphan)) { notify({ title: t('session.wt.unverified', { path: st.path }), tone: 'warning' }); return; }
  if (st.dirty.length) {
    const shown = st.dirty.slice(0, 50).join('\n');
    if (!(await confirm(t('session.wt.dirtyTitle', { count: total }), `${t('session.wt.dirtyBody')}

${shown}`, { ok: t('session.wt.force'), cancel: t('session.wt.keep'), danger: true }))) return;
    const f = await act(call('worktrees.discard', { id: s.id, force: true, fingerprint: st.fingerprint }));
    if (f?.removed) notify({ title: f.branchKept ? t('session.wt.branchKept', { branch: st.branch }) : t('session.wt.done'), tone: f.branchKept ? 'info' : 'success' });
    else notify({ title: t(f?.changed ? 'session.wt.changed' : 'session.wt.dirty', { count: f?.dirtyTotal ?? total }), tone: 'warning' });
    return;
  }
  if (!(await confirm(t('session.wt.title'), t('session.wt.body', { path: st.path }), { ok: t('session.wt.ok'), cancel: t('session.wt.keep') }))) return;
  const r = await act(call('worktrees.discard', { id: s.id }));
  if (r?.removed) notify({ title: r.branchKept ? t('session.wt.branchKept', { branch: st.branch }) : t('session.wt.done'), tone: r.branchKept ? 'info' : 'success' });
}

// 3.2.1: approving or rejecting a task that waits for the user, the same from Tareas and from the chat's notice. Approving
// always shows what is approved (title, agent, folder and why it asks) and signs exactly that version (previewHash).
import { confirm } from './dialogs.jsx';
import { call, act } from '@/lib/store.js';
import { AGENT, SENSITIVE } from '@/lib/labels.js';
import { t } from '@/lib/i18n.js';

// The detail carries the approval's fingerprint; the lists do not.
const withHash = async (task) => (task?.previewHash ? task : act(call('tasks.get', { id: task.id })));

export async function approveTask(task) {
  const full = await withHash(task); if (!full) return undefined;
  const body = t('tasks.approve.body', { title: full.title, agent: `${AGENT[full.agent] ?? full.agent}${full.model ? ` (${full.model})` : ''}`, path: full.project_path, reason: (full.sensitivity ?? []).map((s) => SENSITIVE[s] ?? s).join(', ') });
  if (!(await confirm(t('tasks.approve.title', { id: full.id }), body, { ok: t('tasks.approve.ok') }))) return undefined;
  return act(call('tasks.approve', { id: full.id, decision: 'approved', hash: full.previewHash }), t('tasks.approve.done'));
}

export async function rejectTask(task) {
  const full = await withHash(task); if (!full) return undefined;
  return act(call('tasks.approve', { id: full.id, decision: 'rejected', hash: full.previewHash }), t('tasks.reject.done'));
}

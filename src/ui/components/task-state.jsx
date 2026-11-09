// 3.8.3: why a task waits, and the card of a task Orb held for review, the same wherever a task shows (the chat's task
// lines, the task list and its detail; PC and phone). The engine says why (tasks.list › waiting / held,
// src/core/board.mjs › waitReason / heldInfo):
//   waiting.kind  paused  the whole queue is paused: «En pausa» with «Reanudar» at hand
//                 deps    it waits for other tasks: «Espera a #3», and which of them needs the user
//                 notice  the scheduler said why (usage limit, no agent available…)
//   held          { reasons, folder }: what it did that needs a look («ha eliminado 2714 archivos») and where, with
//                 «Aceptar» (the result stays) and «Deshacer» (the folder goes back to before the task).
import { ShieldAlert, Play, Undo2, Check, ExternalLink } from 'lucide-react';
import { Button } from './ui/button.jsx';
import { confirm } from './dialogs.jsx';
import { call, act, go } from '@/lib/store.js';
import { cn } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';

// The short text of why a queued task waits («En pausa», «Espera a #3», «En cola»).
export function waitText(t, task) {
  const w = task?.waiting;
  if (w?.kind === 'paused') return t('tasks.wait.paused');
  if (w?.kind === 'deps' && w.on?.length) {
    const ids = w.on.map((d) => `#${d.id}`).join(', ');
    const held = w.on.find((d) => d.held); const stuck = w.on.find((d) => ['failed', 'blocked', 'cancelled'].includes(d.status));
    return held ? t('tasks.wait.depsHeld', { ids, id: held.id }) : stuck ? t('tasks.wait.depsStuck', { ids, id: stuck.id }) : t('tasks.wait.deps', { ids });
  }
  if (w?.kind === 'notice' && w.text) return t('tasks.wait.notice');
  return t('orbchats.taskQueued');
}

export const resumeQueue = (t) => act(call('control.resume'), t('chat.resumed'));

// A queued task's state, small: the reason and, when the queue is paused, «Reanudar».
export function WaitLabel({ task, className }) {
  const t = useT();
  const w = task?.waiting;
  return (
    <span className={cn('text-muted-foreground inline-flex shrink-0 items-center gap-1.5 text-xs', className)} title={w?.kind === 'notice' ? w.text : undefined} data-testid="task-wait" data-wait={w?.kind ?? 'turn'}>
      {waitText(t, task)}
      {w?.kind === 'paused' ? <Button size="xs" variant="soft" onClick={(e) => { e.stopPropagation(); resumeQueue(t); }} data-testid="task-wait-resume"><Play />{t('tasks.wait.resume')}</Button> : null}
    </span>
  );
}

// The queue is paused: one line that says so, with «Reanudar» (the task's detail).
export function PausedNote({ className }) {
  const t = useT();
  return (
    <div className={cn('bg-warning/10 border-warning/40 flex flex-wrap items-center gap-2 rounded-xl border px-3.5 py-2.5 text-[13px]', className)} data-testid="queue-paused">
      <span className="min-w-0 flex-1">{t('tasks.wait.pausedNote')}</span>
      <Button size="sm" variant="soft" onClick={() => resumeQueue(t)}><Play />{t('tasks.wait.resume')}</Button>
    </div>
  );
}

export const acceptHeld = (t, task) => act(call('tasks.accept', { id: task.id }), t('tasks.held.accepted'));
export async function undoHeld(t, task) {
  if (await confirm(t('tasks.undo.title'), t('tasks.undo.body'), { ok: t('tasks.undo.ok'), danger: true })) act(call('tasks.undo', { id: task.id }));
}

// A task Orb held for review: what it did, where, and the two ways out. `link`: a button to its detail (the chat).
export function HeldCard({ task, link = false, className }) {
  const t = useT();
  const h = task?.held;
  if (!h) return null;
  return (
    <div className={cn('bg-warning/10 border-warning/40 grid gap-2 rounded-xl border px-3.5 py-2.5 text-[13px]', className)} data-testid="task-held">
      <div className="flex items-start gap-2">
        <ShieldAlert className="text-warning mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          {link ? <div className="font-semibold">{t('orbchats.taskN', { id: task.id })} · <span className="font-normal">{task.title}</span></div> : null}
          <div className="break-words">{h.folder ? t('tasks.held.line', { reasons: h.reasons, folder: h.folder }) : t('tasks.held.lineNoFolder', { reasons: h.reasons })}</div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 pl-6">
        <Button size="sm" onClick={() => acceptHeld(t, task)} data-testid="task-held-accept"><Check />{t('tasks.held.accept')}</Button>
        <Button size="sm" variant="outline" onClick={() => undoHeld(t, task)} data-testid="task-held-undo"><Undo2 />{t('tasks.undo.btn')}</Button>
        {link ? <Button size="sm" variant="ghost" onClick={() => go({ view: 'tasks', id: task.id })}><ExternalLink />{t('tasks.held.see')}</Button> : null}
      </div>
    </div>
  );
}

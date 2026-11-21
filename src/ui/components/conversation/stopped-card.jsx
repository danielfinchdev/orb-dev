// «Orb ha parado el turno»: a turn Orb itself ended (the guard caught a command, the working-time limit) shown in the
// conversation with its reason. It only informs; its two buttons are the ones a task already has («Ver tarea» and
// «Deshacer esta tarea», which asks before it undoes, as everywhere).
import { useEffect, useState } from 'react';
import { OctagonAlert, Undo2, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Badge } from '@/components/ui/basic.jsx';
import { AgentIcon } from '@/components/agent-icon.jsx';
import { undoTask } from '@/components/task-state.jsx';
import { useCatalog, modelLabel } from '@/components/brain-picker.jsx';
import { useStore, call, go } from '@/lib/store.js';
import { quiet } from '@/lib/quiet.js';
import { useT } from '@/lib/i18n.js';
import { AGENT } from '@/lib/labels.js';

export function StoppedCard({ m, name }) {
  const t = useT();
  const catalog = useCatalog();
  const meta = m.meta ?? {};
  const task = useStore((s) => (meta.task ? s.tasks.find((x) => x.id === meta.task) : null));
  // whether there is a photo to go back to is only in the task's own detail (tasks.get), asked again when its state changes
  const [photo, setPhoto] = useState(false);
  useEffect(() => {
    if (!meta.task || !task) return undefined;
    let alive = true;
    call('tasks.get', { id: meta.task }).then((d) => { if (alive) setPhoto(Boolean(d?.hasCheckpoint)); }, quiet);
    return () => { alive = false; };
  }, [meta.task, task?.status]);
  // the same condition as the task's own «Deshacer» (views/tasks.jsx): there is a photo to go back to, and nothing is running
  const canUndo = Boolean(task && photo && task.status !== 'running' && !task.held);
  return (
    <div role="group" aria-label={t('chat.stopped.title')} className="bg-card mx-auto grid w-full max-w-[92%] gap-2 rounded-xl border px-3.5 py-2.5 text-control" data-testid="stopped-card" data-cause={meta.cause ?? ''}>
      <div className="flex items-start gap-2">
        <OctagonAlert className="text-destructive mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 font-semibold">
            {meta.task ? <>{t('orbchats.taskN', { id: meta.task })}{meta.agent ? <> · <AgentIcon agent={meta.agent} className="size-3.5" />{AGENT[meta.agent] ?? meta.agent}{meta.model ? ` · ${modelLabel(catalog, meta.agent, meta.model)}` : ''}</> : null}</> : name}
          </div>
          <div className="break-words whitespace-pre-wrap" data-testid="stopped-reason">{m.body}</div>
        </div>
        <Badge variant="destructive">{t('chat.stopped.badge')}</Badge>
      </div>
      {meta.task && task ? (
        <div className="flex flex-wrap gap-2 pl-6">
          <Button size="sm" variant="ghost" onClick={() => go({ view: 'tasks', id: meta.task })} data-testid="stopped-see"><ExternalLink />{t('tasks.held.see')}</Button>
          {canUndo ? <Button size="sm" variant="outline" onClick={() => undoTask(t, task)} data-testid="stopped-undo"><Undo2 />{t('tasks.undo.btn')}</Button> : null}
        </div>
      ) : null}
    </div>
  );
}

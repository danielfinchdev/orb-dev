// Running tasks, live: how long, how many steps, what the agent is doing right now and, when the agent reports it, how
// far it is (%). Shown in the assistant's chat (above the message box) and in Tareas. A task that gives no sign of life
// for a while is marked, so a stuck one does not look like it is still working.
import { useEffect, useState } from 'react';
import { Square, MessageSquare, Hourglass } from 'lucide-react';
import { AgentIcon } from './agent-icon.jsx';
import { Button } from './ui/button.jsx';
import { confirm } from './dialogs.jsx';
import { useStore, call, act, go } from '@/lib/store.js';
import { AGENT } from '@/lib/labels.js';
import { cn } from '@/lib/utils.js';
import { t as tNow, useT } from '@/lib/i18n.js';

const QUIET_MIN = 5; // minutes without activity before it is shown as "sin señales"

// Polls the engine every 2 s while some task is running (one in-process message: cheap).
export function useLiveTasks() {
  const running = useStore((s) => s.tasks.filter((t) => t.status === 'running').map((t) => t.id).join(','));
  const [live, setLive] = useState([]);
  useEffect(() => {
    if (!running) { setLive([]); return undefined; }
    let alive = true;
    const load = () => call('tasks.live').then((r) => alive && setLive(r ?? [])).catch(() => {});
    load(); const t = setInterval(load, 2000);
    return () => { alive = false; clearInterval(t); };
  }, [running]);
  return live;
}

export const elapsed = (ms) => { const m = Math.floor(ms / 60000); return m < 1 ? tNow('comp.live.sec', { n: Math.max(1, Math.floor(ms / 1000)) }) : m < 60 ? tNow('comp.live.min', { n: m }) : tNow('comp.live.hourMin', { h: Math.floor(m / 60), m: m % 60 }); };

export function ProgressBar({ percent, quiet, className }) {
  return (
    <div className={cn('bg-muted relative h-1.5 w-full overflow-hidden rounded-full', className)} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}>
      {percent != null
        ? <div className={cn('h-full rounded-full transition-[width] duration-700', quiet ? 'bg-warning' : 'bg-primary')} style={{ width: `${Math.max(3, percent)}%` }} />
        : <div className={cn('absolute inset-y-0 w-1/3 rounded-full', quiet ? 'bg-warning/70' : 'bg-primary/70 animate-[orb-indeterminate_1.6s_ease-in-out_infinite]')} />}
    </div>
  );
}

// One running task: title, bar and a line with time, steps and the current action.
export function LiveTask({ t: task, compact = false, actions = true }) {
  const t = useT();
  const quiet = task.quietMin >= QUIET_MIN;
  const now = task.note || task.last;
  return (
    <div className="grid gap-1.5" data-testid="live-task">
      <div className="flex items-center gap-2">
        <AgentIcon agent={task.agent} className="size-3.5" />
        <button className="min-w-0 flex-1 cursor-pointer truncate text-left text-[13px] hover:underline" onClick={() => go({ view: 'tasks', id: task.id })}>#{task.id} {task.title}</button>
        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{task.percent != null ? `${task.percent} %` : t('comp.live.working')}</span>
        {actions ? <>
          <Button size="icon-sm" variant="ghost" className="size-6" title={t('comp.live.viewConv')} onClick={() => go({ view: 'session', id: task.sessionId })}><MessageSquare className="size-3.5" /></Button>
          <Button size="icon-sm" variant="ghost" className="size-6" title={t('comp.live.cancelTitle')} onClick={async () => { if (await confirm(t('comp.live.cancelTask'), t('comp.live.cancelBody', { agent: AGENT[task.agent] ?? task.agent }), { ok: t('comp.live.cancelTask'), cancel: t('comp.live.back'), danger: true })) act(call('tasks.cancel', { id: task.id }), t('comp.live.cancelled')); }}><Square className="size-3 fill-current" /></Button>
        </> : null}
      </div>
      <ProgressBar percent={task.percent} quiet={quiet} />
      <div className={cn('flex min-w-0 items-center gap-1.5 text-xs', quiet ? 'text-warning' : 'text-muted-foreground')}>
        {quiet ? <Hourglass className="size-3 shrink-0" /> : null}
        <span className="shrink-0 tabular-nums">{elapsed(Date.now() - task.startedAt)} · {t(task.steps === 1 ? 'comp.live.stepOne' : 'comp.live.stepOther', { n: task.steps })}</span>
        <span className="min-w-0 truncate">· {quiet ? t('comp.live.quiet', { min: task.quietMin, now }) : t('comp.live.now', { now })}</span>
      </div>
      {!compact && task.percent == null ? <p className="text-muted-foreground text-[11px]">{t('comp.live.noPercent', { agent: AGENT[task.agent] ?? task.agent, min: task.timeoutMin })}</p> : null}
    </div>
  );
}

// The block above the assistant's message box: what is running now.
export function LiveTasksStrip() {
  const t = useT();
  const live = useLiveTasks();
  if (!live.length) return null;
  return (
    <div className="shrink-0 px-5 pb-2">
      <div className="bg-card mx-auto grid max-w-3xl gap-3 rounded-2xl border px-4 py-3 shadow-xs" data-testid="live-strip">
        <div className="text-muted-foreground text-[11px] tracking-wide uppercase">{t('comp.live.running', { n: live.length })}</div>
        {live.slice(0, 4).map((task) => <LiveTask key={task.id} t={task} compact />)}
        {live.length > 4 ? <button className="text-muted-foreground cursor-pointer text-left text-xs hover:underline" onClick={() => go('tasks')}>{t('comp.live.more', { n: live.length - 4 })}</button> : null}
      </div>
    </div>
  );
}

export const liveOf = (live, id) => live.find((t) => t.id === id) ?? null;

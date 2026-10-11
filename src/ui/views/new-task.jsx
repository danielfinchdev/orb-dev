// 3.0: «Nueva tarea». With «Orquestador» off the user is the one who hands out the work: each message sent here is a task
// for the agent and model chosen under the box, in the project chosen above it. Several can be sent one after another and
// they run at the same time (as many as Ajustes › Tareas y usos allows). The tasks sent from this PC are listed here as a
// conversation, each with its live progress, its state and its result; «Ver tarea» opens it in Tareas.
import { useEffect, useRef, useState } from 'react';
import { ListPlus, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { Robot } from '@/components/robot.jsx';
import { PageHeader } from '@/components/page.jsx';
import { ProjectPicker } from '@/components/project-actions.jsx';
import { BrainPicker, ReasoningPicker, UsageBubble, useCatalog, useUsageBubble } from '@/components/brain-picker.jsx';
import { AgentIcon } from '@/components/agent-icon.jsx';
import { useLiveTasks, liveOf, ProgressBar } from '@/components/live-tasks.jsx';
import { Markdown } from '@/components/markdown.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Badge } from '@/components/ui/basic.jsx';
import { useStore, call, act, go } from '@/lib/store.js';
import { AGENT, STATUS } from '@/lib/labels.js';
import { ago } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';
import { Composer } from './chat.jsx';

// Text cut to n characters on a word, with an ellipsis.
const short = (s, n) => { const v = String(s ?? '').trim(); return v.length > n ? `${v.slice(0, n).replace(/\s+\S*$/, '')}…` : v; };
const KEY = 'orb.newTask.ids'; // the tasks sent from this screen on this PC (the last 40)
const loadIds = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v.filter(Number.isInteger) : []; } catch { return []; } };
const saveIds = (ids) => { try { localStorage.setItem(KEY, JSON.stringify(ids.slice(-40))); } catch { /* storage unavailable */ } };

export function NewTaskView() {
  const t = useT();
  const app = useStore((s) => s.app);
  const tasks = useStore((s) => s.tasks);
  const info = app.assistant ?? {};
  const active = app.activeProject;
  const catalog = useCatalog();
  const live = useLiveTasks();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [ids, setIds] = useState(loadIds);
  const [brain, setBrain] = useState({ agent: info.agent ?? 'claude', model: '', account: info.account, reasoning: 'medium' });
  useEffect(() => {
    if (!catalog?.length || catalog.some((a) => a.id === brain.agent)) return;
    const a = catalog[0];
    setBrain((b) => ({ ...b, agent: a.id, model: '', account: a.accounts[0]?.id ?? a.id }));
  }, [catalog]); // eslint-disable-line react-hooks/exhaustive-deps
  const bubble = useUsageBubble(catalog, brain);
  const end = useRef(null);
  const sent = ids.map((id) => tasks.find((x) => x.id === id)).filter(Boolean);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [sent.length]);

  const send = async () => {
    const brief = text.trim(); if (!brief || busy) return;
    if (!active) { toast.info(t('newTask.needProject')); return; }
    setBusy(true);
    try {
      const account = brain.account && brain.account !== brain.agent ? brain.account : null;
      const task = await act(call('tasks.create', { project: active.name, title: short(brief.split('\n')[0], 90), description: brief, agent: brain.agent, model: brain.model || null, account, reasoning: brain.reasoning, mode: 'carpeta' }));
      if (task?.id) { const next = [...ids, task.id]; setIds(next); saveIds(next); setText(''); }
    } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader icon={<ListPlus className="text-primary size-5" />} title={t('newTask.title')} meta={t('newTask.meta')} />
      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="new-task-list">
        {sent.length ? (
          <div className="mx-auto flex max-w-3xl flex-col gap-4 px-5 py-6">
            {sent.map((task) => <SentTask key={task.id} task={task} live={liveOf(live, task.id)} t={t} />)}
            <div ref={end} />
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 px-5 pt-16 pb-6 text-center">
            <Robot size={120} mood="hello" live />
            <div className="chat-glass chat-hero flex flex-col items-center gap-3">
              <h2 className="hero-title mt-2 text-2xl">{t('newTask.hello')}</h2>
              <p className="text-muted-foreground max-w-md">{t('newTask.intro')}</p>
            </div>
          </div>
        )}
      </div>
      <Composer value={text} onChange={setText} onSend={send} busy={busy} disabled={busy} testid="new-task-input" mentions={false}
        placeholder={t('newTask.placeholder')}
        top={<ProjectPicker />}
        notice={<UsageBubble text={bubble.text} onClose={bubble.close} />}
        bottom={<>
          <BrainPicker catalog={catalog} value={brain} onChange={(b) => setBrain((x) => ({ ...x, ...b }))} />
          <ReasoningPicker value={brain.reasoning} onChange={(reasoning) => setBrain((x) => ({ ...x, reasoning }))} />
        </>} />
    </>
  );
}

// One task sent from here: what was asked (as a message of the user) and, below, who works on it and how it goes.
function SentTask({ task, live, t }) {
  const who = task.assigned_to ?? task.agent;
  const model = task.model;
  return (
    <div className="flex flex-col gap-2" data-testid={`new-task-${task.id}`}>
      <div className="bg-primary/10 ml-auto max-w-[85%] rounded-2xl rounded-br-md px-4 py-2.5 text-[14px] whitespace-pre-wrap">{short(task.description, 600)}</div>
      <div className="bg-card flex flex-col gap-2 rounded-2xl border px-4 py-3">
        <div className="flex items-center gap-2 text-[13px]">
          <AgentIcon agent={who} className="size-4" />
          <span className="min-w-0 flex-1 truncate">{AGENT[who] ?? who}{model ? ` · ${model}` : ''} · #{task.id} · {task.project}</span>
          <Badge variant={STATUS[task.status]?.[1]}>{STATUS[task.status]?.[0] ?? task.status}</Badge>
        </div>
        {task.status === 'running' && live ? <div className="flex items-center gap-2"><ProgressBar percent={live.percent} quiet={live.quietMin >= 5} className="h-1" /><span className="text-muted-foreground shrink-0 text-[11px] tabular-nums">{live.percent != null ? `${live.percent} %` : t('tasks.steps', { n: live.steps })}</span></div> : null}
        {task.result && ['done', 'failed', 'blocked'].includes(task.status) ? <div className="text-muted-foreground max-h-40 overflow-hidden text-[13px]"><Markdown>{short(task.result, 700)}</Markdown></div> : null}
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground flex-1 text-[11px]">{ago(task.updated_at)}</span>
          <Button size="xs" variant="ghost" onClick={() => go({ view: 'tasks', id: task.id })}>{t('newTask.open')}<ArrowRight /></Button>
        </div>
      </div>
    </div>
  );
}

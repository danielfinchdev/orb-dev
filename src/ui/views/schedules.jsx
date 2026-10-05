// Programadas: tasks that repeat on their own ("cada lunes a las 9 revisa las dependencias"). Each run is a normal task
// (same approvals, quota and agents); one the assistant proposed needs your approval once before it runs by itself.
import { useEffect, useState } from 'react';
import { CalendarClock, Plus, Play, Trash2, Check } from 'lucide-react';
import { PageHeader, PageBody } from '@/components/page.jsx';
import { AgentIcon } from '@/components/agent-icon.jsx';
import { form, confirm } from '@/components/dialogs.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent, Badge, Field, Input, Textarea, Empty } from '@/components/ui/basic.jsx';
import { Select, Switch, Checkbox } from '@/components/ui/overlay.jsx';
import { toast } from 'sonner';
import { useStore, call, act, go, getState } from '@/lib/store.js';
import { AGENT } from '@/lib/labels.js';

const EVERY = { daily: 'Cada día', weekly: 'Cada semana', every_hours: 'Cada N horas', hourly: 'Cada hora' };
const DAYS = [[1, 'L'], [2, 'M'], [3, 'X'], [4, 'J'], [5, 'V'], [6, 'S'], [0, 'D']];
const when = (iso) => (iso ? new Date(iso).toLocaleString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

export async function newSchedule(preset = {}) {
  const { projects, app } = getState();
  const list = projects ?? [];
  if (!list.length) { toast.error('Crea antes un proyecto: cada tarea programada trabaja en uno.'); return null; }
  const agents = Object.keys(app?.config?.agents ?? {});
  return form('Nueva tarea programada', {
    description: 'Se crea una tarea normal cada vez que toca. Si la anterior sigue abierta, espera a que termine (no se acumulan).',
    initial: { project: preset.project ?? app?.activeProject?.name ?? list[0].name, title: '', description: '', agent: 'any', every: 'weekly', at_time: '09:00', weekdays: [1], hours: 6, readonly: false },
    body: (v, set) => (<>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Proyecto"><Select className="w-full" value={v.project} onValueChange={(project) => set({ project })} options={list.map((p) => ({ value: p.name, label: p.name }))} /></Field>
        <Field label="Agente"><Select className="w-full" value={v.agent} onValueChange={(agent) => set({ agent })} options={[{ value: 'any', label: 'El que tenga cupo' }, ...agents.map((a) => ({ value: a, label: AGENT[a] ?? a }))]} /></Field>
      </div>
      <Field label="Título"><Input autoFocus value={v.title} onChange={(e) => set({ title: e.target.value })} maxLength={120} placeholder="Revisar dependencias" /></Field>
      <Field label="Qué tiene que hacer" hint="Como un encargo: qué hacer, dónde y cuándo está terminado."><Textarea rows={4} value={v.description} onChange={(e) => set({ description: e.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Frecuencia"><Select className="w-full" value={v.every} onValueChange={(every) => set({ every })} options={Object.entries(EVERY).map(([value, label]) => ({ value, label }))} /></Field>
        {v.every === 'every_hours' ? <Field label="Cada cuántas horas"><Input type="number" min={1} max={168} value={v.hours} onChange={(e) => set({ hours: e.target.value })} /></Field>
          : v.every === 'hourly' ? <div /> : <Field label="Hora"><Input type="time" value={v.at_time} onChange={(e) => set({ at_time: e.target.value })} /></Field>}
      </div>
      {v.every === 'weekly' ? (
        <Field label="Días">
          <div className="flex flex-wrap gap-1.5">{DAYS.map(([d, l]) => <Button key={d} type="button" size="sm" variant={v.weekdays.includes(d) ? 'default' : 'outline'} className="w-9" onClick={() => set({ weekdays: v.weekdays.includes(d) ? v.weekdays.filter((x) => x !== d) : [...v.weekdays, d] })}>{l}</Button>)}</div>
        </Field>
      ) : null}
      <label className="flex cursor-pointer items-center gap-2 text-[13px]"><Checkbox checked={v.readonly} onCheckedChange={(c) => set({ readonly: c === true })} />Solo lectura (revisar o investigar, sin cambiar archivos)</label>
    </>),
    ok: 'Programar',
    onOk: async (v) => call('schedules.create', { ...v, hours: Number(v.hours) || 6 })
  });
}

export function SchedulesView() {
  const version = useStore((s) => s.version);
  const [list, setList] = useState(null);
  const load = () => call('schedules.list').then(setList).catch(() => setList([]));
  useEffect(() => { load(); }, [version]); // eslint-disable-line react-hooks/exhaustive-deps
  const create = async () => { if (await newSchedule()) load(); };
  return (
    <>
      <PageHeader icon={<CalendarClock className="text-primary size-5" />} title="Programadas" meta="Tareas que se repiten solas: revisiones, pruebas, informes…">
        <Button size="sm" onClick={create} data-testid="new-schedule"><Plus />Nueva</Button>
      </PageHeader>
      <PageBody>
        <div className="mx-auto grid max-w-3xl gap-3">
          {list && !list.length ? <Empty title="Nada programado todavía">Por ejemplo: «cada lunes a las 9, revisa si hay dependencias con fallos de seguridad». También puedes pedírselo al asistente en el chat.</Empty> : null}
          {(list ?? []).map((s) => (
            <Card key={s.id} className="py-4">
              <CardContent className="flex flex-wrap items-start gap-3">
                <AgentIcon agent={s.agent} className="mt-1 size-5" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{s.title}</span>{!s.approved ? <Badge variant="warning">Espera tu aprobación</Badge> : null}{s.readonly ? <Badge variant="secondary">Solo lectura</Badge> : null}</div>
                  <div className="text-muted-foreground mt-0.5 text-xs">{s.when} · {s.project} · próxima: {s.enabled && s.approved ? when(s.next_run) : 'en pausa'}{s.last_task ? <> · última: <a className="cursor-pointer underline-offset-2 hover:underline" onClick={() => go({ view: 'tasks', id: s.last_task })}>#{s.last_task}</a></> : null}</div>
                  <p className="text-muted-foreground mt-1.5 line-clamp-2 text-[13px]">{s.description}</p>
                </div>
                <div className="flex items-center gap-2">
                  {!s.approved ? <Button size="sm" onClick={() => act(call('schedules.update', { id: s.id, approve: true }), 'Aprobada: funcionará sola').then(load)}><Check />Aprobar</Button>
                    : <Switch checked={s.enabled} onCheckedChange={(enabled) => act(call('schedules.update', { id: s.id, enabled })).then(load)} aria-label="Activada" />}
                  <Button size="icon-sm" variant="ghost" title="Ejecutar ahora" onClick={() => act(call('schedules.run', { id: s.id }), 'Tarea creada').then(load)}><Play /></Button>
                  <Button size="icon-sm" variant="danger" title="Borrar" onClick={async () => { if (await confirm('Borrar tarea programada', `«${s.title}» dejará de ejecutarse. Las tareas que ya creó siguen ahí.`, { ok: 'Borrar', danger: true })) act(call('schedules.remove', { id: s.id })).then(load); }}><Trash2 /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </PageBody>
    </>
  );
}

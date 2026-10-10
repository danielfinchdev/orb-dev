// Programadas: tasks that repeat on their own ("cada lunes a las 9 revisa las dependencias"). Each run is a normal task
// (same approvals, quota and agents); one the assistant proposed needs your approval once before it runs by itself.
import { useEffect, useState } from 'react';
import { CalendarClock, Plus, Play, Trash2, Check } from 'lucide-react';
import { PageHeader, PageBody } from '@/components/page.jsx';
import { AgentIcon } from '@/components/agent-icon.jsx';
import { form, confirm } from '@/components/dialogs.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent, Badge, Field, Input, Textarea, Empty } from '@/components/ui/basic.jsx';
import { Select, Switch, Checkbox, BubbleTip } from '@/components/ui/overlay.jsx';
import { toast } from 'sonner';
import { useStore, call, act, go, getState } from '@/lib/store.js';
import { AGENT } from '@/lib/labels.js';
import { t, useT, currentLocale } from '@/lib/i18n.js';

const EVERY = ['daily', 'weekly', 'every_hours', 'hourly'];
const DAYS = [1, 2, 3, 4, 5, 6, 0];
const when = (iso) => (iso ? new Date(iso).toLocaleString(currentLocale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

export async function newSchedule(preset = {}) {
  const { projects, app } = getState();
  const list = projects ?? [];
  if (!list.length) { toast.error(t('schedules.noProject')); return null; }
  const agents = Object.keys(app?.config?.agents ?? {});
  return form(t('schedules.new.title'), {
    description: t('schedules.new.desc'),
    initial: { project: preset.project ?? app?.activeProject?.name ?? list[0].name, title: '', description: '', agent: 'any', every: 'weekly', at_time: '09:00', weekdays: [1], hours: 6, readonly: false },
    body: (v, set) => (<>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('schedules.project')}><Select className="w-full" value={v.project} onValueChange={(project) => set({ project })} options={list.map((p) => ({ value: p.name, label: p.name }))} /></Field>
        <Field label={t('schedules.agent')}><Select className="w-full" value={v.agent} onValueChange={(agent) => set({ agent })} options={[{ value: 'any', label: t('schedules.anyQuota') }, ...agents.map((a) => ({ value: a, label: AGENT[a] ?? a }))]} /></Field>
      </div>
      <Field label={t('schedules.titleField')}><Input autoFocus value={v.title} onChange={(e) => set({ title: e.target.value })} maxLength={120} placeholder={t('schedules.titlePh')} /></Field>
      <Field label={t('schedules.what')} hint={t('schedules.whatHint')}><Textarea rows={4} value={v.description} onChange={(e) => set({ description: e.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('schedules.frequency')}><Select className="w-full" value={v.every} onValueChange={(every) => set({ every })} options={EVERY.map((value) => ({ value, label: t(`schedules.every.${value}`) }))} /></Field>
        {v.every === 'every_hours' ? <Field label={t('schedules.everyHours')}><Input type="number" min={1} max={168} value={v.hours} onChange={(e) => set({ hours: e.target.value })} /></Field>
          : v.every === 'hourly' ? <div /> : <Field label={t('schedules.time')}><Input type="time" value={v.at_time} onChange={(e) => set({ at_time: e.target.value })} /></Field>}
      </div>
      {v.every === 'weekly' ? (
        <Field label={t('schedules.daysField')}>
          <div className="flex flex-wrap gap-1.5">{DAYS.map((d) => <Button key={d} type="button" size="sm" variant={v.weekdays.includes(d) ? 'default' : 'outline'} className="w-9" onClick={() => set({ weekdays: v.weekdays.includes(d) ? v.weekdays.filter((x) => x !== d) : [...v.weekdays, d] })}>{t(`schedules.days.${d}`)}</Button>)}</div>
        </Field>
      ) : null}
      <label className="flex cursor-pointer items-center gap-2 text-[13px]"><Checkbox checked={v.readonly} onCheckedChange={(c) => set({ readonly: c === true })} />{t('schedules.readonly')}</label>
    </>),
    ok: t('schedules.new.ok'),
    onOk: async (v) => call('schedules.create', { ...v, hours: Number(v.hours) || 6 })
  });
}

export function SchedulesView() {
  const t = useT();
  const version = useStore((s) => s.version);
  const [list, setList] = useState(null);
  const load = () => call('schedules.list').then(setList).catch(() => setList([]));
  useEffect(() => { load(); }, [version]); // eslint-disable-line react-hooks/exhaustive-deps
  const create = async () => { if (await newSchedule()) load(); };
  return (
    <>
      <PageHeader icon={<CalendarClock className="text-primary size-5" />} title={t('schedules.title')} meta={t('schedules.meta')}>
        <Button size="sm" onClick={create} data-testid="new-schedule"><Plus />{t('schedules.newBtn')}</Button>
      </PageHeader>
      <PageBody>
        <div className="mx-auto grid max-w-3xl gap-3">
          {list && !list.length ? <Empty title={t('schedules.empty.title')}>{t('schedules.empty.hint')}</Empty> : null}
          {(list ?? []).map((s) => (
            <Card key={s.id} className="py-4">
              <CardContent className="flex flex-wrap items-start gap-3">
                <AgentIcon agent={s.agent} className="mt-1 size-5" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{s.title}</span>{!s.approved ? <Badge variant="warning">{t('schedules.awaiting')}</Badge> : null}{s.readonly ? <Badge variant="secondary">{t('schedules.readonlyBadge')}</Badge> : null}</div>
                  <div className="text-muted-foreground mt-0.5 text-xs">{t('schedules.nextLine', { when: s.when, project: s.project, next: s.enabled && s.approved ? when(s.next_run) : t('schedules.paused') })}{s.last_task ? <>{t('schedules.last')}<a className="cursor-pointer underline-offset-2 hover:underline" onClick={() => go({ view: 'tasks', id: s.last_task })}>#{s.last_task}</a></> : null}</div>
                  <p className="text-muted-foreground mt-1.5 line-clamp-2 text-[13px]">{s.description}</p>
                </div>
                <div className="flex items-center gap-2">
                  {!s.approved ? <Button size="sm" onClick={() => act(call('schedules.update', { id: s.id, approve: true }), t('schedules.approve.done')).then(load)}><Check />{t('schedules.approve')}</Button>
                    : <Switch checked={s.enabled} onCheckedChange={(enabled) => act(call('schedules.update', { id: s.id, enabled })).then(load)} aria-label={t('schedules.enabled')} />}
                  <BubbleTip title={t('schedules.runNow')}><Button size="icon-sm" variant="ghost" aria-label={t('schedules.runNow')} onClick={() => act(call('schedules.run', { id: s.id }), t('schedules.run.done')).then(load)}><Play /></Button></BubbleTip>
                  <BubbleTip title={t('schedules.remove')}><Button size="icon-sm" variant="danger" aria-label={t('schedules.remove')} onClick={async () => { if (await confirm(t('schedules.remove.title'), t('schedules.remove.body', { title: s.title }), { ok: t('schedules.remove'), danger: true })) act(call('schedules.remove', { id: s.id })).then(load); }}><Trash2 /></Button></BubbleTip>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </PageBody>
    </>
  );
}

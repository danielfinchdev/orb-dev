// Programadas: tasks that repeat on their own ("cada lunes a las 9 revisa las dependencias"). Each run is a normal task
// (same approvals, quota and agents); one the assistant proposed needs your approval once before it runs by itself.
// «Una sola vez» (a date and time; it turns off after running) and «Ejecutar siempre en el mismo chat».
// The PC app draws the mock-up's list (filters, columns, last runs); the phone and a computer's browser linked with an Orb
// keep the card layout.
import { useEffect, useState } from 'react';
import { CalendarSync, CalendarClock, Plus, Play, Trash2, Check, MessageSquare, PencilLine, Repeat, RefreshCw, ClipboardCheck, RotateCcw } from 'lucide-react';
import { PageHeader, PageBody } from '@/components/page.jsx';
import { AgentIcon } from '@/components/agent-icon.jsx';
import { ProjectIcon } from '@/components/project-icon.jsx';
import { NotificationBell } from '@/components/notification-center.jsx';
import { BarPause } from '@/components/conversation/bar.jsx';
import { TaskStatus } from '@/components/task-state.jsx';
import { form, confirm } from '@/components/dialogs.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent, Badge, Field, Input, Textarea, Empty } from '@/components/ui/basic.jsx';
import { Select, Switch, BubbleTip, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/overlay.jsx';
import { MoreButton, IconButton, ListCard, ListRow, Segmented, SectionLabel } from '@/components/ui/primitives.jsx';
import { notifyError, notifyOk } from '@/lib/notify.js';
import { useStore, call, act, go, getState, bridge, fullPc, refresh } from '@/lib/store.js';
import { AGENT, PERMISSION } from '@/lib/labels.js';
import { modelsOf } from '@/components/brain-picker.jsx';
import { canRetryFromRow } from './tasks.jsx';
import { ago, cn } from '@/lib/utils.js';
import { t, useT, currentLocale } from '@/lib/i18n.js';

const EVERY = ['hourly', 'daily', 'weekly', 'every_hours', 'once'];
// Tomorrow at 9:00, as a datetime-local value (the first value of «Una sola vez»).
const tomorrowAt9 = () => { const d = new Date(); d.setDate(d.getDate() + 1); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T09:00`; };
const DAYS = [1, 2, 3, 4, 5, 6, 0];
const when = (iso) => (iso ? new Date(iso).toLocaleString(currentLocale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const dayName = (d) => new Date(2024, 0, 7 + d).toLocaleDateString(currentLocale(), { weekday: 'long' });

// The zone the engine reads the wall time in: the owner's (Ajustes' tz) or, without one, this PC's.
const PC_ZONE = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };
function zoneName() {
  const z = getState().app?.config?.tz;
  try { if (z) { new Intl.DateTimeFormat(undefined, { timeZone: z }); return z; } } catch { /* an invalid zone: the engine falls back to the PC's */ }
  return PC_ZONE();
}
const clock = (hhmm) => { const [h, m] = String(hhmm || '09:00').split(':'); return `${Number(h)}:${m ?? '00'}`; };
const dayDate = (d) => { const text = d.toLocaleDateString(currentLocale(), { weekday: 'long', day: 'numeric', month: 'long' }); return currentLocale().startsWith('es') ? text.replace(',', '') : text; };

// The next run of what the dialog describes, worked out in this PC's zone (the one the engine uses unless Ajustes sets another).
function nextOccurrence(v, from = new Date()) {
  const [h, m] = String(v.at_time || '09:00').split(':').map(Number);
  if (v.every === 'once') { const d = v.at_date ? new Date(v.at_date) : null; return d && d > from ? d : null; }
  if (v.every === 'hourly') { const d = new Date(from); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1); return d; }
  if (v.every === 'every_hours') return new Date(from.getTime() + (Number(v.hours) || 6) * 3_600_000);
  const days = v.every === 'weekly' ? (v.weekdays.length ? v.weekdays : [1]) : DAYS;
  for (let i = 0; i < 8; i++) { const d = new Date(from); d.setDate(d.getDate() + i); d.setHours(h, m, 0, 0); if (d > from && days.includes(d.getDay())) return d; }
  return null;
}

// What the chosen frequency means, as the dialog's summary: «Cada lunes a las 9:00 (Europe/Madrid). Próxima: lunes 16 de noviembre.»
function summary(v) {
  const tz = zoneName();
  if (v.every === 'once') return t('schedules.sum.once', { when: v.at_date ? new Date(v.at_date).toLocaleString(currentLocale(), { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '—', tz });
  if (v.every === 'hourly') return t('schedules.sum.hourly');
  if (v.every === 'every_hours') return t('schedules.sum.hours', { n: Number(v.hours) || 6 });
  // the next run is worked out in this PC's zone: with another zone set in Ajustes it is left out rather than guessed
  const next = tz === PC_ZONE() ? nextOccurrence(v) : null;
  const tail = next ? t('schedules.sum.next', { when: dayDate(next) }) : '';
  if (v.every === 'daily') return t('schedules.sum.daily', { time: clock(v.at_time), tz }) + tail;
  const names = (v.weekdays.length ? DAYS.filter((d) => v.weekdays.includes(d)) : [1]).map(dayName);
  return t('schedules.sum.weekly', { days: typeof Intl.ListFormat === 'function' ? new Intl.ListFormat(currentLocale(), { style: 'long', type: 'conjunction' }).format(names) : names.join(', '), time: clock(v.at_time), tz }) + tail;
}

// A setting of the dialog: its text on the left, its switch on the right; the whole row is the switch's label.
function SwitchRow({ label, hint, checked, onChange, testid }) {
  return (
    <label className="border-border flex cursor-pointer items-center gap-3 border-t px-3.5 py-3 first:border-t-0">
      <span className="flex min-w-0 flex-1 flex-col gap-0.5"><b className="text-control font-medium">{label}</b>{hint ? <span className="text-muted-foreground text-caption">{hint}</span> : null}</span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} data-testid={testid} />
    </label>
  );
}

async function newSchedule(preset = {}) {
  const { projects, app } = getState();
  const list = projects ?? [];
  if (!list.length) { notifyError(t('schedules.noProject')); return null; }
  // only the agents this PC can run (the engine refuses a schedule for another one).
  const agents = app?.agentsAvailable ?? Object.keys(app?.config?.agents ?? {});
  // the agent and its model in one list: «Claude Code · Sonnet 5.5»; the value is «agent» or «agent::model» (split again on create).
  const catalog = await call('models.catalog').catch(() => []);
  const brains = [{ value: 'any', label: t('schedules.anyQuota') }, ...agents.flatMap((a) => {
    const icon = <AgentIcon agent={a} className="size-3.5" />;
    const own = modelsOf(catalog.find((c) => c.id === a), null).filter((m) => m.id);
    // the agent alone comes first: its model is then Orb's choice at each run (a schedule is not tied to one model for good)
    return [{ value: a, label: AGENT[a] ?? a, icon }, ...own.map((m) => ({ value: `${a}::${m.id}`, label: `${AGENT[a] ?? a} · ${m.label}`, icon }))];
  })];
  const mode = app?.config?.permissions?.mode === 'preguntar' ? 'editar' : 'auto';
  return form(t('schedules.new.title'), {
    initial: { project: preset.project ?? app?.activeProject?.name ?? list[0].name, title: '', description: '', brain: 'any', every: 'weekly', at_time: '09:00', weekdays: [1], hours: 6, readonly: false, at_date: tomorrowAt9(), same_chat: false },
    wide: true,
    body: (v, set) => (<>
      <Field label={t('schedules.titleField')}><Input autoFocus value={v.title} onChange={(e) => set({ title: e.target.value })} maxLength={120} placeholder={t('schedules.titlePh')} /></Field>
      <Field label={t('schedules.what')} hint={t('schedules.whatNote', { assistant: app?.config?.assistantName })}><Textarea rows={4} value={v.description} onChange={(e) => set({ description: e.target.value })} placeholder={t('schedules.whatHint')} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('schedules.project')}><Select className="w-full" value={v.project} onValueChange={(project) => set({ project })} options={list.map((p) => ({ value: p.name, label: p.name, icon: <ProjectIcon name={p.name} small /> }))} /></Field>
        <Field label={t('schedules.agentModel')}><Select className="w-full" value={v.brain} onValueChange={(brain) => set({ brain })} options={brains} data-testid="schedule-brain" /></Field>
      </div>
      <Field label={t('schedules.frequency')}><Segmented className="self-start" aria-label={t('schedules.frequency')} value={v.every} onChange={(every) => set({ every })} options={EVERY.map((value) => ({ value, label: t(`schedules.every.${value}`) }))} /></Field>
      {v.every === 'weekly' ? (
        <Field label={t('schedules.daysField')}>
          <div className="flex flex-wrap gap-1">{DAYS.map((d) => <Button key={d} type="button" size="icon-sm" variant={v.weekdays.includes(d) ? 'default' : 'outline'} aria-pressed={v.weekdays.includes(d)} aria-label={dayName(d)} onClick={() => set({ weekdays: v.weekdays.includes(d) ? v.weekdays.filter((x) => x !== d) : [...v.weekdays, d] })}>{t(`schedules.days.${d}`)}</Button>)}</div>
        </Field>
      ) : null}
      {v.every === 'hourly' ? null : (
        <div className="grid grid-cols-2 gap-3">
          {v.every === 'every_hours' ? <Field label={t('schedules.everyHours')}><Input type="number" min={1} max={168} value={v.hours} onChange={(e) => set({ hours: e.target.value })} /></Field>
            : v.every === 'once' ? <Field label={t('schedules.dateTime')}><Input type="datetime-local" value={v.at_date} onChange={(e) => set({ at_date: e.target.value })} data-testid="schedule-at-date" /></Field>
              : <Field label={t('schedules.time')}><Input type="time" value={v.at_time} onChange={(e) => set({ at_time: e.target.value })} /></Field>}
          {/* the engine reads the wall time in one zone (Ajustes' or this PC's): it is shown, not chosen */}
          {v.every === 'every_hours' ? null : <Field label={t('schedules.tz')} hint={t('schedules.tzHint')}><Input value={zoneName()} readOnly disabled data-testid="schedule-tz" /></Field>}
        </div>
      )}
      <div className="bg-primary-soft text-primary-text flex items-center gap-2 rounded-card px-2.5 py-2 text-control" data-testid="schedule-summary"><CalendarClock className="size-3.5 shrink-0" />{summary(v)}</div>
      <ListCard>
        <SwitchRow label={t('schedules.readonlyLab')} hint={t('schedules.readonlyHint')} checked={v.readonly} onChange={(c) => set({ readonly: c === true })} />
        {/* the level of permissions of the runs is Orb's own (Ajustes): shown here, changed there */}
        <div className="border-border flex items-center gap-3 border-t px-3.5 py-3" data-testid="schedule-permissions">
          <span className="flex min-w-0 flex-1 flex-col gap-0.5"><b className="text-control font-medium">{t('schedules.perm')}</b><span className="text-muted-foreground text-caption">{t('schedules.permHint')}</span></span>
          <Badge variant="secondary">{PERMISSION[mode]}</Badge>
        </div>
        {v.every === 'once' ? null : <SwitchRow label={t('schedules.sameChat')} hint={t('schedules.sameChatHint')} checked={v.same_chat} onChange={(c) => set({ same_chat: c === true })} testid="schedule-same-chat" />}
      </ListCard>
    </>),
    ok: t('schedules.new.ok'),
    onOk: async ({ at_date: date, brain, ...v }) => { const [agent, model] = brain.split('::'); return call('schedules.create', { ...v, agent, ...(model ? { model } : {}), at_time: v.every === 'once' ? date : v.at_time, same_chat: v.every !== 'once' && v.same_chat, hours: Number(v.hours) || 6 }); }
  });
}

// What the engine lets change on a schedule that exists: its name and its instructions (the rest is decided when it is created).
async function editSchedule(s) {
  return form(t('schedules.edit.title'), {
    initial: { title: s.title, description: s.description },
    body: (v, set) => (<>
      <Field label={t('schedules.edit.name')}><Input autoFocus value={v.title} onChange={(e) => set({ title: e.target.value })} maxLength={120} data-testid="schedule-edit-title" /></Field>
      <Field label={t('schedules.edit.what')} hint={t('schedules.whatNote', { assistant: getState().app?.config?.assistantName })}><Textarea rows={5} value={v.description} onChange={(e) => set({ description: e.target.value })} data-testid="schedule-edit-description" /></Field>
    </>),
    ok: t('schedules.edit.ok'),
    onOk: async (v) => {
      if (!v.title.trim() || !v.description.trim()) throw new Error(t('schedules.edit.empty'));
      return call('schedules.update', { id: s.id, title: v.title.trim(), description: v.description.trim() });
    }
  });
}

const removeSchedule = async (s, load, tr) => {
  if (await confirm(tr('schedules.remove.title'), tr('schedules.remove.body', { title: s.title }), { ok: tr('schedules.remove'), danger: true })) act(call('schedules.remove', { id: s.id })).then(load);
};

// A «once» schedule that already ran: nothing left to switch on.
const spent = (s) => s.every === 'once' && !s.next_run && Boolean(s.last_run);
const FAILED = ['failed', 'blocked'];

const FILTERS = [['all', () => true], ['active', (s) => s.enabled], ['paused', (s) => !s.enabled], ['failed', (s) => s.lastFailed]];

// Disabled while the call runs, so a double click cannot queue the task twice.
function RetryRun({ id }) {
  const tr = useT();
  const [busy, setBusy] = useState(false);
  const retry = async () => { setBusy(true); try { await act(call('tasks.retry', { id }), tr('tasks.retry.done')); } finally { setBusy(false); } };
  return <Button size="xs" variant="outline" disabled={busy} onClick={retry} data-testid="schedule-run-retry"><RotateCcw />{tr('tasks.retry')}</Button>;
}

function ScheduleRow({ s, load, catalog }) {
  const tr = useT();
  // the model by its name («Sonnet 5.5»), else the agent's
  const brain = (s.model && modelsOf(catalog?.find((c) => c.id === s.agent), null).find((m) => m.id === s.model)?.label) || s.model || AGENT[s.agent] || s.agent;
  const off = !s.enabled;
  const last = s.lastTask;
  const next = s.enabled && s.approved ? when(s.next_run) : spent(s) ? tr('schedules.spent') : tr('schedules.pausedBadge');
  const lastDate = s.last_run ? new Date(s.last_run).toLocaleString(currentLocale(), { day: 'numeric', month: 'short' }) : null;
  const run = () => act(call('schedules.run', { id: s.id }), tr('schedules.run.done')).then(load);
  return (
    <ListRow data-testid="schedule-row" className={cn('flex-wrap rounded-none [&>.main]:basis-[16rem]', off && 'off')}
      leading={<ProjectIcon name={s.project} small />}
      title={<span className={off ? 'text-muted-foreground' : undefined}>{s.title}</span>}
      meta={(
        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
          <span className="inline-flex items-center gap-1"><Repeat className="size-3.5" />{['daily', 'weekly', 'once'].includes(s.every) ? `${s.when} (${zoneName()})` : s.when}</span>
          <span>{s.project}</span>
          {s.readonly ? <Badge variant="secondary">{tr('schedules.readonlyBadge')}</Badge> : null}
          {!s.approved ? <Badge variant="warning">{tr('schedules.awaiting')}</Badge> : null}
          {off && s.approved && !spent(s) ? <Badge variant="secondary">{tr('schedules.pausedBadge')}</Badge> : null}
          {s.same_chat && s.conversation_id ? <Button variant="link" className="h-auto p-0 text-caption" onClick={() => go({ view: 'chat', id: s.conversation_id })} data-testid="schedule-open-chat"><MessageSquare className="size-3.5" />{tr('schedules.openChat')}</Button> : null}
        </span>
      )}
      trailing={<>
        <span className={cn('who flex w-[120px] flex-none items-center gap-1.5 text-control', off && 'text-muted-foreground')}><AgentIcon agent={s.agent} className="size-3.5" /><span className="truncate" title={`${AGENT[s.agent] ?? s.agent}${s.model ? ` · ${brain}` : ''}`}>{brain}</span></span>
        <span className="when text-muted-foreground flex w-[170px] flex-none flex-col gap-0.5 text-caption">
          <span>{next}</span>
          <span className={s.lastFailed ? 'text-destructive' : undefined}>{last ? <><TaskStatus plain task={last} />{lastDate ? ` · ${lastDate}` : ''}</> : s.last_task ? `#${s.last_task}${lastDate ? ` · ${lastDate}` : ''}` : tr('schedules.neverRun')}</span>
        </span>
        <div className="acts flex flex-none items-center gap-1.5">
          {!s.approved
            ? <><Button size="xs" onClick={() => act(call('schedules.update', { id: s.id, approve: true }), tr('schedules.approve.done')).then(load)} data-testid="schedule-approve"><Check />{tr('schedules.approve')}</Button>
              <BubbleTip title={tr('schedules.runNow')}><IconButton small label={tr('schedules.runNow')} onClick={run} data-testid="schedule-run"><Play /></IconButton></BubbleTip></>
            : <Button size="xs" variant="outline" onClick={run} data-testid="schedule-run"><Play />{tr('schedules.runNow')}</Button>}
          <BubbleTip title={tr('schedules.edit')}><IconButton small label={tr('schedules.edit')} onClick={async () => { if (await editSchedule(s)) { notifyOk(tr('schedules.edit.done')); load(); } }} data-testid="schedule-edit"><PencilLine /></IconButton></BubbleTip>
          {/* deleting a schedule is this PC's (src/domain/security/permissions.mjs). */}
          {bridge.mobile ? null : <BubbleTip title={tr('schedules.remove')}><IconButton small label={tr('schedules.remove')} onClick={() => removeSchedule(s, load, tr)} data-testid="schedule-remove"><Trash2 /></IconButton></BubbleTip>}
          {spent(s) ? null : s.approved
            ? <Switch checked={s.enabled} onCheckedChange={(enabled) => act(call('schedules.update', { id: s.id, enabled })).then(load)} aria-label={tr('schedules.enabled')} data-testid="schedule-switch" />
            : <BubbleTip title={tr('schedules.approveFirst')}><span><Switch checked={false} disabled aria-label={tr('schedules.enabled')} data-testid="schedule-switch" /></span></BubbleTip>}
        </div>
      </>} />
  );
}

function SchedulesPc() {
  const tr = useT();
  const version = useStore((s) => s.version);
  const tasks = useStore((s) => s.tasks) ?? [];
  const [list, setList] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [filter, setFilter] = useState('all');
  const load = () => call('schedules.list').then(setList).catch(() => setList([]));
  useEffect(() => { load(); }, [version]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { call('models.catalog').then(setCatalog).catch(() => setCatalog([])); }, []);
  const create = async () => { if (await newSchedule()) load(); };
  const rows = (list ?? []).map((s) => { const lastTask = tasks.find((x) => x.id === s.last_task) ?? null; return { ...s, lastTask, lastFailed: Boolean(lastTask && FAILED.includes(lastTask.status) && !lastTask.undone) }; });
  const count = (key) => rows.filter(FILTERS.find(([k]) => k === key)[1]).length;
  const shown = rows.filter(FILTERS.find(([k]) => k === filter)[1]);
  const failed = count('failed');
  const runs = tasks.filter((x) => x.schedule_id).sort((a, b) => b.id - a.id).slice(0, 5);
  const titleOf = (x) => (list ?? []).find((s) => s.id === x.schedule_id)?.title ?? x.title;
  return (
    <>
      <PageHeader title={tr('schedules.title')} meta={list ? tr(failed ? 'schedules.subFail' : 'schedules.sub', { total: list.length, active: list.filter((s) => s.enabled).length, failed }) : tr('schedules.meta')}>
        <BarPause />
        <NotificationBell />
        <DropdownMenu modal={false}>
          <BubbleTip title={tr('nav.more')}><DropdownMenuTrigger asChild><MoreButton label={tr('nav.more')} data-testid="schedules-more" /></DropdownMenuTrigger></BubbleTip>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onSelect={() => { refresh(); load(); }}><RefreshCw />{tr('schedules.refresh')}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => go('tasks')}><ClipboardCheck />{tr('schedules.seeTasks')}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </PageHeader>
      <PageBody>
        <div className="mx-auto grid w-full max-w-[1100px] gap-4">
          <p className="text-muted-foreground m-0 text-control">{tr('schedules.note')}</p>
          {list && !list.length ? (
            <Empty icon={CalendarSync} title={tr('schedules.empty.title')}>{tr('schedules.empty.hint')}<div className="mt-3"><Button onClick={create} data-testid="new-schedule">{tr('schedules.newLong')}</Button></div></Empty>
          ) : list ? (
            <>
              <div className="toolbar flex flex-wrap items-center gap-1.5">
                <Segmented aria-label={tr('schedules.filter.label')} value={filter} onChange={setFilter} options={FILTERS.map(([key]) => ({ value: key, label: tr(`schedules.filter.${key}`), count: count(key), testid: `schedule-filter-${key}` }))} />
                <span className="grow" />
                <Button onClick={create} data-testid="new-schedule"><Plus />{tr('schedules.newLong')}</Button>
              </div>
              <div>
                <div className="colh text-faint-foreground hidden gap-3 px-3.5 pb-2 text-micro font-semibold tracking-wider uppercase xl:flex" aria-hidden="true">
                  <span className="flex-1">{tr('schedules.col.what')}</span><span className="w-[120px]">{tr('schedules.col.agent')}</span><span className="w-[170px]">{tr('schedules.col.next')}</span><span className="w-[300px] text-right">{tr('schedules.col.active')}</span>
                </div>
                <ListCard data-testid="schedules-list">
                  {shown.length ? shown.map((s) => <ScheduleRow key={s.id} s={s} load={load} catalog={catalog} />) : <Empty icon={CalendarSync} title={tr('schedules.empty.filtered')} />}
                </ListCard>
              </div>
              {runs.length ? (
                <div className="grid gap-3">
                  <SectionLabel className="flex items-baseline gap-2 px-0 pt-2 pb-0"><h2 className="m-0 text-[length:inherit] font-[inherit]">{tr('schedules.lastRuns')}</h2><span className="text-faint-foreground text-caption font-normal">{tr('schedules.lastRunsSub')}</span><span className="grow" /><Button variant="link" className="h-auto p-0 text-control font-normal" onClick={() => go('tasks')}>{tr('schedules.seeTasks')}</Button></SectionLabel>
                  <ListCard data-testid="schedule-runs">
                    {runs.map((x) => (
                      <ListRow key={x.id} className="rounded-none" leading={<TaskStatus task={x} />} title={titleOf(x)} meta={<span>{String(x.result ?? '').split('\n').find((l) => l.trim()) || `#${x.id} · ${x.project}`}</span>}
                        trailing={<>
                          {canRetryFromRow(x) ? <RetryRun id={x.id} /> : null}
                          <span className="text-faint-foreground text-caption">{ago(x.updated_at ?? x.created_at)}</span>
                        </>} />
                    ))}
                  </ListCard>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </PageBody>
    </>
  );
}

function SchedulesLegacy() {
  const t = useT();
  const version = useStore((s) => s.version);
  const [list, setList] = useState(null);
  const load = () => call('schedules.list').then(setList).catch(() => setList([]));
  useEffect(() => { load(); }, [version]); // eslint-disable-line react-hooks/exhaustive-deps
  const create = async () => { if (await newSchedule()) load(); };
  return (
    <>
      <PageHeader icon={<CalendarSync className="text-primary-text size-5" />} title={t('schedules.title')} meta={list ? t('schedules.sub', { total: list.length, active: list.filter((s) => s.enabled).length }) : t('schedules.meta')}>
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
                  <div className="text-muted-foreground mt-0.5 text-xs">{t('schedules.nextLine', { when: s.when, project: s.project, next: s.enabled && s.approved ? when(s.next_run) : spent(s) ? t('schedules.spent') : t('schedules.paused') })}{s.last_task ? <>{t('schedules.last')}<a className="cursor-pointer underline-offset-2 hover:underline" onClick={() => go({ view: 'tasks', id: s.last_task })}>#{s.last_task}</a></> : null}</div>
                  <p className="text-muted-foreground mt-1.5 line-clamp-2 text-control">{s.description}</p>
                  {s.same_chat && s.conversation_id ? <Button size="sm" variant="ghost" className="mt-1 -ml-2" onClick={() => go({ view: 'chat', id: s.conversation_id })} data-testid="schedule-open-chat"><MessageSquare />{t('schedules.openChat')}</Button> : null}
                </div>
                <div className="flex items-center gap-2">
                  {!s.approved ? <Button size="sm" onClick={() => act(call('schedules.update', { id: s.id, approve: true }), t('schedules.approve.done')).then(load)}><Check />{t('schedules.approve')}</Button>
                    : spent(s) ? null : <Switch checked={s.enabled} onCheckedChange={(enabled) => act(call('schedules.update', { id: s.id, enabled })).then(load)} aria-label={t('schedules.enabled')} />}
                  <BubbleTip title={t('schedules.runNow')}><Button size="icon-sm" variant="ghost" aria-label={t('schedules.runNow')} onClick={() => act(call('schedules.run', { id: s.id }), t('schedules.run.done')).then(load)}><Play /></Button></BubbleTip>
                  {/* deleting a schedule is this PC's (src/domain/security/permissions.mjs). */}
                  {bridge.mobile ? null : <BubbleTip title={t('schedules.remove')}><Button size="icon-sm" variant="danger" aria-label={t('schedules.remove')} onClick={() => removeSchedule(s, load, t)}><Trash2 /></Button></BubbleTip>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </PageBody>
    </>
  );
}

export function SchedulesView() {
  return fullPc() ? <SchedulesPc /> : <SchedulesLegacy />;
}

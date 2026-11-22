// Programadas: tasks that repeat on their own ("cada lunes a las 9 revisa las dependencias"). Each run is a normal task
// (same approvals, quota and agents); one the assistant proposed needs your approval once before it runs by itself.
// «Una sola vez» (a date and time; it turns off after running) and «Ejecutar siempre en el mismo chat».
// The PC app draws the mock-up's list (filters, columns, last runs); the phone and a computer's browser linked with an Orb
// keep the card layout.
import { useEffect, useState } from 'react';
import { CalendarSync, CalendarClock, Plus, Play, Trash2, Check, MessageSquare, PencilLine, Repeat, RefreshCw, ClipboardCheck, RotateCcw, LoaderCircle } from 'lucide-react';
import { PageHeader, PageBody } from '@/components/page.jsx';
import { AgentIcon } from '@/components/agent-icon.jsx';
import { ProjectIcon } from '@/components/project-icon.jsx';
import { NotificationBell } from '@/components/notification-center.jsx';
import { BarPause } from '@/components/conversation/bar.jsx';
import { TaskStatus } from '@/components/task-state.jsx';
import { confirm } from '@/components/dialogs.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent, Badge, Field, Input, Textarea, Empty } from '@/components/ui/basic.jsx';
import { Select, Switch, BubbleTip, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, Dialog, DialogContent, DialogHeader, DialogBody, DialogFooter, DialogTitle, DialogDescription } from '@/components/ui/overlay.jsx';
import { MoreButton, IconButton, ListCard, ListRow, Segmented, SectionLabel, FieldError } from '@/components/ui/primitives.jsx';
import { notifyError, notifyOk } from '@/lib/notify.js';
import { useStore, call, act, go, getState, bridge, fullPc, refresh } from '@/lib/store.js';
import { AGENT } from '@/lib/labels.js';
import { activityPlain } from '@/lib/activity.js';
import { modelsOf } from '@/components/brain-picker.jsx';
import { canRetryFromRow } from './tasks.jsx';
import { ago, cn, errorText } from '@/lib/utils.js';
import { nextLocalRun, isValidTz } from '../../shared/tz.mjs';
import { zoneLabel, whenLabel } from '@/lib/zone-label.js';
import { t, useT, currentLocale } from '@/lib/i18n.js';

const EVERY = ['hourly', 'daily', 'weekly', 'monthly', 'once'];
// Tomorrow at 9:00, as a datetime-local value (the first value of «Una sola vez»).
const tomorrowAt9 = () => { const d = new Date(); d.setDate(d.getDate() + 1); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T09:00`; };
const DAYS = [1, 2, 3, 4, 5, 6, 0];
const when = (iso) => (iso ? new Date(iso).toLocaleString(currentLocale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const dayName = (d) => new Date(2024, 0, 7 + d).toLocaleDateString(currentLocale(), { weekday: 'long' });

// The zone the engine reads the wall time in when a schedule names none: the owner's (Ajustes' tz) or, without one, this PC's.
const PC_ZONE = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };
function zoneName() {
  const z = getState().app?.config?.tz;
  if (z && isValidTz(z)) return z;
  return PC_ZONE();
}
// The zone of a schedule: its own, else Orb's.
const zoneOf = (s) => (s?.tz && isValidTz(s.tz) ? s.tz : zoneName());
const clock = (hhmm) => { const [h, m] = String(hhmm || '09:00').split(':'); return `${Number(h)}:${m ?? '00'}`; };
const dayDate = (d, timeZone) => { const text = d.toLocaleDateString(currentLocale(), { weekday: 'long', day: 'numeric', month: 'long', timeZone }); return currentLocale().startsWith('es') ? text.replace(',', '') : text; };
const monthDayOf = (v) => Math.min(31, Math.max(1, Number(v.month_day) || 1));

// The next run of what the dialog describes, worked out by the engine's own rule in the chosen zone (daylight-saving included).
function nextOccurrence(v, tz, from = new Date()) {
  const rule = { every: v.every, time: v.at_time || '09:00', weekdays: v.every === 'weekly' ? (v.weekdays.length ? v.weekdays : [1]) : [], ...(v.every === 'monthly' ? { start: `2000-01-${String(monthDayOf(v)).padStart(2, '0')}T00:00` } : {}) };
  try { return nextLocalRun(rule, tz, from.getTime()); } catch { return null; }
}

// What the chosen frequency means, as the dialog's summary: «Cada lunes a las 9:00 (Europe/Madrid). Próxima: lunes 16 de noviembre.»
function summary(v) {
  const zone = v.tz || zoneName();
  const tz = zoneLabel(zone, currentLocale());
  // a «once» date is a wall time in the chosen zone: it is written out as typed, never moved to this PC's zone
  if (v.every === 'once') return t('schedules.sum.once', { when: v.at_date ? new Date(`${v.at_date}:00Z`).toLocaleString(currentLocale(), { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) : '—', tz });
  if (v.every === 'hourly') return t('schedules.sum.hourly');
  if (v.every === 'every_hours') return t('schedules.sum.hours', { n: Number(v.hours) || 6 });
  const next = nextOccurrence(v, zone);
  const tail = next ? t('schedules.sum.next', { when: dayDate(next, zone) }) : '';
  if (v.every === 'daily') return t('schedules.sum.daily', { time: clock(v.at_time), tz }) + tail;
  if (v.every === 'monthly') return t('schedules.sum.monthly', { day: monthDayOf(v), time: clock(v.at_time), tz }) + tail;
  const names = (v.weekdays.length ? DAYS.filter((d) => v.weekdays.includes(d)) : [1]).map(dayName);
  return t('schedules.sum.weekly', { days: typeof Intl.ListFormat === 'function' ? new Intl.ListFormat(currentLocale(), { style: 'long', type: 'conjunction' }).format(names) : names.join(', '), time: clock(v.at_time), tz }) + tail;
}

// The zones the runtime knows, each with its offset now («Europe/Madrid (UTC+1)»); built once.
const ORB_ZONE = '__orb';
let zoneList = null;
function zoneOptions() {
  if (zoneList) return zoneList;
  let names = [];
  try { names = Intl.supportedValuesOf('timeZone'); } catch { /* an older runtime: only the zones a schedule already has */ }
  if (!names.includes('UTC')) names = ['UTC', ...names];
  const offset = (z) => { try { const o = new Intl.DateTimeFormat('en', { timeZone: z, timeZoneName: 'shortOffset' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value ?? ''; return o === 'GMT' ? 'UTC' : o.replace('GMT', 'UTC'); } catch { return ''; } };
  zoneList = names.map((z) => ({ value: z, label: `${zoneLabel(z, currentLocale())} (${offset(z)})` }));
  return zoneList;
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

// The values the dialog starts from: a new schedule's defaults, or what an existing one has.
function initialValues(s, preset, list, app) {
  return {
    project: s?.project ?? preset.project ?? app?.activeProject?.name ?? list[0].name,
    title: s?.title ?? '', description: s?.description ?? '',
    brain: s ? (s.model ? `${s.agent}::${s.model}` : s.agent) : 'any',
    every: s?.every ?? 'weekly',
    at_time: s && !['once', 'every_hours'].includes(s.every) ? s.at_time || '09:00' : '09:00',
    at_date: s?.every === 'once' ? s.at_time : tomorrowAt9(),
    weekdays: s?.weekdays?.length ? s.weekdays : [1],
    hours: s?.every === 'every_hours' ? Number(s.at_time) || 6 : 6,
    month_day: s?.month_day ?? 1,
    tz: s?.tz ?? '',
    readonly: Boolean(s?.readonly), same_chat: Boolean(s?.same_chat), notify: s ? Boolean(s.notify_mobile) : true,
    autonomy: s?.autonomy === 'preguntar' ? 'preguntar' : 'auto'
  };
}

// «Nueva programada» and «Editar programada»: one dialog. Editing shows «Cambios sin guardar», asks before throwing them
// away and offers «Ejecutar ahora». What the mock-up does not draw (every N hours, the same chat) is under «Más opciones».
function ScheduleDialog({ schedule = null, preset = {}, onDone }) {
  const tr = useT();
  const editing = Boolean(schedule);
  const { projects, app } = getState();
  const list = projects ?? [];
  const [first] = useState(() => initialValues(schedule, preset, list, app));
  const [v, setV] = useState(first);
  // The fingerprint of the schedule as this dialog last saw it (opened or saved): «Ejecutar ahora» sends it, never a fresh read.
  const [seenHash, setSeenHash] = useState(schedule?.previewHash);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(() => first.every === 'every_hours' || first.same_chat);
  const [catalog, setCatalog] = useState([]);
  useEffect(() => { call('models.catalog').then(setCatalog).catch(() => setCatalog([])); }, []);
  const set = (patch) => { setError(null); setV((x) => ({ ...x, ...patch })); };
  // a new schedule with a title or description typed is also worth asking about before it is thrown away
  const dirty = editing ? JSON.stringify(v) !== JSON.stringify(first) : Boolean(v.title.trim() || v.description.trim());
  // only the agents this PC can run (the engine refuses a schedule for another one).
  const agents = app?.agentsAvailable ?? Object.keys(app?.config?.agents ?? {});
  // the agent and its model in one list: «Claude Code · Sonnet 5.5»; the value is «agent» or «agent::model» (split again on save).
  const brains = (() => {
    const out = [{ value: 'any', label: tr('schedules.anyQuota') }, ...agents.flatMap((a) => {
      const icon = <AgentIcon agent={a} className="size-3.5" />;
      const own = modelsOf(catalog.find((c) => c.id === a), null).filter((m) => m.id);
      // the agent alone comes first: its model is then Orb's choice at each run (a schedule is not tied to one model for good)
      return [{ value: a, label: AGENT[a] ?? a, icon }, ...own.map((m) => ({ value: `${a}::${m.id}`, label: `${AGENT[a] ?? a} · ${m.label}`, icon }))];
    })];
    // a schedule made for an agent that is not on this PC now keeps showing its own choice
    if (!out.some((o) => o.value === v.brain)) { const [a, m] = v.brain.split('::'); out.push({ value: v.brain, label: tr('schedules.agentGone', { agent: `${AGENT[a] ?? a}${m ? ` · ${m}` : ''}` }) }); }
    return out;
  })();
  // the default entry reads as the zone it stands for, like the others; the stored value stays '' (Orb's zone) or the IANA name
  const zones = (() => { const named = zoneOptions(); const mine = named.find((o) => o.value === zoneName()); const own = [{ value: ORB_ZONE, label: mine?.label ?? zoneLabel(zoneName(), currentLocale()) }, ...named.filter((o) => o.value !== zoneName())]; return v.tz && !own.some((o) => o.value === v.tz) ? [...own, { value: v.tz, label: zoneLabel(v.tz, currentLocale()) }] : own; })();
  // the same number the engine waits (0 = no limit when the rail is paused)
  const wait = Number(app?.approvalWaitMinutes ?? 10);
  const level = tr(app?.config?.permissions?.mode === 'preguntar' ? 'session.askMode' : 'session.autoMode');

  const requestClose = async () => {
    if (dirty && !(await confirm(tr('schedules.discard.title'), tr('schedules.discard.body', { title: v.title.trim() || schedule?.title || tr('schedules.new.title') }), { ok: tr('schedules.discard.ok'), cancel: tr('schedules.discard.keep'), danger: true }))) return;
    onDone(false);
  };
  const changed = (...keys) => keys.some((k) => JSON.stringify(v[k]) !== JSON.stringify(first[k]));
  // On create, everything. On edit, only what changed (the timing as a whole): a schedule whose «once» date has passed can
  // still be renamed.
  const request = () => {
    const [agent, model] = v.brain.split('::');
    const once = v.every === 'once';
    const all = { project: v.project, title: v.title.trim(), description: v.description.trim(), agent, model: model || null, readonly: v.readonly, every: v.every, at_time: once ? v.at_date : v.at_time,
      weekdays: v.weekdays, hours: Number(v.hours) || 6, month_day: monthDayOf(v), tz: v.tz || null, same_chat: !once && v.same_chat, notify_mobile: v.notify,
      // the permission level is chosen on this PC's window; the phone's page does not draw it
      ...(bridge.mobile ? {} : { autonomy: v.autonomy === 'preguntar' ? 'preguntar' : 'auto' }) };
    if (!editing) return { method: 'schedules.create', params: { ...all, model: model || undefined, tz: all.tz || undefined } };
    const groups = [[['project'], ['project']], [['title'], ['title']], [['description'], ['description']], [['brain'], ['agent', 'model']], [['readonly'], ['readonly']], [['same_chat', 'every'], ['same_chat']], [['notify'], ['notify_mobile']], [['autonomy'], ['autonomy']],
      [['every', 'at_time', 'at_date', 'weekdays', 'hours', 'month_day', 'tz'], ['every', 'at_time', 'weekdays', 'hours', 'month_day', 'tz']]];
    const params = { id: schedule.id };
    for (const [watch, send] of groups) if (changed(...watch)) for (const k of send) if (k in all) params[k] = all[k];
    return { method: 'schedules.update', params };
  };
  const submit = async (e) => {
    e?.preventDefault();
    setError(null);
    if (!v.title.trim() || !v.description.trim()) { setError(tr('schedules.edit.empty')); return; }
    setBusy(true);
    try {
      const { method, params } = request();
      if (!editing || Object.keys(params).length > 1) { const saved = await call(method, params); if (saved?.previewHash) setSeenHash(saved.previewHash); }
      if (editing) notifyOk(tr('schedules.edit.done'));
      onDone(true);
    } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  };
  // «Ejecutar ahora» runs what is saved: with unsaved changes it says so first.
  const runNow = async () => {
    if (dirty && !(await confirm(tr('schedules.runDirty.title'), tr('schedules.runDirty.body'), { ok: tr('schedules.runNow'), tone: 'primary' }))) return;
    await act(call('schedules.run', { id: schedule.id, hash: seenHash }), tr('schedules.run.done'));
  };
  const zoneField = (
    <Field label={tr('schedules.tz')}>
      <Select caret="solid" className="w-full" title={tr('schedules.tzHint')} value={v.tz || ORB_ZONE} onValueChange={(z) => set({ tz: z === ORB_ZONE ? '' : z })} options={zones} data-testid="schedule-tz" />
    </Field>
  );
  const timeField = <Field label={tr('schedules.time')}><Input type="time" className="[&::-webkit-calendar-picker-indicator]:hidden" value={v.at_time} onChange={(e) => set({ at_time: e.target.value })} data-testid="schedule-time" /></Field>;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) requestClose(); }}>
      <DialogContent className="max-h-[calc(100vh-50px)] grid-rows-[minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-2xl" data-testid="schedule-dialog">
        <form onSubmit={submit} className="flex max-h-[inherit] min-h-0 flex-col">
          <DialogHeader className="flex-none">
            <div className="flex items-center gap-2"><DialogTitle>{tr(editing ? 'schedules.edit.title' : 'schedules.new.title')}</DialogTitle>{dirty ? <Badge variant="warning" data-testid="schedule-unsaved">{tr('schedules.unsaved')}</Badge> : null}</div>
            <DialogDescription className="sr-only">{tr(editing ? 'schedules.edit.title' : 'schedules.new.title')}</DialogDescription>
          </DialogHeader>
          {/* the scrollbar takes its gutter out of the right padding, so the fields end 18 px from the edge as in the mock-up */}
          <DialogBody className="flex flex-col gap-4 p-[18px] pr-[calc(18px-var(--sb-w))] [scrollbar-gutter:stable] [&>*]:shrink-0 [&_label]:font-normal">
            <Field label={tr(editing ? 'schedules.edit.name' : 'schedules.titleField')}><Input autoFocus value={v.title} onChange={(e) => set({ title: e.target.value })} maxLength={120} placeholder={tr('schedules.titlePh')} data-testid={editing ? 'schedule-edit-title' : 'schedule-title'} /></Field>
            <Field label={tr(editing ? 'schedules.edit.what' : 'schedules.what')} hint={tr('schedules.whatNote', { assistant: app?.config?.assistantName })}><Textarea className="min-h-20" rows={editing ? 5 : 4} value={v.description} onChange={(e) => set({ description: e.target.value })} placeholder={tr('schedules.whatHint')} data-testid={editing ? 'schedule-edit-description' : 'schedule-description'} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={tr('schedules.project')}><Select caret="solid" className="w-full" value={v.project} onValueChange={(project) => set({ project })} options={list.map((p) => ({ value: p.name, label: p.name, icon: <ProjectIcon name={p.name} small /> }))} data-testid="schedule-project" /></Field>
              <Field label={tr('schedules.agentModel')}><Select caret="solid" className="w-full" value={v.brain} onValueChange={(brain) => set({ brain })} options={brains} data-testid="schedule-brain" /></Field>
            </div>
            <Field label={tr('schedules.frequency')}><Segmented className="justify-self-start" aria-label={tr('schedules.frequency')} value={v.every} onChange={(every) => set({ every })} itemTestId={(k) => `schedule-every-${k}`} options={EVERY.map((value) => ({ value, label: tr(`schedules.every.${value}`) }))} /></Field>
            {v.every === 'weekly' ? (
              <Field label={tr('schedules.daysField')}>
                <div className="flex flex-wrap gap-1">{DAYS.map((d) => <Button key={d} type="button" size="icon-sm" variant={v.weekdays.includes(d) ? 'default' : 'outline'} aria-pressed={v.weekdays.includes(d)} aria-label={dayName(d)} onClick={() => set({ weekdays: v.weekdays.includes(d) ? v.weekdays.filter((x) => x !== d) : [...v.weekdays, d] })}>{tr(`schedules.days.${d}`)}</Button>)}</div>
              </Field>
            ) : null}
            {v.every === 'once' ? (
              <div className="grid grid-cols-2 gap-3">
                <Field label={tr('schedules.dateTime')}><Input type="datetime-local" value={v.at_date} onChange={(e) => set({ at_date: e.target.value })} data-testid="schedule-at-date" /></Field>
                {zoneField}
              </div>
            ) : v.every === 'monthly' ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={tr('schedules.monthDay')} hint={tr('schedules.monthDayHint')}><Input type="number" min={1} max={31} value={v.month_day} onChange={(e) => set({ month_day: e.target.value })} data-testid="schedule-month-day" /></Field>
                  {timeField}
                </div>
                {zoneField}
              </>
            ) : v.every === 'daily' || v.every === 'weekly' ? <div className="grid grid-cols-2 gap-3">{timeField}{zoneField}</div> : null}
            <div className="bg-primary-soft text-primary-text flex items-center gap-2 rounded-card px-2.5 py-2 text-control" data-testid="schedule-summary"><CalendarClock className="size-3.5 shrink-0" />{summary(v)}</div>
            <ListCard>
              <SwitchRow label={tr('schedules.readonlyLab')} hint={tr('schedules.readonlyHint')} checked={v.readonly} onChange={(c) => set({ readonly: c === true })} testid="schedule-readonly" />
              {/* the level of the runs: only this PC's window sets it (the engine ignores a phone loosening it) */}
              {bridge.mobile ? null : (
                <div className="border-border flex items-center gap-3 border-t px-3.5 py-3" data-testid="schedule-permissions">
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5"><b className="text-control font-medium">{tr('schedules.perm')}</b><span className="text-muted-foreground text-caption">{tr(wait > 0 ? 'schedules.permHint' : 'schedules.permHintNoWait', { min: wait })}</span></span>
                  <Select caret="solid" className="max-w-[18rem]" value={v.autonomy} onValueChange={(autonomy) => set({ autonomy })} data-testid="schedule-permission"
                    options={[{ value: 'auto', label: tr('schedules.perm.auto', { level }) }, { value: 'preguntar', label: tr('schedules.perm.ask') }]} />
                </div>
              )}
              <SwitchRow label={tr('schedules.notifyLab')} hint={tr('schedules.notifyHint')} checked={v.notify} onChange={(c) => set({ notify: c === true })} testid="schedule-notify" />
            </ListCard>
            <details className="border-border rounded-(--r-md) border px-3 py-2" data-testid="schedule-more-options" open={more} onToggle={(e) => setMore(e.currentTarget.open)}>
              <summary className="text-muted-foreground cursor-pointer text-control">{tr('schedules.moreOptions')}</summary>
              <div className="mt-2">
                <ListCard>
                  <SwitchRow label={tr('schedules.every.every_hours')} hint={tr('schedules.everyHoursHint')} checked={v.every === 'every_hours'} onChange={(c) => set({ every: c === true ? 'every_hours' : 'daily' })} testid="schedule-every-hours" />
                  {v.every === 'every_hours' ? <div className="border-border border-t px-3.5 py-3"><Field label={tr('schedules.everyHours')}><Input type="number" min={1} max={168} value={v.hours} onChange={(e) => set({ hours: e.target.value })} data-testid="schedule-hours" /></Field></div> : null}
                  {v.every === 'once' ? null : <SwitchRow label={tr('schedules.sameChat')} hint={tr('schedules.sameChatHint')} checked={v.same_chat} onChange={(c) => set({ same_chat: c === true })} testid="schedule-same-chat" />}
                </ListCard>
              </div>
            </details>
            <FieldError>{error}</FieldError>
          </DialogBody>
          <DialogFooter className="flex-none">
            <Button type="button" variant="outline" onClick={requestClose} data-testid="schedule-cancel">{tr('comp.dialogs.cancel')}</Button>
            {editing ? <Button type="button" variant="outline" onClick={runNow} data-testid="schedule-dialog-run"><Play />{tr('schedules.runNow')}</Button> : null}
            <Button type="submit" disabled={busy} aria-busy={busy} data-testid="schedule-save">{busy ? <LoaderCircle className="animate-spin" /> : null}{tr(editing ? 'schedules.edit.ok' : 'schedules.new.ok')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Opens the dialog for a new schedule (open()) or for one that exists (open(schedule)); `node` goes in the view's tree.
function useScheduleDialog(load) {
  const [dialog, setDialog] = useState(null);
  const open = (schedule = null, preset = {}) => {
    if (!(getState().projects ?? []).length) { notifyError(t('schedules.noProject')); return; }
    setDialog({ schedule, preset, key: `${schedule?.id ?? 'new'}-${Date.now()}` });
  };
  const node = dialog ? <ScheduleDialog key={dialog.key} schedule={dialog.schedule} preset={dialog.preset} onDone={(saved) => { setDialog(null); if (saved) load(); }} /> : null;
  return [open, node];
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

function ScheduleRow({ s, load, catalog, onEdit }) {
  const tr = useT();
  // the model by its name («Sonnet 5.5»), else the agent's
  const brain = (s.model && modelsOf(catalog?.find((c) => c.id === s.agent), null).find((m) => m.id === s.model)?.label) || s.model || AGENT[s.agent] || s.agent;
  const off = !s.enabled;
  const last = s.lastTask;
  const next = s.enabled && s.approved ? when(s.next_run) : spent(s) ? tr('schedules.spent') : tr('schedules.pausedBadge');
  const lastDate = s.last_run ? new Date(s.last_run).toLocaleString(currentLocale(), { day: 'numeric', month: 'short' }) : null;
  const run = () => act(call('schedules.run', { id: s.id, hash: s.previewHash }), tr('schedules.run.done')).then(load);
  return (
    <ListRow data-testid="schedule-row" className={cn('flex-wrap rounded-none [&>.main]:basis-[16rem]', off && 'off')}
      leading={<ProjectIcon name={s.project} small />}
      title={<span className={off ? 'text-muted-foreground' : undefined}>{s.title}</span>}
      meta={(
        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
          <span className="inline-flex items-center gap-1"><Repeat className="size-3.5" />{['daily', 'weekly', 'monthly', 'once'].includes(s.every) ? `${whenLabel(s.when)} (${zoneLabel(zoneOf(s), currentLocale())})` : whenLabel(s.when)}</span>
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
            ? <><Button size="xs" onClick={() => act(call('schedules.update', { id: s.id, approve: true, hash: s.previewHash }), tr('schedules.approve.done')).then(load)} data-testid="schedule-approve"><Check />{tr('schedules.approve')}</Button>
              <BubbleTip title={tr('schedules.runNow')}><IconButton small label={tr('schedules.runNow')} onClick={run} data-testid="schedule-run"><Play /></IconButton></BubbleTip></>
            : <Button size="xs" variant="outline" onClick={run} data-testid="schedule-run"><Play />{tr('schedules.runNow')}</Button>}
          <BubbleTip title={tr('schedules.edit')}><IconButton small label={tr('schedules.edit')} onClick={() => onEdit(s)} data-testid="schedule-edit"><PencilLine /></IconButton></BubbleTip>
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
  const [openDialog, dialogNode] = useScheduleDialog(load);
  const create = () => openDialog();
  const rows = (list ?? []).map((s) => { const lastTask = tasks.find((x) => x.id === s.last_task) ?? null; return { ...s, lastTask, lastFailed: Boolean(lastTask && FAILED.includes(lastTask.status) && !lastTask.undone) }; });
  const count = (key) => rows.filter(FILTERS.find(([k]) => k === key)[1]).length;
  const shown = rows.filter(FILTERS.find(([k]) => k === filter)[1]);
  const failed = count('failed');
  const runs = tasks.filter((x) => x.schedule_id).sort((a, b) => b.id - a.id).slice(0, 5);
  // The list of tasks comes without their texts: the first line of each run's result is read from its detail, once per state.
  const [results, setResults] = useState({});
  const runsKey = runs.map((x) => `${x.id}:${x.status}:${x.updated_at}`).join('|');
  useEffect(() => {
    let alive = true;
    for (const x of runs) {
      const key = `${x.id}:${x.status}:${x.updated_at}`;
      if (results[key] !== undefined) continue;
      call('tasks.get', { id: x.id }).then((d) => { if (alive) setResults((r) => ({ ...r, [key]: String(d?.result ?? '').split('\n').find((l) => l.trim()) ?? '' })); }, () => {});
    }
    return () => { alive = false; };
  }, [runsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const resultOf = (x) => results[`${x.id}:${x.status}:${x.updated_at}`] || '';
  const titleOf = (x) => (list ?? []).find((s) => s.id === x.schedule_id)?.title ?? x.title;
  return (
    <>
      {dialogNode}
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
                  {shown.length ? shown.map((s) => <ScheduleRow key={s.id} s={s} load={load} catalog={catalog} onEdit={openDialog} />) : <Empty icon={CalendarSync} title={tr('schedules.empty.filtered')} />}
                </ListCard>
              </div>
              {runs.length ? (
                <div className="grid gap-3">
                  <SectionLabel className="flex items-baseline gap-2 px-0 pt-2 pb-0"><h2 className="m-0 text-[length:inherit] font-[inherit]">{tr('schedules.lastRuns')}</h2><span className="text-faint-foreground text-caption font-normal">{tr('schedules.lastRunsSub')}</span><span className="grow" /><Button variant="link" className="text-info h-auto p-0 text-control font-normal" onClick={() => go('tasks')}>{tr('schedules.seeTasks')}</Button></SectionLabel>
                  <ListCard data-testid="schedule-runs">
                    {runs.map((x) => (
                      <ListRow key={x.id} className="rounded-none" leading={<TaskStatus task={x} />} title={titleOf(x)} meta={<span title={resultOf(x) || undefined}>{resultOf(x) ? activityPlain(tr, resultOf(x), 140, AGENT) : `#${x.id} · ${x.project}`}</span>}
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
  const [openDialog, dialogNode] = useScheduleDialog(load);
  const create = () => openDialog();
  return (
    <>
      {dialogNode}
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
                  {!s.approved ? <Button size="sm" onClick={() => act(call('schedules.update', { id: s.id, approve: true, hash: s.previewHash }), t('schedules.approve.done')).then(load)}><Check />{t('schedules.approve')}</Button>
                    : spent(s) ? null : <Switch checked={s.enabled} onCheckedChange={(enabled) => act(call('schedules.update', { id: s.id, enabled })).then(load)} aria-label={t('schedules.enabled')} />}
                  <BubbleTip title={t('schedules.runNow')}><Button size="icon-sm" variant="ghost" aria-label={t('schedules.runNow')} onClick={() => act(call('schedules.run', { id: s.id, hash: s.previewHash }), t('schedules.run.done')).then(load)}><Play /></Button></BubbleTip>
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

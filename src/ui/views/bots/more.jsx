// 3.5: the other screens of the Bots mode: Grupos, Recordatorios, Memoria, Casa, Servidor and Ajustes de bots.
import { useEffect, useMemo, useState } from 'react';
import { Users, Plus, Pencil, Trash2, MessageSquare, Bell, X, BookOpen, Home, Server, Settings2, RefreshCw, Cpu, MemoryStick, HardDrive, Container, AlertTriangle, Save } from 'lucide-react';
import { PageHeader } from '@/components/page.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Badge, Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter, Field, Input, Textarea, Empty } from '@/components/ui/basic.jsx';
import { Checkbox, Select } from '@/components/ui/overlay.jsx';
import { confirm, form } from '@/components/dialogs.jsx';
import { useStore, botCall, call, act, go, bridge, loadBots, setState, getState, onBotEvent } from '@/lib/store.js';
import { EMOJIS, localWhen } from '@/lib/bots.js';
import { cn, errorText } from '@/lib/utils.js';
import { useT, useLocale } from '@/lib/i18n.js';
import { useBots, useCanManage, BotFace, NoBots, BotsDown, Loading, BotPage, CentroBadge } from './common.jsx';

// What a screen loads from the bots (read again with «Actualizar» and when a bot changes).
function useLoad(method, params, deps = []) {
  const version = useStore((s) => s.version);
  const [state, set] = useState({ data: null, error: null, loading: true });
  const load = () => { set((s) => ({ ...s, loading: true })); return botCall(method, params).then((data) => set({ data, error: null, loading: false })).catch((e) => set({ data: null, error: errorText(e), loading: false })); };
  useEffect(() => { load(); return onBotEvent('bot.updated', () => load()); }, [version, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...state, reload: load };
}

// ---- Grupos
export function BotGroupsView() {
  const t = useT();
  const { bots, groups, loaded, error } = useBots();
  const manage = useCanManage();
  const byId = useMemo(() => new Map(bots.map((b) => [b.id, b])), [bots]);
  const edit = (g) => form(g ? t('bots.groups.edit') : t('bots.groups.new'), {
    initial: { name: g?.name ?? '', icon: g?.icon ?? '👥', members: g?.members ?? [] },
    body: (v, set) => (<>
      <div className="flex gap-3">
        <Field label={t('bots.f.icon')}><Select value={v.icon || '👥'} onValueChange={(icon) => set({ icon })} options={['👥', ...EMOJIS].map((e) => ({ value: e, label: e }))} /></Field>
        <Field label={t('bots.f.name')} className="flex-1"><Input autoFocus value={v.name} maxLength={40} onChange={(e) => set({ name: e.target.value })} placeholder={t('bots.groups.namePh')} data-testid="group-name" /></Field>
      </div>
      <Field label={t('bots.groups.members')}>
        <div className="grid gap-1">{bots.map((b) => <label key={b.id} className="flex cursor-pointer items-center gap-2 text-sm"><Checkbox checked={v.members.includes(b.id)} onCheckedChange={(on) => set({ members: on ? [...v.members, b.id] : v.members.filter((x) => x !== b.id) })} /><BotFace bot={b} size="sm" />{b.name}</label>)}</div>
      </Field>
    </>),
    ok: t('bots.save'),
    onOk: async (v) => { await botCall(g ? 'bots.groups.update' : 'bots.groups.create', { ...(g ? { id: g.id } : {}), name: v.name.trim(), icon: v.icon, members: v.members }); await loadBots(); return true; }
  });
  const remove = async (g) => { if (await confirm(t('bots.groups.deleteTitle', { name: g.name }), t('bots.groups.deleteBody'), { ok: t('bots.delete'), danger: true })) { await act(botCall('bots.groups.delete', { id: g.id })); loadBots(); } };
  return (
    <>
      <PageHeader icon={<Users className="text-primary size-5" />} title={t('nav.botGroups')} meta={t('bots.groups.hint')}>
        {manage && bots.length ? <Button size="sm" onClick={() => edit(null)} data-testid="group-new"><Plus />{t('bots.groups.new')}</Button> : null}
      </PageHeader>
      {!loaded ? (error ? <BotsDown error={error} /> : <Loading />) : !bots.length ? <NoBots /> : (
        <BotPage>
          {!groups.length ? <Empty icon={Users} title={t('bots.groups.none')}>{t('bots.groups.noneBody')}</Empty> : groups.map((g) => (
            <Card key={g.id} className="gap-3 py-4" data-testid={`group-${g.name}`}>
              <CardHeader className="flex-row items-center gap-3 px-4">
                <span className="bg-primary/10 grid size-10 shrink-0 place-items-center rounded-xl text-xl">{g.icon || '👥'}</span>
                <div className="min-w-0 flex-1"><CardTitle>{g.name}</CardTitle><CardDescription className="mt-1 flex flex-wrap items-center gap-1">{g.members.map((id) => byId.get(id)).filter(Boolean).map((b) => <Badge key={b.id} variant="outline">{b.icon} {b.name}</Badge>)}</CardDescription></div>
              </CardHeader>
              <CardFooter className="flex-wrap px-4">
                <Button size="xs" onClick={() => go({ view: 'bot-group', id: g.id })}><MessageSquare />{t('bots.talk')}</Button>
                {manage ? <><Button size="xs" variant="outline" onClick={() => edit(g)}><Pencil />{t('bots.edit')}</Button><Button size="xs" variant="danger" onClick={() => remove(g)}><Trash2 />{t('bots.delete')}</Button></> : null}
              </CardFooter>
            </Card>
          ))}
        </BotPage>
      )}
    </>
  );
}

// ---- Recordatorios: the list, by day, and a new one.
const EVERY = ['once', 'daily', 'weekly', 'monthly', 'yearly'];
export function BotRemindersView() {
  const t = useT();
  const locale = useLocale();
  const { bots, loaded, error } = useBots();
  const list = useLoad('bots.reminders.list', {});
  const byId = useMemo(() => new Map(bots.map((b) => [b.id, b])), [bots]);
  const add = () => form(t('bots.rem.new'), {
    initial: { bot: String(bots.find((b) => b.is_chief)?.id ?? bots[0]?.id ?? ''), text: '', when: localWhen(new Date(Date.now() + 3_600_000)), every: 'once' },
    body: (v, set) => (<>
      <Field label={t('bots.rem.text')}><Input autoFocus value={v.text} maxLength={500} onChange={(e) => set({ text: e.target.value })} placeholder={t('bots.rem.textPh')} data-testid="reminder-text" /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('bots.rem.when')}><Input type="datetime-local" value={v.when} onChange={(e) => set({ when: e.target.value })} data-testid="reminder-when" /></Field>
        <Field label={t('bots.rem.every')}><Select className="w-full" value={v.every} onValueChange={(every) => set({ every })} options={EVERY.map((e) => ({ value: e, label: t(`bots.every.${e}`) }))} /></Field>
      </div>
      <Field label={t('bots.rem.bot')}><Select className="w-full" value={v.bot} onValueChange={(bot) => set({ bot })} options={bots.map((b) => ({ value: String(b.id), label: `${b.icon ? `${b.icon} ` : ''}${b.name}` }))} /></Field>
    </>),
    ok: t('bots.rem.create'),
    onOk: async (v) => { await botCall('bots.reminders.create', { id: Number(v.bot), text: v.text, when: v.when, every: v.every }); list.reload(); return true; }
  });
  const items = list.data ?? [];
  const day = (iso) => { const d = new Date(iso); const today = new Date(); const tomorrow = new Date(Date.now() + 86_400_000); return d.toDateString() === today.toDateString() ? t('bots.rem.today') : d.toDateString() === tomorrow.toDateString() ? t('bots.rem.tomorrow') : d.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' }); };
  const groups = [];
  for (const r of items) { const k = r.next_run ? day(r.next_run) : t('bots.rem.noDate'); const g = groups.find((x) => x.k === k); if (g) g.items.push(r); else groups.push({ k, items: [r] }); }
  return (
    <>
      <PageHeader icon={<Bell className="text-primary size-5" />} title={t('nav.botReminders')}>
        <Button size="sm" variant="ghost" onClick={list.reload} aria-label={t('bots.refresh')}><RefreshCw /></Button>
        {bots.length ? <Button size="sm" onClick={add} data-testid="reminder-new"><Plus />{t('bots.rem.new')}</Button> : null}
      </PageHeader>
      {!loaded ? (error ? <BotsDown error={error} /> : <Loading />) : !bots.length ? <NoBots /> : (
        <BotPage>
          {list.error ? <p className="text-destructive text-sm">{list.error}</p> : null}
          {!items.length && !list.loading ? <Empty icon={Bell} title={t('bots.rem.none')}>{t('bots.rem.noneBody')}</Empty> : groups.map((g) => (
            <section key={g.k} className="grid gap-2" data-testid="reminders-day">
              <h2 className="text-muted-foreground text-[12px] font-medium tracking-wide uppercase first-letter:uppercase">{g.k}</h2>
              {g.items.map((r) => { const b = byId.get(r.bot_id); return (
                <div key={r.id} className="bg-card flex items-center gap-3 rounded-xl border px-3.5 py-2.5" data-testid="reminder">
                  <span className="text-primary w-12 shrink-0 text-[15px] font-medium tabular-nums">{r.next_run ? new Date(r.next_run).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                  <div className="min-w-0 flex-1"><div className="truncate text-sm">{r.text}</div><div className="text-muted-foreground flex items-center gap-1.5 text-xs">{b ? <><BotFace bot={b} size="sm" className="size-4 text-[10px]" />{b.name} · </> : null}{t(`bots.every.${r.every}`)}</div></div>
                  <Button size="icon-xs" variant="ghost" aria-label={t('bots.rem.cancel')} title={t('bots.rem.cancel')} onClick={async () => { if (await confirm(t('bots.rem.cancelTitle'), r.text, { ok: t('bots.rem.cancel'), danger: true })) { await act(botCall('bots.reminders.cancel', { id: r.id })); list.reload(); } }}><X /></Button>
                </div>
              ); })}
            </section>
          ))}
        </BotPage>
      )}
    </>
  );
}

// ---- Memoria: the global one and each bot's, editable on the PC (read only on a phone).
export function BotMemoryView() {
  const t = useT();
  const { bots, loaded, error } = useBots();
  const manage = useCanManage();
  const [which, setWhich] = useState('global');
  const mem = useLoad('bots.memory.get', { id: which === 'global' ? 'global' : Number(which) }, [which]);
  const [text, setText] = useState('');
  useEffect(() => { if (mem.data) setText(mem.data.text ?? ''); }, [mem.data]);
  const dirty = mem.data && text !== (mem.data.text ?? '');
  const save = async () => { const r = await act(botCall('bots.memory.set', { id: which === 'global' ? 'global' : Number(which), text }), t('bots.mem.saved')); if (r) mem.reload(); };
  return (
    <>
      <PageHeader icon={<BookOpen className="text-primary size-5" />} title={t('nav.botMemory')} meta={t('bots.mem.hint')}>
        <Select size="sm" value={which} onValueChange={setWhich} title={t('bots.mem.which')} options={[{ value: 'global', label: t('bots.mem.global') }, ...bots.map((b) => ({ value: String(b.id), label: `${b.icon ? `${b.icon} ` : ''}${b.name}` }))]} data-testid="memory-which" />
        {manage ? <Button size="sm" onClick={save} disabled={!dirty} data-testid="memory-save"><Save />{t('bots.save')}</Button> : null}
      </PageHeader>
      {!loaded ? (error ? <BotsDown error={error} /> : <Loading />) : (
        <BotPage>
          <Card>
            <CardHeader><CardTitle>{which === 'global' ? t('bots.mem.global') : t('bots.mem.of', { name: bots.find((b) => String(b.id) === which)?.name ?? '' })}</CardTitle><CardDescription>{which === 'global' ? t('bots.mem.globalHint') : t('bots.mem.botHint')}</CardDescription></CardHeader>
            <CardContent>
              {mem.error ? <p className="text-destructive text-sm">{mem.error}</p> : (
                <Textarea rows={16} className="font-mono text-[13px]" value={text} readOnly={!manage} onChange={(e) => setText(e.target.value)} placeholder={t('bots.mem.empty')} data-testid="memory-text" />
              )}
              <p className="text-muted-foreground mt-2 text-xs">{t('bots.mem.private')}</p>
            </CardContent>
          </Card>
        </BotPage>
      )}
    </>
  );
}

// ---- Casa: Home Assistant (or how to set it up)
const DOMAIN_ORDER = ['light', 'switch', 'climate', 'sensor', 'binary_sensor', 'cover', 'lock', 'media_player'];
export function BotHomeView() {
  const t = useT();
  const manage = useCanManage();
  const ha = useLoad('bots.ha.states', {});
  const [query, setQuery] = useState('');
  const states = (ha.data?.states ?? []).filter((s) => !query || `${s.name} ${s.entity_id}`.toLowerCase().includes(query.toLowerCase()));
  const domains = [...new Set(states.map((s) => s.entity_id.split('.')[0]))].sort((a, b) => ((DOMAIN_ORDER.indexOf(a) + 1 || 99) - (DOMAIN_ORDER.indexOf(b) + 1 || 99)) || a.localeCompare(b));
  return (
    <>
      <PageHeader icon={<Home className="text-primary size-5" />} title={t('nav.botHome')}>
        {ha.data?.configured ? <Input className="h-8 w-48" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('bots.home.search')} aria-label={t('bots.home.search')} /> : null}
        <Button size="sm" variant="ghost" onClick={ha.reload} aria-label={t('bots.refresh')}><RefreshCw /></Button>
      </PageHeader>
      <BotPage wide>
        {ha.loading && !ha.data ? <Loading /> : ha.error ? <p className="text-destructive text-sm" role="alert">{ha.error}</p> : !ha.data?.configured ? (
          <Card className="mx-auto w-full max-w-xl" data-testid="home-setup">
            <CardHeader className="flex-row items-start gap-3"><Home className="text-primary mt-0.5 size-5 shrink-0" /><div><CardTitle>{t('bots.home.setupTitle')}</CardTitle><CardDescription>{t('bots.home.setupBody')}</CardDescription></div></CardHeader>
            <CardContent className="text-muted-foreground grid gap-1 text-sm"><p>1. {t('bots.home.step1')}</p><p>2. {t('bots.home.step2')}</p><p>3. {t('bots.home.step3')}</p></CardContent>
            {manage ? <CardFooter><Button size="sm" onClick={() => go('bot-settings')}><Settings2 />{t('bots.home.openSettings')}</Button></CardFooter> : null}
          </Card>
        ) : !states.length ? <Empty icon={Home} title={t('bots.home.none')} /> : domains.map((dm) => (
          <section key={dm} className="grid gap-2">
            <h2 className="text-muted-foreground text-[12px] font-medium tracking-wide uppercase">{t(`bots.home.domain.${DOMAIN_ORDER.includes(dm) ? dm : 'other'}`)} <span className="opacity-60">· {dm}</span></h2>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {states.filter((s) => s.entity_id.startsWith(`${dm}.`)).map((s) => (
                <div key={s.entity_id} className="bg-card flex items-center gap-3 rounded-xl border px-3.5 py-2.5">
                  <span className={cn('size-2 shrink-0 rounded-full', s.state === 'on' || s.state === 'open' || s.state === 'unlocked' ? 'bg-warning' : s.state === 'unavailable' ? 'bg-destructive/60' : 'bg-muted-foreground/40')} />
                  <div className="min-w-0 flex-1"><div className="truncate text-sm">{s.name}</div><div className="text-muted-foreground truncate font-mono text-[11px]">{s.entity_id}</div></div>
                  <span className="text-[13px] font-medium tabular-nums">{s.state}{s.unit ? ` ${s.unit}` : ''}</span>
                </div>
              ))}
            </div>
          </section>
        ))}
      </BotPage>
    </>
  );
}

// ---- Servidor: how the machine of the bots is (CPU, memory, disks, containers, failed services).
function Meter({ label, value, pct, icon: Icon }) {
  return (
    <div className="bg-card grid gap-2 rounded-xl border p-3.5">
      <div className="text-muted-foreground flex items-center gap-1.5 text-xs"><Icon className="size-3.5" />{label}</div>
      <div className="text-lg font-medium tabular-nums">{value}</div>
      {pct != null ? <div className="bg-muted h-1.5 overflow-hidden rounded-full"><div className={cn('h-full rounded-full', pct > 85 ? 'bg-destructive' : pct > 65 ? 'bg-warning' : 'bg-primary')} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} /></div> : null}
    </div>
  );
}
export function BotServerView() {
  const t = useT();
  const srv = useLoad('bots.srv.status', {});
  const s = srv.data;
  return (
    <>
      <PageHeader icon={<Server className="text-primary size-5" />} title={t('nav.botServer')} meta={s ? `${s.host} · ${s.system}` : null}>
        <Button size="sm" variant="ghost" onClick={srv.reload} aria-label={t('bots.refresh')} data-testid="server-refresh"><RefreshCw className={cn(srv.loading && 'animate-spin')} /></Button>
      </PageHeader>
      <BotPage wide>
        {!s ? (srv.error ? <BotsDown error={srv.error} /> : <Loading />) : (<>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="server-status">
            <Meter icon={Cpu} label={t('bots.srv.cpu', { n: s.cpu.cores })} value={`${s.cpu.load1.toFixed(2)} · ${s.cpu.load5.toFixed(2)} · ${s.cpu.load15.toFixed(2)}`} pct={Math.round((s.cpu.load5 / Math.max(1, s.cpu.cores)) * 100)} />
            <Meter icon={MemoryStick} label={t('bots.srv.memory')} value={t('bots.srv.memoryValue', { free: s.memory.free, total: s.memory.total })} pct={s.memory.usedPct} />
            {(s.disks ?? []).map((d) => <Meter key={d.path ?? d.mount ?? d.name} icon={HardDrive} label={t('bots.srv.disk', { path: d.path ?? d.mount ?? d.name ?? '' })} value={t('bots.srv.diskValue', { free: d.free, total: d.total })} pct={d.usedPct} />)}
            <Meter icon={Server} label={t('bots.srv.uptime')} value={t('bots.srv.hours', { n: s.uptimeHours })} />
          </div>
          {s.note ? <p className="text-muted-foreground text-sm">{s.note}</p> : null}
          {Array.isArray(s.containers) ? (
            <Card className="gap-2 py-4"><CardHeader className="px-4"><CardTitle className="flex items-center gap-1.5"><Container className="size-4" />{t('bots.srv.containers', { n: s.containers.length })}</CardTitle></CardHeader>
              <CardContent className="grid gap-1 px-4">{s.containers.map((c) => <div key={c.name} className="flex items-center gap-2 text-sm"><span className={cn('size-2 shrink-0 rounded-full', /^Up/.test(c.status) ? 'bg-success' : 'bg-destructive/70')} /><span className="min-w-0 flex-1 truncate font-medium">{c.name}</span><span className="text-muted-foreground truncate text-xs">{c.status}</span></div>)}</CardContent></Card>
          ) : s.containers?.error ? <p className="text-muted-foreground text-sm">{s.containers.error}</p> : null}
          {s.failedServices?.length ? (
            <Card className="border-warning/50 gap-2 py-4"><CardHeader className="px-4"><CardTitle className="text-warning flex items-center gap-1.5"><AlertTriangle className="size-4" />{t('bots.srv.failed', { n: s.failedServices.length })}</CardTitle></CardHeader>
              <CardContent className="grid gap-1 px-4 font-mono text-[13px]">{s.failedServices.map((f) => <div key={f.unit}>{f.unit}{f.user ? ` (${t('bots.srv.user')})` : ''}</div>)}</CardContent></Card>
          ) : null}
          <p className="text-muted-foreground text-xs">{t('bots.srv.changes')}</p>
        </>)}
      </BotPage>
    </>
  );
}

// ---- «Cosas que nadie toca» (config.protected): chips to remove, a field to add; saved at once.
function ProtectedCard({ manage }) {
  const t = useT();
  const load = useLoad('bots.protected.get', {});
  const [draft, setDraft] = useState('');
  const list = load.data;
  const save = async (items) => { const r = await act(botCall('bots.protected.set', { items }), t('bots.set.saved')); if (r) load.reload(); return r; };
  const add = async () => { const v = draft.trim(); if (v.length < 2 || !list) return; if (await save([...list, v])) setDraft(''); };
  return (
    <Card data-testid="bot-protected">
      <CardHeader><CardTitle>{t('bots.set.protected')}</CardTitle><CardDescription>{t('bots.set.protectedHint')}</CardDescription></CardHeader>
      <CardContent className="grid gap-3">
        {!list ? (load.error ? <p className="text-destructive text-sm">{load.error}</p> : <Loading />) : list.length ? (
          <div className="flex flex-wrap gap-1.5">
            {list.map((x) => (
              <Badge key={x} variant="secondary" className="gap-1 font-mono" data-testid="bot-protected-item">
                {x}
                {manage ? <button type="button" className="hover:text-destructive -mr-0.5 rounded-sm" aria-label={t('bots.set.protectedRemove', { name: x })} onClick={() => save(list.filter((y) => y !== x))}><X className="size-3" /></button> : null}
              </Badge>
            ))}
          </div>
        ) : <p className="text-muted-foreground text-sm">{t('bots.set.protectedEmpty')}</p>}
        {manage && list ? (
          <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
            <Input value={draft} maxLength={200} onChange={(e) => setDraft(e.target.value)} placeholder={t('bots.set.protectedPh')} data-testid="bot-protected-input" />
            <Button type="submit" size="sm" variant="outline" disabled={draft.trim().length < 2 || list.length >= 50}><Plus />{t('bots.set.protectedAdd')}</Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ---- Ajustes de bots: golden rules, what nobody touches, Home Assistant and how long an idle bot stays open.
export function BotSettingsView() {
  const t = useT();
  const manage = useCanManage();
  const centro = useStore((s) => s.centro);
  const app = useStore((s) => s.app);
  const rules = useLoad('bots.rules.get', {});
  const [list, setList] = useState(null);
  useEffect(() => { if (rules.data) setList(rules.data.length ? rules.data : ['']); }, [rules.data]);
  const [ha, setHa] = useState(null);
  const [token, setToken] = useState('');
  useEffect(() => { if (manage) botCall('bots.ha.get').then(setHa).catch(() => setHa(null)); }, [manage]);
  const [idle, setIdle] = useState(String(app.config?.bots?.idleMinutes ?? 10));
  const showIdle = !bridge.mobile && !centro?.linked;
  const saveRules = async () => { const r = await act(botCall('bots.rules.set', { rules: list.map((x) => x.trim()).filter(Boolean) }), t('bots.set.saved')); if (r) rules.reload(); };
  const saveHa = async () => { const r = await act(botCall('bots.ha.set', { url: ha?.url ?? '', ...(token ? { token } : {}) }), t('bots.set.saved')); if (r) { setHa(r); setToken(''); } };
  const saveIdle = async () => { const config = await act(call('config.save', { patch: { bots: { idleMinutes: Math.max(1, Math.min(240, Number(idle) || 10)) } } }), t('bots.set.saved')); if (config) setState({ app: { ...getState().app, config } }); };
  return (
    <>
      <PageHeader icon={<Settings2 className="text-primary size-5" />} title={t('nav.botSettings')} meta={<CentroBadge />} />
      <BotPage>
        <Card data-testid="bot-rules">
          <CardHeader><CardTitle>{t('bots.set.rules')}</CardTitle><CardDescription>{t('bots.set.rulesHint')}</CardDescription></CardHeader>
          <CardContent className="grid gap-2">
            {!list ? (rules.error ? <p className="text-destructive text-sm">{rules.error}</p> : <Loading />) : list.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-muted-foreground w-5 text-right text-xs tabular-nums">{i + 1}.</span>
                <Input value={r} maxLength={400} readOnly={!manage} onChange={(e) => setList(list.map((x, j) => (j === i ? e.target.value : x)))} placeholder={t('bots.set.rulePh')} data-testid={`bot-rule-${i + 1}`} />
                {manage ? <Button size="icon-sm" variant="ghost" aria-label={t('bots.set.ruleRemove')} onClick={() => setList(list.filter((_, j) => j !== i))}><X /></Button> : null}
              </div>
            ))}
          </CardContent>
          {manage && list ? <CardFooter><Button size="sm" variant="outline" onClick={() => setList([...list, ''])} disabled={list.length >= 30}><Plus />{t('bots.set.ruleAdd')}</Button><Button size="sm" onClick={saveRules} data-testid="bot-rules-save">{t('bots.save')}</Button></CardFooter> : null}
        </Card>
        <ProtectedCard manage={manage} />
        {manage ? (
          <Card data-testid="bot-ha">
            <CardHeader><CardTitle>{t('bots.set.ha')}</CardTitle><CardDescription>{t('bots.set.haHint')}</CardDescription></CardHeader>
            <CardContent className="grid gap-3">
              <Field label={t('bots.set.haUrl')}><Input value={ha?.url ?? ''} onChange={(e) => setHa({ ...(ha ?? {}), url: e.target.value })} placeholder="http://homeassistant.local:8123" inputMode="url" /></Field>
              <Field label={t('bots.set.haToken')} hint={ha?.hasToken ? t('bots.set.haTokenSaved') : t('bots.set.haTokenHint')}><Input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={ha?.hasToken ? '••••••••' : ''} autoComplete="off" /></Field>
            </CardContent>
            <CardFooter><Button size="sm" onClick={saveHa}>{t('bots.save')}</Button></CardFooter>
          </Card>
        ) : null}
        {showIdle ? (
          <Card>
            <CardHeader><CardTitle>{t('bots.set.idle')}</CardTitle><CardDescription>{t('bots.set.idleHint')}</CardDescription></CardHeader>
            <CardContent className="flex items-center gap-2"><Input type="number" min={1} max={240} className="w-24" value={idle} onChange={(e) => setIdle(e.target.value)} /><span className="text-muted-foreground text-sm">{t('bots.set.minutes')}</span></CardContent>
            <CardFooter><Button size="sm" onClick={saveIdle}>{t('bots.save')}</Button></CardFooter>
          </Card>
        ) : null}
      </BotPage>
    </>
  );
}

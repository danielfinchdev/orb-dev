// 3.6 «Personas»: Ajustes › Personas (the owner: who uses this Orb, with numbers only, never their content) and
// Ajustes › Mi perfil (each person: name, language, time zone, PIN, what notifications show, their own accounts with the
// sign-in without a console, their devices, and exporting or deleting their data). On a phone, «Mi perfil» is a screen.
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { UserPlus, Pencil, Trash2, KeyRound, PauseCircle, PlayCircle, Unplug, ShieldCheck, LogIn, Download, Smartphone, UserRound, ExternalLink, Plus, LoaderCircle, MoreHorizontal } from 'lucide-react';
import { PageHeader } from '@/components/page.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Badge, Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter, Field, Input } from '@/components/ui/basic.jsx';
import { Select, Checkbox, BubbleTip, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/overlay.jsx';
import { confirm, form } from '@/components/dialogs.jsx';
import { PersonDot, askPin } from '@/components/person-menu.jsx';
import { useStore, call, act, bridge, loadMe, refresh, personNameOf } from '@/lib/store.js';
import { CAPS, PREVIEWS, pinOk } from '@/lib/persons.js';
import { ago } from '@/lib/utils.js';
import { t as tNow, useT, useLocale } from '@/lib/i18n.js';
import { LANGUAGES } from '../../core/i18n.mjs';

const zones = () => { try { return Intl.supportedValuesOf('timeZone'); } catch { return ['UTC', 'Europe/Madrid', 'Europe/London', 'America/New_York']; } };
const hereTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };
export const TzSelect = ({ value, onChange, testid }) => {
  const list = zones(); const v = value || hereTz();
  return <Select className="w-full sm:w-72" value={v} onValueChange={onChange} options={(list.includes(v) ? list : [v, ...list]).map((z) => ({ value: z, label: z.replace(/_/g, ' ') }))} title={tNow('profile.tz')} data-testid={testid} />;
};

// ---- Ajustes › Personas (the owner)
async function addPerson(reload) {
  const r = await form(tNow('persons.addTitle'), {
    initial: { name: '', dev: false },
    body: (v, set) => (<>
      <Field label={tNow('persons.name')}><Input autoFocus value={v.name} maxLength={40} onChange={(e) => set({ name: e.target.value })} placeholder={tNow('persons.namePh')} data-testid="person-new-name" /></Field>
      <label className="flex cursor-pointer items-start gap-2 text-sm"><Checkbox checked={v.dev} onCheckedChange={(on) => set({ dev: Boolean(on) })} /><span>{tNow('persons.cap.dev')}</span></label>
    </>),
    ok: tNow('persons.add'),
    onOk: (v) => call('persons.create', { name: v.name.trim(), caps: { dev: v.dev }, tz: hereTz() })
  });
  if (r) { toast.success(tNow('persons.added', { name: r.name })); reload(); }
}

// 3.6 (DESIGN-SYSTEM §2.3): one row per user: avatar, name, «Admin» for the admin, one summary line and at most three
// counts that matter (bots, chats, projects; numbers only, never what). The actions in one menu: Editar, Permisos,
// Quitar PIN, Pausar bots or Reanudar bots (the one that applies), and Eliminar after a separator.
export const ROW_COUNTS = ['bots', 'conversations', 'projects'];
export function plural(locale, key, n) { let form = 'other'; try { form = new Intl.PluralRules(locale).select(n); } catch { /* other */ } return form === 'one' ? `${key}One` : key; }
function PersonRow({ p, devices, reload }) {
  const t = useT();
  const locale = useLocale();
  const owner = p.role === 'owner';
  const [paused, setPaused] = useState(() => (p.counts?.bots ?? 0) > 0 && (p.counts?.botsPaused ?? 0) >= (p.counts?.bots ?? 0));
  const rename = () => form(t('persons.renameTitle'), { initial: { name: p.name }, body: (v, set) => <Input autoFocus value={v.name} maxLength={40} onChange={(e) => set({ name: e.target.value })} />, ok: t('persons.save'), onOk: async (v) => { await call('persons.rename', { id: p.id, name: v.name.trim() }); reload(); return true; } });
  const caps = () => form(t('persons.capsTitle', { name: p.name }), {
    initial: { ...p.caps },
    body: (v, set) => CAPS.map((k) => <label key={k} className="flex cursor-pointer items-start gap-2 text-sm"><Checkbox checked={Boolean(v[k])} onCheckedChange={(on) => set({ [k]: Boolean(on) })} data-testid={`person-cap-${k}`} /><span>{t(`persons.cap.${k}`)}</span></label>),
    ok: t('persons.save'), onOk: async (v) => { await call('persons.setCaps', { id: p.id, caps: v }); reload(); return true; }
  });
  const resetPin = async () => { if (await confirm(t('persons.resetPinTitle', { name: p.name }), t('persons.resetPinBody'), { ok: t('persons.resetPin') })) { await act(call('persons.setPin', { id: p.id, pin: null }), t('persons.pinReset', { name: p.name })); reload(); } };
  const pause = async (next) => { const r = await act(call('persons.pauseBots', { id: p.id, paused: next })); if (r) { setPaused(next); toast.success(t(next ? 'persons.botsPaused' : 'persons.botsResumed', { n: r.bots, name: p.name })); } };
  const revokeAll = async () => {
    if (!devices.length || !(await confirm(t('persons.revokeTitle', { name: p.name }), t('persons.revokeBody', { n: devices.length }), { ok: t('persons.revoke'), danger: true }))) return;
    for (const d of devices) await call('link.revoke', { id: d.id }).catch(() => {});
    toast.success(t('persons.revoked', { name: p.name })); reload();
  };
  const remove = async () => {
    if (!(await confirm(t('persons.removeTitle', { name: p.name }), t('persons.removeBody', { name: p.name }), { ok: t('persons.remove'), danger: true }))) return;
    if (await act(call('persons.remove', { id: p.id }), t('persons.removed', { name: p.name }))) reload();
  };
  const c = p.counts ?? {};
  const count = (key, n) => t(plural(locale, key, n), { n });
  const summary = [count('persons.devicesN', p.devices ?? 0), p.lastSeen ? t('persons.seen', { when: ago(p.lastSeen) }) : null].filter(Boolean).join(' · ');
  const counts = ROW_COUNTS.filter((k) => c[k]).map((k) => count(`persons.count.${k}`, c[k]));
  const hasBots = (c.bots ?? 0) > 0;
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-xl border px-3 py-2.5" data-testid={`person-row-${p.name}`}>
      <PersonDot name={p.name} color={p.color} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2"><span className="truncate text-sm font-medium">{p.name}</span>{owner ? <Badge variant="secondary">{t('persons.role.owner')}</Badge> : null}</div>
        <div className="text-muted-foreground truncate text-xs tabular-nums" data-testid="person-summary">{summary}</div>
        {/* Numbers only: how many, never what. */}
        {counts.length ? <div className="text-muted-foreground truncate text-xs tabular-nums" data-testid="person-counts">{counts.join(' · ')}</div> : null}
      </div>
      <DropdownMenu>
        <BubbleTip title={t('persons.actions', { name: p.name })}>
          <DropdownMenuTrigger asChild><Button size="icon-sm" variant="ghost" aria-label={t('persons.actions', { name: p.name })} data-testid={`person-menu-${p.name}`}><MoreHorizontal /></Button></DropdownMenuTrigger>
        </BubbleTip>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={rename} data-testid={`person-rename-${p.name}`}><Pencil />{t('persons.edit')}</DropdownMenuItem>
          {owner ? null : <DropdownMenuItem onSelect={caps} data-testid={`person-caps-${p.name}`}><ShieldCheck />{t('persons.caps')}</DropdownMenuItem>}
          {!owner && p.hasPin ? <DropdownMenuItem onSelect={resetPin} data-testid={`person-pin-${p.name}`}><KeyRound />{t('persons.resetPin')}</DropdownMenuItem> : null}
          {!owner && hasBots ? (paused
            ? <DropdownMenuItem onSelect={() => pause(false)} data-testid={`person-resume-${p.name}`}><PlayCircle />{t('persons.resumeBots')}</DropdownMenuItem>
            : <DropdownMenuItem onSelect={() => pause(true)} data-testid={`person-pause-${p.name}`}><PauseCircle />{t('persons.pauseBots')}</DropdownMenuItem>) : null}
          {!owner && devices.length ? <DropdownMenuItem onSelect={revokeAll}><Unplug />{t('persons.revokeDevices')}</DropdownMenuItem> : null}
          {owner ? null : <><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onSelect={remove} data-testid={`person-remove-${p.name}`}><Trash2 />{t('persons.remove')}</DropdownMenuItem></>}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function PersonsCard() {
  const t = useT();
  const [list, setList] = useState(null);
  const [devices, setDevices] = useState([]);
  const load = async () => {
    const [o, d] = await Promise.all([call('persons.overview').catch(() => []), call('link.devices').catch(() => [])]);
    setList(o); setDevices(d); loadMe();
  };
  useEffect(() => { load(); }, []);
  if (!list) return null;
  const owner = list.find((p) => p.role === 'owner')?.id;
  return (
    <Card data-testid="persons-card">
      <CardContent className="grid gap-2">{list.map((p) => <PersonRow key={p.id} p={p} devices={devices.filter((d) => (d.person ?? owner) === p.id)} reload={load} />)}</CardContent>
      <CardFooter><Button size="sm" onClick={() => addPerson(load)} data-testid="person-add"><UserPlus />{t('persons.add')}</Button></CardFooter>
    </Card>
  );
}

// ---- Mi perfil (anyone, for themselves)
function ProfileCard() {
  const t = useT();
  const me = useStore((s) => s.me);
  const p = me?.person;
  const [name, setName] = useState(p?.name ?? '');
  if (!p) return null;
  const update = async (patch, ok) => { if (await act(call('persons.update', patch), ok ?? t('profile.saved'))) await refresh().catch(() => {}); };
  return (
    <Card data-testid="profile-card">
      <CardContent className="grid gap-4">
        <Field label={t('profile.name')}>
          <div className="flex gap-2"><Input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} className="sm:w-72" data-testid="profile-name" />
            <Button size="sm" variant="outline" disabled={!name.trim() || name.trim() === p.name} onClick={async () => { if (await act(call('persons.rename', { name: name.trim() }), t('profile.saved'))) loadMe(); }}>{t('persons.save')}</Button></div>
        </Field>
        <Field label={t('profile.language')}><Select className="w-full sm:w-72" value={p.language ?? 'es'} onValueChange={(language) => update({ language })} options={Object.entries(LANGUAGES).map(([value, label]) => ({ value, label }))} title={t('profile.language')} data-testid="profile-language" /></Field>
        <Field label={t('profile.tz')}><TzSelect value={p.tz} onChange={(tz) => update({ tz })} testid="profile-tz" /></Field>
      </CardContent>
    </Card>
  );
}

function PinCard() {
  const t = useT();
  const me = useStore((s) => s.me);
  const p = me?.person;
  if (!p) return null;
  const setPin = async () => {
    const r = await form(p.hasPin ? t('profile.pinChange') : t('profile.pinSet'), {
      initial: { current: '', pin: '', again: '' },
      body: (v, set) => {
        const digits = (k) => ({ value: v[k], type: 'password', inputMode: 'numeric', autoComplete: 'off', maxLength: 12, onChange: (e) => set({ [k]: e.target.value.replace(/\D/g, '') }) });
        return (<>
          {p.hasPin ? <Field label={t('profile.pinCurrent')}><Input autoFocus {...digits('current')} data-testid="pin-current" /></Field> : null}
          <Field label={t('profile.pinNew')} hint={t('profile.pinRule')}><Input autoFocus={!p.hasPin} {...digits('pin')} data-testid="pin-new" /></Field>
          <Field label={t('profile.pinAgain')}><Input {...digits('again')} data-testid="pin-again" /></Field>
        </>);
      },
      ok: t('persons.save'),
      onOk: async (v) => {
        if (!pinOk(v.pin)) throw new Error(t('profile.pinRule'));
        if (v.pin !== v.again) throw new Error(t('profile.pinMismatch'));
        return call('persons.setPin', { pin: v.pin, ...(p.hasPin ? { current: v.current } : {}) });
      }
    });
    if (r) { toast.success(t('profile.pinSaved')); loadMe(); }
  };
  const remove = async () => {
    const r = await askPin({ title: t('profile.pinRemove'), description: t('profile.pinRemoveDesc'), send: (pin) => call('persons.setPin', { pin: null, current: pin }).then(() => ({ ok: true })) });
    if (r) { toast.success(t('profile.pinRemoved')); loadMe(); }
  };
  return (
    <Card data-testid="pin-card">
      <CardHeader><CardTitle>{t('profile.pinTitle')}</CardTitle><CardDescription>{t('profile.pinHint')}</CardDescription></CardHeader>
      <CardFooter className="flex-wrap">
        <Button size="sm" onClick={setPin} data-testid="pin-set"><KeyRound />{p.hasPin ? t('profile.pinChange') : t('profile.pinSet')}</Button>
        {p.hasPin ? <Button size="sm" variant="ghost" onClick={remove}>{t('profile.pinRemove')}</Button> : null}
      </CardFooter>
    </Card>
  );
}

function PrivacyCard() {
  const t = useT();
  const [preview, setPreview] = useState(null);
  useEffect(() => { call('persons.prefs.get').then((r) => setPreview(r.preview)).catch(() => setPreview(null)); }, []);
  if (!preview) return null;
  const save = async (v) => { const r = await act(call('persons.prefs.set', { preview: v }), t('profile.saved')); if (r) setPreview(r.preview); };
  return (
    <Card data-testid="privacy-card">
      <CardHeader><CardTitle>{t('profile.previewTitle')}</CardTitle></CardHeader>
      <CardContent><Select className="w-full sm:w-80" value={preview} onValueChange={save} options={PREVIEWS.map((v) => ({ value: v, label: t(`profile.preview.${v}`) }))} title={t('profile.previewTitle')} data-testid="profile-preview" /></CardContent>
    </Card>
  );
}

// The sign-in of one's own account, with no console: the agent's link, and the code it gives back when it asks for one.
function SignIn({ acc, onDone }) {
  const t = useT();
  const [login, setLogin] = useState(null);
  const [code, setCode] = useState('');
  useEffect(() => bridge.on('agents:login', (p) => setLogin((cur) => {
    if (!cur || cur.id !== p.id) return cur;
    if (p.state === 'hecho') { toast.success(t('agents.loginDone', { label: acc.label })); onDone?.(); return null; }
    if (p.state === 'error') { toast.error(p.message ?? t('agents.loginWaiting')); return null; }
    if (p.state === 'cancelado') return null;
    return { ...cur, ...p };
  })), []); // eslint-disable-line react-hooks/exhaustive-deps
  const start = async () => { const r = await act(call('agents.login', { account: acc.id })); if (r) { setLogin(r); if (!r.opened && r.url) bridge.openExternal(r.url).catch(() => {}); } };
  if (!login) return <Button size="xs" variant="outline" onClick={start} data-testid={`profile-login-${acc.id}`}><LogIn />{t('agents.login')}</Button>;
  return (
    <div className="grid w-full gap-2 rounded-lg border p-2.5 text-xs" data-testid="profile-login">
      <p>{t('profile.loginSteps')}</p>
      {login.url ? <Button size="xs" variant="outline" className="w-fit" onClick={() => bridge.openExternal(login.url).catch(() => {})}><ExternalLink />{t('profile.loginOpen')}</Button> : null}
      {login.needsCode ? <div className="flex gap-2"><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder={t('profile.loginCode')} autoCapitalize="none" autoCorrect="off" spellCheck={false} /><Button size="sm" disabled={!code.trim()} onClick={() => act(call('agents.loginCode', { id: login.id, code: code.trim() }))}>{t('profile.loginSend')}</Button></div> : null}
      <Button size="xs" variant="ghost" className="w-fit" onClick={() => { call('agents.loginCancel', { id: login.id }).catch(() => {}); setLogin(null); }}>{t('persons.cancel')}</Button>
    </div>
  );
}

const OWN_AGENTS = ['claude', 'codex'];
function MyAccountsCard() {
  const t = useT();
  const me = useStore((s) => s.me);
  const accounts = useStore((s) => s.app?.config?.accounts ?? []);
  const [loans, setLoans] = useState(null);
  useEffect(() => { call('accounts.loans').then(setLoans).catch(() => setLoans(null)); }, []);
  const owner = me?.role === 'owner';
  const mine = accounts.filter((a) => (a.person ?? (owner ? me?.person?.id : null)) === me?.person?.id);
  const add = async (agent) => {
    const label = `${agent === 'claude' ? 'Claude' : 'Codex'} ${me?.person?.name ?? ''}`.trim();
    const r = await act(call('accounts.add', { agent, label }), t('profile.accountAdded', { label }));
    if (r) await refresh().catch(() => {});
  };
  return (
    <Card data-testid="my-accounts">
      <CardHeader><CardTitle>{t('profile.accountsTitle')}</CardTitle></CardHeader>
      <CardContent className="grid gap-1.5">
        {!mine.length ? <p className="text-muted-foreground text-sm">{t('profile.noAccounts')}</p> : mine.map((a) => (
          <div key={a.id} className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2"><span className="min-w-0 flex-1 truncate text-[13px] font-medium">{a.label}</span><SignIn acc={a} onDone={() => refresh().catch(() => {})} /></div>
        ))}
        {(loans?.got ?? []).map((l) => (
          <div key={l.account} className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-[13px]" data-testid="profile-borrowed"><span className="min-w-0 flex-1 truncate">{l.label}</span><Badge variant="secondary" className="font-normal">{t('persons.loan.from', { name: personNameOf(l.lender) })}</Badge></div>
        ))}
      </CardContent>
      <CardFooter className="flex-wrap">{OWN_AGENTS.map((a) => <Button key={a} size="sm" variant="outline" onClick={() => add(a)} data-testid={`profile-add-${a}`}><Plus />{t('profile.addAccount', { agent: a === 'claude' ? 'Claude' : 'Codex' })}</Button>)}</CardFooter>
    </Card>
  );
}

function MyDevicesCard() {
  const t = useT();
  const me = useStore((s) => s.me);
  const [list, setList] = useState(null);
  const load = () => call('link.devices').then((d) => setList(d.filter((x) => !x.person || x.person === me?.person?.id))).catch(() => call('link.status').then((s) => setList(s.devices ?? [])).catch(() => setList([])));
  useEffect(() => { load(); }, []);
  if (!list) return null;
  const revoke = async (d) => { if (await confirm(t('link.revokeTitle', { name: d.name }), t('link.revokeBody'), { ok: t('link.revoke'), danger: true })) { await act(call('link.revoke', { id: d.id }), t('link.revoked')); load(); } };
  return (
    <Card data-testid="my-devices">
      <CardHeader><CardTitle>{t('profile.devicesTitle')}</CardTitle></CardHeader>
      <CardContent className="grid gap-1.5">
        {!list.length ? <p className="text-muted-foreground text-sm">{t('link.noDevices')}</p> : list.map((d) => (
          <div key={d.id} className="flex items-center gap-3 rounded-lg border px-3 py-2"><Smartphone className="text-muted-foreground size-4 shrink-0" /><span className="min-w-0 flex-1 truncate text-[13px]">{d.name}</span>
            <span className="text-muted-foreground text-xs">{d.online ? t('link.onNow') : d.lastSeen ? t('link.seen', { when: ago(d.lastSeen) }) : ''}</span>
            <BubbleTip title={t('link.revoke')}><Button size="icon-sm" variant="danger" aria-label={t('link.revoke')} onClick={() => revoke(d)}><Trash2 /></Button></BubbleTip></div>
        ))}
      </CardContent>
    </Card>
  );
}

function MyDataCard() {
  const t = useT();
  const me = useStore((s) => s.me);
  const [busy, setBusy] = useState(false);
  const exportIt = async () => {
    const r = await form(t('profile.exportTitle'), {
      initial: { passphrase: '' },
      body: (v, set) => <Field label={t('profile.exportPass')} hint={t('profile.exportPassHint')}><Input type="password" autoComplete="new-password" value={v.passphrase} onChange={(e) => set({ passphrase: e.target.value })} /></Field>,
      ok: t('profile.export'),
      onOk: (v) => { setBusy(true); return call('data.exportPerson', { passphrase: v.passphrase || null }).finally(() => setBusy(false)); }
    });
    if (r) toast.success(t('profile.exported', { file: r.file }), { duration: 8000 });
    if (r?.path && !bridge.mobile) bridge.openPath?.(r.path.replace(/[\\/][^\\/]+$/, '')).catch(() => {});
  };
  const remove = async () => {
    if (!(await confirm(t('profile.deleteTitle'), t('profile.deleteBody'), { ok: t('profile.delete'), danger: true }))) return;
    if (await act(call('data.deletePerson', {}), t('profile.deleted'))) location.reload();
  };
  return (
    <Card data-testid="my-data">
      <CardHeader><CardTitle>{t('profile.dataTitle')}</CardTitle></CardHeader>
      <CardFooter className="flex-wrap">
        <Button size="sm" variant="outline" onClick={exportIt} disabled={busy} data-testid="profile-export">{busy ? <LoaderCircle className="animate-spin" /> : <Download />}{t('profile.export')}</Button>
        {/* The admin cannot leave their own Orb: no button to. */}
        {me?.role === 'owner' ? null : <Button size="sm" variant="danger" onClick={remove} data-testid="profile-delete"><Trash2 />{t('profile.delete')}</Button>}
      </CardFooter>
    </Card>
  );
}

export function ProfileCards() {
  return <><ProfileCard /><PinCard /><PrivacyCard /><MyAccountsCard /><MyDevicesCard /><MyDataCard /></>;
}

// The phone's «Mi perfil» screen (in «Más»).
export function ProfileView() {
  const t = useT();
  return (
    <>
      <PageHeader icon={<UserRound className="text-primary size-5" />} title={t('profile.title')} />
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-5"><div className="mx-auto grid max-w-3xl gap-4"><ProfileCards /></div></div>
    </>
  );
}

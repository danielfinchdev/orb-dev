// 3.5: Magic Link. «Enlazar dispositivo» shows a QR and a short code (5 minutes, one use); «Enlazar con otro Orb» links
// this Orb with another one (its QR text, or its code and address); and the lists of linked devices and Orbs, each with
// whether it is on, when it was last seen, rename and close its session. In Ajustes on the PC, and as a screen of its own
// on a phone or in a browser linked with the server.
// 3.5 (generic): nothing here assumes a laptop, a server and a phone. «Papel de este Orb» (todo / centro / taller), «¿Dónde
// quieres tus bots?» (this Orb or a linked one that keeps bots, with «Llevar mis bots»), «Orb para programar» (where the
// Orb mode of a phone goes) and «Puede administrar» for each linked device are the user's choices.
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Link2, Radar, QrCode, Smartphone, Globe, Monitor, Server, Pencil, Trash2, X, Unplug, Copy, Check, LoaderCircle, Bot, Code2, Layers, ShieldCheck, TriangleAlert, ChevronDown, ExternalLink } from 'lucide-react';
import { PageHeader } from '@/components/page.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Badge, Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter, Field, Input, Textarea } from '@/components/ui/basic.jsx';
import { BubbleTip, Select, Switch, Checkbox } from '@/components/ui/overlay.jsx';
import { confirm, form } from '@/components/dialogs.jsx';
import { useStore, call, act, bridge, loadCentro, setState } from '@/lib/store.js';
import { countdown, parseLinkInput, sortDevices, canManageLinks, roleKey, ROLE_CHOICES, botsLocationCard, devChoices } from '@/lib/bots.js';
import { cn, ago, errorText } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';
import { personsOn, devicesByPerson } from '@/lib/persons.js';
import { PersonDot } from '@/components/person-menu.jsx';
import { loadMe } from '@/lib/store.js';
import { ServerLinkSection, askUnlinkServer } from './server.jsx';

const KIND_ICON = { phone: Smartphone, browser: Globe, orb: Monitor, terminal: Code2 };
const kindIcon = (d) => (d.kind === 'orb' && d.role === 'centro' ? Server : KIND_ICON[d.kind] ?? Smartphone);
const ROLE_ICON = { todo: Layers, centro: Server, taller: Monitor };

// «Papel de este Orb»: centre and workshop at once (a PC on its own: nothing to set up), always on and keeping the bots,
// or programming and building. Any Orb may be any of them (a Windows PC can be the centre too).
function RoleCard() {
  const t = useT();
  const app = useStore((s) => s.app);
  const value = ROLE_CHOICES.includes(app?.role) ? app.role : 'todo';
  const save = async (role) => {
    const config = await act(call('config.save', { patch: { role } }), t('link.roleSaved'));
    if (config) setState((s) => ({ app: s.app ? { ...s.app, role, config } : s.app }));
    loadCentro();
  };
  const Icon = ROLE_ICON[value];
  return (
    <Card data-testid="link-role">
      <CardHeader className="flex-row items-start gap-3"><Icon className="text-primary mt-0.5 size-5 shrink-0" /><div><CardTitle>{t('link.roleTitle')}</CardTitle><CardDescription>{t('link.roleHint')}</CardDescription></div></CardHeader>
      <CardContent className="grid gap-2">
        <Select className="w-full" value={value} onValueChange={save} options={ROLE_CHOICES.map((r) => ({ value: r, label: t(`link.roleChoice.${r}`) }))} data-testid="link-role-select" title={t('link.roleTitle')} />
        <p className="text-muted-foreground text-xs">{t(`link.roleAbout.${value}`)}</p>
      </CardContent>
    </Card>
  );
}

// «¿Dónde quieres tus bots?»: asked once after linking with an Orb that keeps bots, and changeable afterwards. Moving them
// there may bring this Orb's bots along (their memories and reminders) or leave them here; nothing is hidden silently.
function BotsPlaceCard({ refresh }) {
  const t = useT();
  const [where, setWhere] = useState(null);
  const [step, setStep] = useState(null); // { id, name }: moving there, asking whether to bring the bots
  const [busy, setBusy] = useState(false);
  const load = () => call('bots.where').then(setWhere).catch(() => setWhere(null));
  useEffect(() => { load(); }, [refresh]);
  // 3.7: with an Orb Server, each bot has its own home (Magic Link › Orb Server › Configurar, and each bot's info).
  const server = useStore((s) => s.server);
  if (!where?.peers?.length || server?.linked) return null;
  const card = botsLocationCard(where);
  const nameOf = (id) => where.peers.find((p) => p.id === id)?.name ?? '';
  const move = async (location, bring = false) => {
    setBusy(true);
    const done = location === 'local' ? t('link.bots.hereDone') : bring ? null : t('link.bots.thereDone', { name: nameOf(location) });
    const r = await act(call('bots.moveTo', { location, bring }), done);
    if (r && bring) act(Promise.resolve(r), t('link.bots.brought', { n: r.moved, name: nameOf(location) }));
    setBusy(false); setStep(null);
    if (r) setWhere(r);
    setState({ bots: null }); loadCentro();
  };
  const pick = (location) => { if (location !== 'local' && Number(where.localBots) > 0) setStep({ id: location, name: nameOf(location) }); else move(location); };
  return (
    <Card data-testid="link-bots-place" className={card || step ? 'border-primary/50' : undefined}>
      <CardHeader className="flex-row items-start gap-3"><Bot className="text-primary mt-0.5 size-5 shrink-0" /><div><CardTitle>{t('link.bots.title')}</CardTitle><CardDescription>{t('link.bots.hint')}</CardDescription></div></CardHeader>
      <CardContent className="grid gap-3">
        {step ? (
          <div className="grid gap-2" data-testid="link-bots-bring">
            <p className="text-sm">{t('link.bots.bringAsk', { n: where.localBots, name: step.name })}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => move(step.id, true)} disabled={busy} data-testid="link-bots-bring-yes">{t('link.bots.bring')}</Button>
              <Button size="sm" variant="outline" onClick={() => move(step.id, false)} disabled={busy} data-testid="link-bots-bring-no">{t('link.bots.leave')}</Button>
              <Button size="sm" variant="ghost" onClick={() => setStep(null)} disabled={busy}>{t('link.close')}</Button>
            </div>
            <p className="text-muted-foreground text-xs">{t('link.bots.bringAbout')}</p>
          </div>
        ) : card ? (
          <div className="grid gap-2" data-testid="link-bots-ask">
            <p className="text-sm font-medium">{t('link.bots.ask')}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => move('local')} disabled={busy} data-testid="link-bots-here">{t('link.bots.here')}</Button>
              <Button size="sm" onClick={() => pick(card.id)} disabled={busy} data-testid="link-bots-there">{t('link.bots.there', { name: card.name })}</Button>
            </div>
          </div>
        ) : (
          <Field label={t('link.bots.where')}>
            <Select className="w-full" value={where.location} onValueChange={pick} data-testid="link-bots-select" title={t('link.bots.where')}
              options={[{ value: 'local', label: t('link.bots.here') }, ...where.peers.map((p) => ({ value: p.id, label: t('link.bots.there', { name: p.name }) }))]} />
          </Field>
        )}
      </CardContent>
    </Card>
  );
}

// «Orb para programar»: where the Orb mode of a phone or a terminal linked with this Orb goes, when more than one Orb could
// take it (this one, if it programs, and the linked Orbs that do).
function DevTargetCard({ status }) {
  const t = useT();
  const choices = devChoices(status);
  if (choices.length < 2) return null;
  const value = status.devTarget && choices.some((c) => c.value === status.devTarget) ? status.devTarget : choices[0].value;
  const save = async (devTarget) => { const config = await act(call('config.save', { patch: { devTarget } }), t('link.dev.saved')); if (config) setState((s) => ({ app: s.app ? { ...s.app, config } : s.app })); };
  return (
    <Card data-testid="link-dev">
      <CardHeader className="flex-row items-start gap-3"><Code2 className="text-primary mt-0.5 size-5 shrink-0" /><div><CardTitle>{t('link.dev.title')}</CardTitle><CardDescription>{t('link.dev.hint')}</CardDescription></div></CardHeader>
      <CardContent>
        <Select className="w-full" value={value} onValueChange={save} data-testid="link-dev-select" title={t('link.dev.title')}
          options={choices.map((c) => ({ value: c.value, label: c.value === 'local' ? t('link.dev.here') : c.online ? c.name : `${c.name} · ${t('link.offline')}` }))} />
      </CardContent>
    </Card>
  );
}
function Dot({ on }) { const t = useT(); return <span className={cn('size-2 shrink-0 rounded-full', on ? 'bg-success' : 'bg-muted-foreground/40')} role="img" aria-label={on ? t('link.online') : t('link.offline')} />; }

// The QR with its short code and how long it lasts. 3.5.1: first, what it is for (a phone, a browser, another Orb of the
// user's or a terminal) and whether that device may answer the bots' cards: decided here, the device cannot change it.
const PAIR_FOR = ['phone', 'browser', 'orb', 'terminal'];
function PairCard() {
  const t = useT();
  const [qr, setQr] = useState(null);
  const [device, setDevice] = useState('phone');
  const [approve, setApprove] = useState(true);
  const [dev, setDev] = useState(false);
  // 3.6: «¿Para quién?»: the device is of the person chosen here (the owner may choose anyone, or someone new).
  const me = useStore((s) => s.me);
  const people = useStore((s) => s.people ?? []);
  const [forWho, setForWho] = useState('');
  const [newName, setNewName] = useState('');
  const many = personsOn(me);
  const owner = me?.role === 'owner';
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!copied) return undefined; const id = setTimeout(() => setCopied(false), 1500); return () => clearTimeout(id); }, [copied]);
  useEffect(() => { if (!qr) return undefined; const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, [qr]);
  const make = async () => {
    setBusy(true);
    const who = forWho === '__new' ? { newPerson: newName.trim() } : forWho && forWho !== me?.person?.id ? { person: forWho } : {};
    const r = await act(call('link.qr', { device, approve, ...(device === 'orb' ? { dev } : {}), ...who }));
    if (r && who.newPerson) loadMe();
    if (r) setQr({ ...r, svg: await QRCode.toString(r.url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) });
    setBusy(false); setNow(Date.now());
  };
  const expired = qr && now >= qr.expiresAt;
  return (
    <Card data-testid="link-pair">
      <CardHeader className="flex-row items-start gap-3"><QrCode className="text-primary mt-0.5 size-5 shrink-0" /><div><CardTitle>{t('link.pairTitle')}</CardTitle><CardDescription>{t('link.pairHint')}</CardDescription></div></CardHeader>
      <CardContent>
        {qr && !expired ? (
          <div className="animate-in fade-in-0 zoom-in-95 grid items-center justify-items-center gap-4 rounded-xl border p-4 duration-200 sm:grid-cols-[auto_1fr] sm:justify-items-start" data-testid="mobile-qr">
            <img alt={t('link.qrAlt')} className="size-52 rounded-lg bg-white p-2" src={`data:image/svg+xml;utf8,${encodeURIComponent(qr.svg)}`} data-testid="link-qr" />
            <div className="grid gap-2 text-center sm:text-left">
              <p className="text-sm">{t('link.scan')}</p>
              <div className="text-muted-foreground text-xs">{t('link.orCode')}</div>
              <div className="flex items-center justify-center gap-2 sm:justify-start">
                <span className="bg-muted rounded-lg px-3 py-1.5 font-mono text-2xl font-semibold tracking-widest tabular-nums select-all" data-testid="link-code">{qr.code}</span>
                {navigator.clipboard ? <Button size="icon-sm" variant="ghost" aria-label={copied ? t('link.copied') : t('link.copy')} title={copied ? t('link.copied') : t('link.copy')} onClick={() => navigator.clipboard.writeText(`${qr.code} ${qr.address}`).then(() => setCopied(true)).catch(() => {})} data-testid="link-copy">{copied ? <Check className="text-success animate-in fade-in-0 zoom-in-95" /> : <Copy />}</Button> : null}
              </div>
              <div className="text-muted-foreground font-mono text-xs break-all">{qr.address}</div>
              <div className="flex items-center justify-center gap-1.5 text-xs sm:justify-start" data-testid="link-fp"><ShieldCheck className="text-success size-3.5 shrink-0" />{t('link.fp', { fp: qr.pc })}</div>
              {qr.device === 'browser' && !qr.browserOk ? <div className="text-warning flex items-start gap-1.5 text-xs" role="alert" data-testid="link-http-warn"><TriangleAlert className="mt-0.5 size-3.5 shrink-0" />{t('link.httpBrowserWarn')}</div> : null}
              <div className="text-sm">{t('link.expires')} <span className="font-medium tabular-nums" data-testid="link-countdown">{countdown(qr.expiresAt, now)}</span></div>
              <div><Button size="sm" variant="ghost" onClick={() => setQr(null)}><X />{t('link.close')}</Button></div>
            </div>
            {/* 3.6: reaching this PC from outside home, explained where it is needed: when linking a phone. */}
            {qr.device === 'phone' ? <OutsideGuide /> : null}
          </div>
        ) : (
          <div className="grid gap-3">
            {many || owner ? (
              <Field label={t('link.forWho')}>
                <div className="grid gap-2 sm:flex sm:items-center">
                  <Select className="w-full sm:w-72" value={forWho || me?.person?.id || ''} onValueChange={setForWho} data-testid="link-for-who" title={t('link.forWho')}
                    options={[...(owner ? (many ? people : [me?.person].filter(Boolean)) : [me?.person].filter(Boolean)).map((p) => ({ value: p.id, label: p.id === me?.person?.id ? t('link.forMe', { name: p.name }) : p.name })), ...(owner ? [{ value: '__new', label: t('link.forNew') }] : [])]} />
                  {forWho === '__new' ? <Input className="sm:w-56" value={newName} maxLength={40} onChange={(e) => setNewName(e.target.value)} placeholder={t('link.forNewPh')} data-testid="link-for-new" /> : null}
                </div>
              </Field>
            ) : null}
            <Field label={t('link.forWhat')}>
              <Select className="w-full sm:w-72" value={device} onValueChange={setDevice} data-testid="link-for" title={t('link.forWhat')} options={PAIR_FOR.map((k) => ({ value: k, label: t(`link.for.${k}`) }))} />
            </Field>
            <label className="flex cursor-pointer items-start gap-2 text-sm"><Checkbox checked={approve} onCheckedChange={(v) => setApprove(Boolean(v))} data-testid="link-for-approve" /><span>{t('link.forApprove')}<span className="text-muted-foreground block text-xs">{t('link.forApproveHint')}</span></span></label>
            {device === 'orb' ? <label className="flex cursor-pointer items-start gap-2 text-sm"><Checkbox checked={dev} onCheckedChange={(v) => setDev(Boolean(v))} data-testid="link-for-dev" /><span>{t('link.forDev')}<span className="text-muted-foreground block text-xs">{t('link.forDevHint')}</span></span></label> : null}
            <p className="text-muted-foreground text-xs">{t('link.preferHttps')}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={make} disabled={busy || (forWho === '__new' && !newName.trim())} aria-busy={busy} data-testid="link-make">{busy ? <LoaderCircle className="animate-spin" /> : <QrCode />}{expired ? t('link.again') : t('link.make')}</Button>
              {expired ? <span className="text-muted-foreground text-xs">{t('link.expired')}</span> : null}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// «Usar fuera de casa»: Tailscale on both, switched on in Ajustes › Móvil; the PC has to be on.
function OutsideGuide() {
  const t = useT();
  return (
    <details className="group w-full rounded-lg border px-3 py-2 text-sm sm:col-span-2" data-testid="link-outside">
      <summary className="flex cursor-pointer list-none items-center gap-2 font-medium"><Globe className="text-muted-foreground size-4" />{t('link.outTitle')}<ChevronDown className="text-muted-foreground ml-auto size-4 transition-transform duration-200 group-open:rotate-180" /></summary>
      <ol className="mt-2 grid list-decimal gap-1 pl-5 text-[13px]"><li>{t('link.out1')}</li><li>{t('link.out2')}</li><li>{t('link.out3')}</li></ol>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Button size="xs" variant="outline" onClick={() => bridge.openExternal('https://tailscale.com/download').catch(() => {})}><ExternalLink />{t('link.outGet')}</Button>
        <span className="text-muted-foreground text-xs">{t('link.outPcOn')}</span>
      </div>
    </details>
  );
}

// This Orb links with another one.
function ConnectCard({ onDone }) {
  const t = useT();
  const [text, setText] = useState('');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => {
    const input = parseLinkInput(text, address);
    if (!input) { setError(t('link.badInput')); return; }
    setBusy(true); setError('');
    try { const p = await call('link.connect', input); setText(''); setAddress(''); onDone?.(p); loadCentro(); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };
  return (
    <Card data-testid="link-connect">
      <CardHeader className="flex-row items-start gap-3"><Link2 className="text-primary mt-0.5 size-5 shrink-0" /><div><CardTitle>{t('link.connectTitle')}</CardTitle><CardDescription>{t('link.connectHint')}</CardDescription></div></CardHeader>
      <CardContent className="grid gap-3">
        <Field label={t('link.paste')} hint={t('link.pasteHint')}><Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('link.pastePh')} data-testid="link-paste" /></Field>
        <Field label={t('link.address')} hint={t('link.addressHint')}><Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="100.64.0.2:3131" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="go" /></Field>
        {error ? <p className="text-destructive text-sm" role="alert">{error}</p> : null}
      </CardContent>
      <CardFooter><Button size="sm" onClick={go} disabled={busy || !text.trim()} aria-busy={busy} data-testid="link-connect-go">{busy ? <LoaderCircle className="animate-spin" /> : <Link2 />}{t('link.connect')}</Button></CardFooter>
    </Card>
  );
}

function DevicesCard({ devices, readOnly, reload }) {
  const t = useT();
  // 3.6: with two or more people, the devices of each one under their name (the owner sees everyone's).
  const me = useStore((s) => s.me);
  const people = useStore((s) => s.people ?? []);
  const groups = personsOn(me) ? devicesByPerson(devices, people) : [{ person: null, name: '', devices }];
  const rename = (d) => form(t('link.renameTitle'), { initial: { name: d.name }, body: (v, set) => <Input autoFocus value={v.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} />, ok: t('link.save'), onOk: async (v) => { await call('link.rename', { id: d.id, name: v.name.trim() || d.name }); reload(); return true; } });
  const revoke = async (d) => { if (await confirm(t('link.revokeTitle', { name: d.name }), t('link.revokeBody'), { ok: t('link.revoke'), danger: true })) { await act(call('link.revoke', { id: d.id }), t('link.revoked')); reload(); } };
  const admin = async (d, on) => { await act(call('link.setAdmin', { id: d.id, admin: on }), on ? t('link.adminOn', { name: d.name }) : t('link.adminOff', { name: d.name })); reload(); };
  // 3.5.1: may it answer the bots' cards; and the owner's confirmation of an Orb that only said it was one (linked before
  // 3.5.1) or that wants to program for this one.
  const approveOn = async (d, on) => { await act(call('link.setApprove', { id: d.id, approve: on }), on ? t('link.approveOn', { name: d.name }) : t('link.approveOff', { name: d.name })); reload(); };
  const confirmIt = async (d, what) => { if (await confirm(t(what === 'taller' ? 'link.confirmTallerTitle' : 'link.confirmOrbTitle', { name: d.name }), t(what === 'taller' ? 'link.confirmTallerBody' : 'link.confirmOrbBody'), { ok: t('link.confirmOk') })) { await act(call('link.confirm', { id: d.id, what }), t('link.confirmed', { name: d.name })); reload(); } };
  return (
    <Card data-testid="link-devices">
      <CardHeader><CardTitle>{t('link.devices')}</CardTitle><CardDescription>{t('link.devicesHint')}</CardDescription></CardHeader>
      <CardContent className="grid gap-1.5">
        {!devices.length ? <p className="text-muted-foreground text-sm">{t('link.noDevices')}</p> : groups.map((g) => (
          <div key={g.person ?? 'all'} className="grid gap-1.5" data-testid="link-device-group">
            {g.person ? <div className="text-muted-foreground flex items-center gap-1.5 pt-1 text-xs font-medium" data-testid={`link-group-${g.name}`}><PersonDot name={g.name} size="sm" />{g.name}</div> : null}
            {sortDevices(g.devices).map((d) => {
          const Icon = kindIcon(d);
          return (
            <div key={d.id} className="flex items-center gap-3 rounded-xl border px-3 py-2" data-testid="link-device">
              <Icon className="text-muted-foreground size-5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2"><Dot on={d.online} /><span className="truncate text-sm font-medium">{d.name}</span>{d.kind === 'orb' ? <Badge variant="outline">{t(roleKey(d.role))}</Badge> : null}{readOnly && d.admin ? <Badge variant="outline">{t('link.admin')}</Badge> : null}{d.confirmed === false ? <Badge variant="warning">{t('link.unconfirmed')}</Badge> : null}</div>
                <div className="text-muted-foreground truncate text-xs">{[t(`link.kind.${d.kind}`), d.online ? t('link.onNow') : d.lastSeen ? t('link.seen', { when: ago(d.lastSeen) }) : t('link.never'), d.host].filter(Boolean).join(' · ')}</div>
              </div>
              {readOnly ? null : (<>
                {d.confirmed === false ? <Button size="xs" variant="outline" onClick={() => confirmIt(d, 'orb')} data-testid="link-confirm-orb">{t('link.confirmOrb')}</Button> : null}
                {d.confirmed !== false && d.devPending ? <Button size="xs" variant="outline" onClick={() => confirmIt(d, 'taller')} data-testid="link-confirm-taller">{t('link.confirmTaller')}</Button> : null}
                <label className="text-muted-foreground flex shrink-0 cursor-pointer items-center gap-1.5 text-xs" title={t('link.approveHint')}>
                  <Switch checked={d.approve !== false} onCheckedChange={(on) => approveOn(d, on)} aria-label={t('link.approve')} data-testid="link-approve" />
                  <span className="hidden sm:inline">{t('link.approve')}</span>
                </label>
                {d.kind !== 'orb' ? (
                  <label className="text-muted-foreground flex shrink-0 cursor-pointer items-center gap-1.5 text-xs" title={t('link.adminHint')}>
                    <Switch checked={Boolean(d.admin)} onCheckedChange={(on) => admin(d, on)} aria-label={t('link.admin')} data-testid="link-admin" />
                    <span className="hidden sm:inline">{t('link.admin')}</span>
                  </label>
                ) : null}
                <BubbleTip title={t('link.rename')}><Button size="icon-sm" variant="ghost" aria-label={t('link.rename')} onClick={() => rename(d)}><Pencil /></Button></BubbleTip>
                <BubbleTip title={t('link.revoke')}><Button size="icon-sm" variant="danger" aria-label={t('link.revoke')} onClick={() => revoke(d)} data-testid="link-revoke"><Trash2 /></Button></BubbleTip>
              </>)}
            </div>
          );
            })}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function PeersCard({ peers, reload }) {
  const t = useT();
  const server = useStore((s) => s.server);
  const drop = async (p) => {
    // 3.7: the Orb Server: its bots come back first, stay there, or nothing (the same three choices as Magic Link › Orb Server).
    if (server?.linked && server.peer?.id === p.id) { await askUnlinkServer(p); reload(); return; }
    if (await confirm(t('link.unlinkTitle', { name: p.name }), t('link.unlinkBody'), { ok: t('link.unlink'), danger: true })) { await act(call('link.disconnect', { id: p.id })); reload(); loadCentro(); } };
  return (
    <Card data-testid="link-peers">
      <CardHeader><CardTitle>{t('link.peers')}</CardTitle><CardDescription>{t('link.peersHint')}</CardDescription></CardHeader>
      <CardContent className="grid gap-1.5">
        {!peers.length ? <p className="text-muted-foreground text-sm">{t('link.noPeers')}</p> : peers.map((p) => (
          <div key={p.id} className="flex items-center gap-3 rounded-xl border px-3 py-2" data-testid="link-peer">
            {p.role === 'centro' ? <Server className="text-muted-foreground size-5 shrink-0" /> : <Monitor className="text-muted-foreground size-5 shrink-0" />}
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2"><Dot on={p.online && !p.revoked} /><span className="truncate text-sm font-medium">{p.name}</span><Badge variant="outline">{p.server || (server?.linked && server.peer?.id === p.id) ? t('link.role.server') : t(roleKey(p.role))}</Badge>{p.revoked ? <Badge variant="destructive">{t('link.closed')}</Badge> : null}</div>
              <div className="text-muted-foreground truncate text-xs">{[p.url, p.online ? t('link.onNow') : p.lastSeen ? t('link.seen', { when: ago(p.lastSeen) }) : null].filter(Boolean).join(' · ')}</div>
            </div>
            <BubbleTip title={t('link.unlink')}><Button size="icon-sm" variant="danger" aria-label={t('link.unlink')} onClick={() => drop(p)}><Unplug /></Button></BubbleTip>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// 3.6: a part of a settings section, with its heading (Ajustes › Magic Link › Usuarios…); id: the anchor the menu jumps to.
// Without a title (a phone's own screen), only its cards.
export function SubSection({ id, title, children }) {
  if (!title) return children;
  return (
    <section id={`settings-${id}`} className="grid scroll-mt-4 gap-4 [&>*]:min-w-0" data-testid={`settings-group-${id}`} aria-labelledby={`settings-${id}-title`}>
      <h3 id={`settings-${id}-title`} className="text-muted-foreground px-1 pt-3 text-[13px] font-medium">{title}</h3>
      {children}
    </section>
  );
}

// Everything of Magic Link. A device that may not manage the links (a phone) sees the list only.
// 3.6: in Ajustes (grouped) it is «who can enter this Orb»: Usuarios (users, given by Ajustes), Dispositivos (access
// from the phone, linking one and the linked ones) and Orbs enlazados.
export function MagicLinkPanel({ grouped = false, users = null, phoneAccess = null }) {
  const t = useT();
  const [data, setData] = useState(null);
  const access = useStore((s) => s.app?.access);
  // The PC, or a linked device marked «Puede administrar»; any other sees the list only.
  const canManage = canManageLinks({ mobile: bridge.mobile, access });
  const [manage, setManage] = useState(canManage);
  const [tick, setTick] = useState(0);
  const load = async () => {
    try {
      if (!canManage) throw new Error('phone');
      const [devices, peers, status] = await Promise.all([call('link.devices'), call('link.peers'), call('link.status').catch(() => null)]);
      setManage(true); setData({ devices, peers, status }); setTick((n) => n + 1);
    } catch {
      // A phone: only what link.status says (no addresses, no actions).
      try { const st = await call('link.status'); setManage(false); setData({ devices: st.devices ?? [], peers: [], role: st.role }); } catch (e) { setManage(false); setData({ devices: [], peers: [], error: errorText(e) }); }
    }
  };
  useEffect(() => {
    load();
    const id = setInterval(load, 10_000);
    const off = bridge.on('*', (event) => { if (event === 'link:devices' || event === 'link:peers' || event === 'link:status') load(); });
    return () => { clearInterval(id); off(); };
  }, []);
  if (!data) return null;
  const title = (id) => (grouped ? t(`settings.group.${id}`) : null);
  const orbs = !bridge.mobile || manage;
  return (
    <div className="grid gap-4 [&>*]:min-w-0" data-testid="magic-link">
      {users ? <SubSection id="usuarios" title={title('usuarios')}>{users}</SubSection> : null}
      <SubSection id="dispositivos" title={title('dispositivos')}>
        {phoneAccess}
        {manage ? <PairCard /> : <Card><CardContent className="text-muted-foreground text-sm">{t('link.onlyThere')}</CardContent></Card>}
        {data.error ? <p className="text-destructive text-sm">{data.error}</p> : null}
        <DevicesCard devices={data.devices} readOnly={!manage} reload={load} />
      </SubSection>
      {/* 3.7: «Añadir Orb Server» and, once linked, the Server (the PC, or a browser that may manage). */}
      {!bridge.mobile && manage ? <SubSection id="server" title={title('server')}><ServerLinkSection /></SubSection> : null}
      {orbs ? (
        <SubSection id="orbs" title={title('orbs')}>
          {!bridge.mobile ? <RoleCard /> : null}
          {!bridge.mobile ? <BotsPlaceCard refresh={tick} /> : null}
          {manage && data.status ? <DevTargetCard status={data.status} /> : null}
          {manage ? <ConnectCard onDone={load} /> : null}
          {manage ? <PeersCard peers={data.peers} reload={load} /> : null}
        </SubSection>
      ) : null}
    </div>
  );
}

export function MagicLinkView() {
  const t = useT();
  return (
    <>
      <PageHeader icon={<Radar className="text-primary size-5" />} title={t('link.title')} meta={t('link.titleHint')} />
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-5 sm:px-5"><div className="mx-auto grid max-w-3xl gap-4"><MagicLinkPanel /></div></div>
    </>
  );
}

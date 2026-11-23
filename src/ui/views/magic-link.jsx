// Magic Link, in Ajustes on the PC. «Enlazar dispositivo» shows a QR and a short code (5 minutes, one use) for a
// phone or a browser (in the page itself); and the list of linked devices, each with whether it is on, when it was last seen, rename and
// close its session. The phone asks for the master password to link, and unlinking one asks for it here.
import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { QrCode, Smartphone, Globe, Pencil, Trash2, Ellipsis, Copy, Check, LoaderCircle, ShieldCheck, TriangleAlert, ChevronDown, ExternalLink, KeyRound, RefreshCw, Monitor, Download, LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Badge, Input } from '@/components/ui/basic.jsx';
import { ListRow } from '@/components/ui/primitives.jsx';
import { Block, Panel, Stack, Hint, Setting, MoreOptions } from './settings/rows.jsx';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, Select } from '@/components/ui/overlay.jsx';
import { confirm, form } from '@/components/dialogs.jsx';
import { call, act, bridge } from '@/lib/store.js';
import { unlockCore } from '@/lib/core-access.js';
import { countdown, sortDevices } from '@/lib/link.js';
import { cn, ago } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';
import { notifyError } from '@/lib/notify.js';
import { quiet } from '@/lib/quiet.js';

const KIND_ICON = { phone: Smartphone, browser: Globe };

// A small row of choices (radio buttons), as the theme picker in Ajustes.
function Segmented({ label, value, options, onChange, testid }) {
  return (
    <div className="grid gap-1.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      <div className="bg-muted inline-flex w-fit gap-1 rounded-lg p-1" role="radiogroup" aria-label={label} data-testid={testid}>
        {options.map((o) => <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)} data-testid={`${testid}-${o.value}`} className={cn('cursor-pointer rounded-md px-3 py-1 text-control', value === o.value ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground')}>{o.label}</button>)}
      </div>
    </div>
  );
}

// The QR with its short code and how long it lasts (5 minutes, one use), drawn in the page itself. Nothing is made until the
// person asks (the button, or «Link again» on a device); the code lives only in this component, so leaving the section,
// closing Ajustes or locking Orb takes it off the screen. What is being linked (a phone or a browser) is chosen in
// «Más opciones» and the way in (Tailscale first, or the local network) here.
const PAIR_FOR = ['phone', 'browser'];
const PAIR_VIA = ['tailscale', 'wifi'];
function PairCard({ device, pair, onPair }) {
  const t = useT();
  const [via, setVia] = useState('tailscale');
  const [qr, setQr] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (!copied) return undefined; const id = setTimeout(() => setCopied(false), 1500); return () => clearTimeout(id); }, [copied]);
  useEffect(() => { if (!qr) return undefined; const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, [qr]);
  // A locked Orb leaves no live code on the screen.
  // reqN numbers every request: locking, unmounting and a newer make() invalidate the ones still in flight.
  const reqN = useRef(0);
  useEffect(() => bridge.on('master:locked', () => { reqN.current += 1; setQr(null); setBusy(false); onPair(null); }), []);
  useEffect(() => () => { reqN.current += 1; }, []);
  // A device has just linked: the code is spent, so it leaves the screen.
  useEffect(() => bridge.on('*', (event) => { if (event === 'link:devices') { reqN.current += 1; setQr(null); setBusy(false); } }), []);
  // The way asked for, or the one there is (without Tailscale, the local network): the choice shows what the code uses.
  const make = async (d = device, v = via) => {
    const n = ++reqN.current;
    setBusy(true);
    const r = await act(call('link.qr', { device: d, kind: v }));
    if (!alive.current || n !== reqN.current) return;
    const svg = r ? await QRCode.toString(r.url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) : null;
    if (!alive.current || n !== reqN.current) return;
    if (r) { setQr({ ...r, svg }); setVia(r.kind); }
    setBusy(false); setNow(Date.now());
  };
  // Asked for (the button, or a device to link again): a fresh code at once. Cleared: nothing is left.
  useEffect(() => {
    if (!pair) { setQr(null); return; }
    const v = pair.via ?? via;
    setVia(v); make(device, v);
  }, [pair]);
  const choose = (v) => { setVia(v); if (pair) make(device, v); };
  const expired = qr && now >= qr.expiresAt;
  // Once expired the code is dropped from the state (which also stops the interval); `expired` keeps the notice.
  const [wasExpired, setWasExpired] = useState(false);
  useEffect(() => { if (expired) { setWasExpired(true); setQr(null); } else if (qr) setWasExpired(false); }, [expired, qr]);
  const showing = qr && !expired;
  return (
    <Block title={t('link.pairTitle')} note={t('link.pairHint')} data-testid="link-pair">
      <Panel data-testid="link-pair-dialog">
        <Setting label={t('link.via')} hint={t('link.httpBrowserWarn')}>
          <Select caret="solid" value={via} onValueChange={choose} title={t('link.via')} data-testid="link-via"
            options={PAIR_VIA.map((k) => ({ value: k, label: t(k === 'wifi' ? 'settings.mobileWifi' : 'settings.mobileTs') }))} />
        </Setting>
        {showing ? (
          <>
            <div className={cn('animate-in fade-in-0 flex items-start gap-4 px-3.5 py-3 not-first:border-t duration-200 max-sm:flex-col', busy && 'opacity-60')} data-testid="mobile-qr">
              <img alt={t('link.qrAlt')} className="size-40 shrink-0 rounded-card bg-white p-2" src={`data:image/svg+xml;utf8,${encodeURIComponent(qr.svg)}`} data-testid="link-qr" />
              <div className="flex min-w-0 flex-col gap-1.5 text-control">
                <b className="font-medium">{t('link.expires')} <span className="tabular-nums" data-testid="link-countdown">{countdown(qr.expiresAt, now)}</span></b>
                <span className="text-muted-foreground text-caption">{t(qr.kind === 'wifi' ? 'settings.qrScanWifi' : 'settings.qrScanTs')}</span>
                <span className="text-muted-foreground flex items-center gap-1.5 text-caption" data-testid="link-pass-note"><KeyRound className="size-3.5 shrink-0" />{t('link.passNote')}</span>
                <span className="text-muted-foreground text-caption">{t('link.orCode')}</span>
                <code className="bg-muted w-fit rounded-ctl px-2.5 py-1 font-mono text-[20px] font-semibold tracking-widest tabular-nums select-all" data-testid="link-code">{qr.code}</code>
                <code className="text-muted-foreground font-mono text-caption break-all">{qr.address}</code>
                {qr.device === 'browser' && !qr.browserOk ? <span className="text-warning-ink flex items-start gap-1.5 text-caption" role="alert" data-testid="link-http-warn"><TriangleAlert className="mt-0.5 size-3.5 shrink-0" />{t('link.httpBrowserWarn')}</span> : null}
                {qr.device === 'phone' && qr.kind === 'wifi' && !qr.secure ? <span className="text-muted-foreground text-caption" data-testid="link-android-note">{t('link.preferHttps')}</span> : null}
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => make()} disabled={busy} data-testid="link-again"><RefreshCw />{t('link.again')}</Button>
                  {navigator.clipboard ? <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(`${qr.code} ${qr.address}`).then(() => setCopied(true)).catch(quiet)} data-testid="link-copy">{copied ? <Check className="text-success animate-in fade-in-0 zoom-in-95" /> : <Copy />}{copied ? t('link.copied') : t('link.copy')}</Button> : null}
                </div>
              </div>
            </div>
            <Setting label={t('link.fpLabel')} hint={t('link.fpHint')} data-testid="link-fp"><code className="font-mono text-caption break-all">{qr.pc}</code></Setting>
          </>
        ) : (
          <Stack>
            <div className="flex flex-wrap items-center gap-2">
              {busy ? <LoaderCircle className="text-muted-foreground size-5 animate-spin" />
                : wasExpired ? <Button size="sm" onClick={() => onPair({})} data-testid="link-again"><QrCode />{t('link.again')}</Button>
                  : <Button size="sm" onClick={() => onPair({})} data-testid="link-make"><QrCode />{t('link.make')}</Button>}
              {wasExpired ? <span className="text-muted-foreground text-caption">{t('link.expired')}</span> : null}
            </div>
          </Stack>
        )}
      </Panel>
    </Block>
  );
}

// What the drawing does not show, for «Más opciones»: what is being linked, and how to reach this PC from outside home.
function PairMore({ device, onDevice }) {
  const t = useT();
  return (
    <Panel>
      <Stack><Segmented label={t('link.forWhat')} value={device} onChange={onDevice} testid="link-for" options={PAIR_FOR.map((k) => ({ value: k, label: t(`link.for.${k}`) }))} /></Stack>
      {device === 'phone' ? <Stack><OutsideGuide /></Stack> : null}
    </Panel>
  );
}


// «Usar fuera de casa»: Tailscale on both, switched on in Ajustes › Móvil; the PC has to be on.
function OutsideGuide() {
  const t = useT();
  return (
    <details className="group w-full rounded-lg border px-3 py-2 text-sm sm:col-span-2" data-testid="link-outside">
      <summary className="flex cursor-pointer list-none items-center gap-2 font-medium"><Globe className="text-muted-foreground size-4" />{t('link.outTitle')}<ChevronDown className="text-muted-foreground ml-auto size-4 transition-transform duration-200 group-open:rotate-180" /></summary>
      <ol className="mt-2 grid list-decimal gap-1 pl-5 text-control"><li>{t('link.out1')}</li><li>{t('link.out2')}</li><li>{t('link.out3')}</li></ol>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Button size="xs" variant="outline" onClick={() => bridge.openExternal('https://tailscale.com/download').catch((e) => notifyError(e))}><ExternalLink />{t('link.outGet')}</Button>
        <span className="text-muted-foreground text-xs">{t('link.outPcOn')}</span>
      </div>
    </details>
  );
}

const OS_KEY = { windows: 'windows', android: 'android', ios: 'ios', macos: 'macos', linux: 'linux' };

// Tailscale as the account: install it, sign in (Google, GitHub…) and see the devices of the same account. Finding a device
// here links nothing: a phone still needs the code from this screen and the master password.
function TailscaleCard() {
  const t = useT();
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => call('tailscale.status').then(setInfo).catch(() => setInfo({ installed: false, state: 'missing', devices: [] }));
  useEffect(() => { load(); const id = setInterval(load, busy ? 3000 : 15_000); return () => clearInterval(id); }, [busy]);
  if (!info) return null;
  const install = async () => { setBusy(true); try { await act(call('installer.start', { ids: ['tailscale'] }), t('link.ts.installing')); } finally { setTimeout(() => setBusy(false), 60_000); } };
  const login = async () => {
    setBusy(true);
    try {
      const r = await call('tailscale.login');
      if (r?.url) await bridge.openExternal(r.url); else if (r?.missing) notifyError(new Error(t('link.ts.notInstalled')));
    } catch (e) { notifyError(e); } finally { setTimeout(() => setBusy(false), 60_000); }
  };
  const running = info.state === 'running';
  const note = !info.installed ? t('link.ts.notInstalled') : running ? t('link.ts.account', { account: info.account ?? info.tailnet ?? '' }) : t('link.ts.needsLogin');
  return (
    <Block title={t('link.ts.title')} count={running ? info.devices.length : undefined} note={note} data-testid="link-tailscale">
      <Panel>
        {!info.installed ? (
          <Stack><Button size="sm" onClick={install} disabled={busy} data-testid="ts-install"><Download />{t('link.ts.install')}</Button><Hint>{t('link.ts.installHint')}</Hint></Stack>
        ) : !running ? (
          <Stack><Button size="sm" onClick={login} disabled={busy} data-testid="ts-login"><LogIn />{t('link.ts.login')}</Button><Hint>{t('link.ts.loginHint')}</Hint></Stack>
        ) : (
          <>
            {info.self ? <Stack><Hint data-testid="ts-self">{t('link.ts.self', { name: info.self.dns ?? info.self.name })}</Hint></Stack> : null}
            {!info.devices.length ? <Stack><Hint>{t('link.ts.noDevices')}</Hint></Stack> : info.devices.map((d) => (
              <ListRow key={d.dns ?? d.name} className="border-border rounded-none not-first:border-t" data-testid="ts-device" leading={d.os === 'android' || d.os === 'ios' ? <Smartphone className="text-muted-foreground size-4 shrink-0" /> : <Monitor className="text-muted-foreground size-4 shrink-0" />}
                title={d.name}
                meta={[OS_KEY[d.os] ? t(`link.ts.os.${OS_KEY[d.os]}`) : null, d.online ? t('link.onNow') : d.lastSeen ? t('link.seen', { when: ago(d.lastSeen) }) : t('link.never')].filter(Boolean).join(' · ')}
                trailing={<div className="flex items-center gap-1.5">{d.orbDevice ? <Badge variant="success" data-testid="ts-linked">{t('link.ts.linked')}</Badge> : null}<Badge variant={d.online ? 'success' : 'secondary'}>{d.online ? t('link.online') : t('link.offline')}</Badge></div>} />
            ))}
          </>
        )}
      </Panel>
    </Block>
  );
}

function DevicesCard({ devices, reload, onPair }) {
  const t = useT();
  const rename = (d) => form(t('link.renameTitle'), { initial: { name: d.name }, body: (v, set) => <Input autoFocus value={v.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} />, ok: t('link.save'), onOk: async (v) => { await call('link.rename', { id: d.id, name: v.name.trim() || d.name }); reload(); return true; } });
  const revoke = async (d) => {
    if (!(await confirm(t('link.revokeTitle', { name: d.name }), t('link.revokeBody'), { ok: t('link.revoke'), danger: true }))) return;
    const unlock = await unlockCore('unlink'); if (!unlock) return;
    await act(call('link.revoke', { id: d.id, unlock }), t('link.revoked')); reload();
  };
  return (
    <Block title={t('link.devices')} count={devices.length} note={t('link.devicesHint')} data-testid="link-devices">
      <Panel>
        {!devices.length ? <Stack><Hint>{t('link.noDevices')}</Hint></Stack> : sortDevices(devices).map((d) => {
          const Icon = KIND_ICON[d.kind] ?? Smartphone;
          return (
            <ListRow key={d.id} className="border-border rounded-none not-first:border-t" data-testid="link-device" leading={<Icon className="text-muted-foreground size-4 shrink-0" />} title={d.name}
              meta={[t(`link.kind.${d.kind}`), d.online ? t('link.onNow') : d.lastSeen ? `${t('link.offline')} · ${t('link.seen', { when: ago(d.lastSeen) })}` : t('link.never')].filter(Boolean).join(' · ')}
              trailing={(
                <div className="flex items-center gap-1.5">
                  {/* over the local network, a device that no longer connects (the PC's address changed) is linked again. */}
                  {!d.online && d.lastSeen && d.route === 'wifi' ? <Button size="xs" variant="outline" onClick={() => onPair({ device: d.kind === 'browser' ? 'browser' : 'phone', via: 'wifi' })} data-testid="link-relink">{t('link.relink')}</Button> : null}
                  <Badge variant={d.online ? 'success' : 'secondary'}>{d.online ? t('link.online') : t('link.offline')}</Badge>
                  {/* the mock-up's «…» menu: rename and sign out, with the same calls and the same confirmation as before */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button size="icon-xs" variant="ghost" aria-label={t('settings.moreOptions')} title={t('settings.moreOptions')} data-testid="link-menu"><Ellipsis /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem onSelect={() => rename(d)} data-testid="link-rename"><Pencil />{t('link.rename')}</DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onSelect={() => revoke(d)} data-testid="link-revoke"><Trash2 />{t('link.revoke')}</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )} />
          );
        })}
      </Panel>
    </Block>
  );
}

// a part of a settings section, with its heading (Ajustes › Datos › Copias…); id: the anchor the menu jumps to.
// Without a title (a phone's own screen), only its cards.
export function SubSection({ id, title, children }) {
  if (!title) return children;
  return (
    <section id={`settings-${id}`} className="grid scroll-mt-4 gap-4 [&>*]:min-w-0" data-testid={`settings-group-${id}`} aria-label={title}>
      {children}
    </section>
  );
}

// Everything of Magic Link. In Ajustes it is «who can enter this Orb»: Dispositivos (access from the phone, linking one
// and the linked ones).
export function MagicLinkPanel({ grouped = false, phoneAccess = null }) {
  const t = useT();
  const [devices, setDevices] = useState(null);
  const [pair, setPair] = useState(null);
  const [device, setDevice] = useState('phone');
  // null clears the code; a request (from the button, or a device to link again) asks for a new one.
  const ask = (req) => { if (req?.device) setDevice(req.device); setPair((p) => (req ? { via: req.via, n: (p?.n ?? 0) + 1 } : null)); };
  const pickDevice = (d) => { setDevice(d); setPair((p) => (p ? { via: undefined, n: p.n + 1 } : p)); };
  const load = () => call('link.devices').then(setDevices).catch(() => setDevices([]));
  useEffect(() => {
    load();
    const id = setInterval(load, 10_000);
    const off = bridge.on('*', (event) => { if (event === 'link:devices') load(); });
    return () => { clearInterval(id); off(); };
  }, []);
  if (!devices) return null;
  const more = <PairMore device={device} onDevice={pickDevice} />;
  const title = (id) => (grouped ? t(`settings.group.${id}`) : null);
  return (
    <div className="grid gap-4 [&>*]:min-w-0" data-testid="magic-link">
      <SubSection id="dispositivos" title={title('dispositivos')}>
        <PairCard device={device} pair={pair} onPair={ask} />
        <DevicesCard devices={devices} reload={load} onPair={ask} />
        <TailscaleCard />
        {/* phoneAccess draws «Acceso desde otros dispositivos» and puts the pairing options inside its «Más opciones» */}
        {phoneAccess ? phoneAccess(more) : <MoreOptions testid="link-more-options">{more}</MoreOptions>}
      </SubSection>
    </div>
  );
}

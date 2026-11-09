// 3.5: Magic Link, in Ajustes on the PC. «Enlazar dispositivo» shows a QR and a short code (5 minutes, one use) for a
// phone or a browser (3.8.2: in a dialog); and the list of linked devices, each with whether it is on, when it was last seen, rename and
// close its session. 3.8: the phone asks for the master password to link, and unlinking one asks for it here.
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { QrCode, Smartphone, Globe, Pencil, Trash2, Copy, Check, LoaderCircle, ShieldCheck, TriangleAlert, ChevronDown, ExternalLink, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, Input } from '@/components/ui/basic.jsx';
import { BubbleTip, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/overlay.jsx';
import { confirm, form } from '@/components/dialogs.jsx';
import { call, act, bridge } from '@/lib/store.js';
import { unlockCore } from '@/lib/core-access.js';
import { countdown, sortDevices } from '@/lib/link.js';
import { cn, ago } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';

const KIND_ICON = { phone: Smartphone, browser: Globe };

function Dot({ on }) { const t = useT(); return <span className={cn('size-2 shrink-0 rounded-full', on ? 'bg-success' : 'bg-muted-foreground/40')} role="img" aria-label={on ? t('link.online') : t('link.offline')} />; }

// A small row of choices (radio buttons), as the theme picker in Ajustes.
function Segmented({ label, value, options, onChange, testid }) {
  return (
    <div className="grid gap-1.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      <div className="bg-muted inline-flex w-fit gap-1 rounded-lg p-1" role="radiogroup" aria-label={label} data-testid={testid}>
        {options.map((o) => <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)} data-testid={`${testid}-${o.value}`} className={cn('cursor-pointer rounded-md px-3 py-1 text-[13px]', value === o.value ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground')}>{o.label}</button>)}
      </div>
    </div>
  );
}

// The QR with its short code and how long it lasts (5 minutes, one use). 3.5.1: what it is for (a phone or a browser) is
// decided here, the device cannot change it. 3.8.2: «Enlazar dispositivo» opens it in a dialog, where both that and the
// way in (Tailscale first, or the local network) are chosen; the card itself only says what to do.
const PAIR_FOR = ['phone', 'browser'];
const PAIR_VIA = ['tailscale', 'wifi'];
function PairDialog({ open: want, onClose }) {
  const t = useT();
  const [device, setDevice] = useState('phone');
  const [via, setVia] = useState('tailscale');
  const [qr, setQr] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!copied) return undefined; const id = setTimeout(() => setCopied(false), 1500); return () => clearTimeout(id); }, [copied]);
  useEffect(() => { if (!qr) return undefined; const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, [qr]);
  // The way asked for, or the one there is (without Tailscale, the local network): the choice shows what the code uses.
  const make = async (d = device, v = via) => {
    setBusy(true);
    const r = await act(call('link.qr', { device: d, kind: v }));
    if (r) { setQr({ ...r, svg: await QRCode.toString(r.url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) }); setVia(r.kind); }
    setBusy(false); setNow(Date.now());
  };
  // Opened (or opened again to link a device back): its choices, and a fresh code at once.
  useEffect(() => {
    if (!want) { setQr(null); return; }
    const d = want.device ?? 'phone'; const v = want.via ?? 'tailscale';
    setDevice(d); setVia(v); make(d, v);
  }, [want]);
  const choose = (d, v) => { setDevice(d); setVia(v); make(d, v); };
  const expired = qr && now >= qr.expiresAt;
  return (
    <Dialog open={Boolean(want)} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-xl" data-testid="link-pair-dialog">
        <DialogHeader><DialogTitle>{t('link.pairTitle')}</DialogTitle><DialogDescription>{t('link.pairHint')}</DialogDescription></DialogHeader>
        <div className="flex flex-wrap gap-4">
          <Segmented label={t('link.forWhat')} value={device} onChange={(d) => choose(d, via)} testid="link-for" options={PAIR_FOR.map((k) => ({ value: k, label: t(`link.for.${k}`) }))} />
          <Segmented label={t('link.via')} value={via} onChange={(v) => choose(device, v)} testid="link-via" options={PAIR_VIA.map((k) => ({ value: k, label: t(k === 'wifi' ? 'settings.mobileWifi' : 'settings.mobileTs') }))} />
        </div>
        {qr && !expired ? (
          <div className={cn('animate-in fade-in-0 zoom-in-95 grid items-center justify-items-center gap-4 rounded-xl border p-4 duration-200 sm:grid-cols-[auto_1fr] sm:justify-items-start', busy && 'opacity-60')} data-testid="mobile-qr">
            <img alt={t('link.qrAlt')} className="size-52 rounded-lg bg-white p-2" src={`data:image/svg+xml;utf8,${encodeURIComponent(qr.svg)}`} data-testid="link-qr" />
            <div className="grid gap-2 text-center sm:text-left">
              <p className="text-sm">{t(qr.kind === 'wifi' ? 'settings.qrScanWifi' : 'settings.qrScanTs')}</p>
              <p className="text-muted-foreground flex items-center justify-center gap-1.5 text-xs sm:justify-start" data-testid="link-pass-note"><KeyRound className="size-3.5 shrink-0" />{t('link.passNote')}</p>
              <div className="text-muted-foreground text-xs">{t('link.orCode')}</div>
              <div className="flex items-center justify-center gap-2 sm:justify-start">
                <span className="bg-muted rounded-lg px-3 py-1.5 font-mono text-2xl font-semibold tracking-widest tabular-nums select-all" data-testid="link-code">{qr.code}</span>
                {navigator.clipboard ? <Button size="icon-sm" variant="ghost" aria-label={copied ? t('link.copied') : t('link.copy')} title={copied ? t('link.copied') : t('link.copy')} onClick={() => navigator.clipboard.writeText(`${qr.code} ${qr.address}`).then(() => setCopied(true)).catch(() => {})} data-testid="link-copy">{copied ? <Check className="text-success animate-in fade-in-0 zoom-in-95" /> : <Copy />}</Button> : null}
              </div>
              <div className="text-muted-foreground font-mono text-xs break-all">{qr.address}</div>
              <div className="flex items-center justify-center gap-1.5 text-xs sm:justify-start" data-testid="link-fp"><ShieldCheck className="text-success size-3.5 shrink-0" />{t('link.fp', { fp: qr.pc })}</div>
              {qr.device === 'browser' && !qr.browserOk ? <div className="text-warning flex items-start gap-1.5 text-xs" role="alert" data-testid="link-http-warn"><TriangleAlert className="mt-0.5 size-3.5 shrink-0" />{t('link.httpBrowserWarn')}</div> : null}
              {qr.device === 'phone' && qr.kind === 'wifi' && !qr.secure ? <div className="text-muted-foreground text-xs" data-testid="link-android-note">{t('link.preferHttps')}</div> : null}
              <div className="text-sm">{t('link.expires')} <span className="font-medium tabular-nums" data-testid="link-countdown">{countdown(qr.expiresAt, now)}</span></div>
            </div>
            {/* 3.6: reaching this PC from outside home, explained where it is needed: when linking a phone. */}
            {qr.device === 'phone' ? <OutsideGuide /> : null}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {busy ? <LoaderCircle className="text-muted-foreground size-5 animate-spin" /> : <Button onClick={() => make()} data-testid="link-again"><QrCode />{t('link.again')}</Button>}
            {expired ? <span className="text-muted-foreground text-xs">{t('link.expired')}</span> : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PairCard({ onPair }) {
  const t = useT();
  return (
    <Card data-testid="link-pair">
      <CardHeader className="flex-row items-start gap-3"><QrCode className="text-primary mt-0.5 size-5 shrink-0" /><div><CardTitle>{t('link.pairTitle')}</CardTitle><CardDescription>{t('link.pairHint')}</CardDescription></div></CardHeader>
      <CardContent><Button onClick={() => onPair({})} data-testid="link-make"><QrCode />{t('link.make')}</Button></CardContent>
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

function DevicesCard({ devices, reload, onPair }) {
  const t = useT();
  const rename = (d) => form(t('link.renameTitle'), { initial: { name: d.name }, body: (v, set) => <Input autoFocus value={v.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} />, ok: t('link.save'), onOk: async (v) => { await call('link.rename', { id: d.id, name: v.name.trim() || d.name }); reload(); return true; } });
  const revoke = async (d) => {
    if (!(await confirm(t('link.revokeTitle', { name: d.name }), t('link.revokeBody'), { ok: t('link.revoke'), danger: true }))) return;
    const unlock = await unlockCore('unlink'); if (!unlock) return;
    await act(call('link.revoke', { id: d.id, unlock }), t('link.revoked')); reload();
  };
  return (
    <Card data-testid="link-devices">
      <CardHeader><CardTitle>{t('link.devices')}</CardTitle><CardDescription>{t('link.devicesHint')}</CardDescription></CardHeader>
      <CardContent className="grid gap-1.5">
        {!devices.length ? <p className="text-muted-foreground text-sm">{t('link.noDevices')}</p> : sortDevices(devices).map((d) => {
          const Icon = KIND_ICON[d.kind] ?? Smartphone;
          return (
            <div key={d.id} className="flex items-center gap-3 rounded-xl border px-3 py-2" data-testid="link-device">
              <Icon className="text-muted-foreground size-5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2"><Dot on={d.online} /><span className="truncate text-sm font-medium">{d.name}</span></div>
                <div className="text-muted-foreground truncate text-xs">{[t(`link.kind.${d.kind}`), d.online ? t('link.onNow') : d.lastSeen ? `${t('link.offline')} · ${t('link.seen', { when: ago(d.lastSeen) })}` : t('link.never')].filter(Boolean).join(' · ')}</div>
              </div>
              {/* 3.8.2: over the local network, a device that no longer connects (the PC's address changed) is linked again. */}
              {!d.online && d.lastSeen && d.route === 'wifi' ? <Button size="xs" variant="outline" onClick={() => onPair({ device: d.kind === 'browser' ? 'browser' : 'phone', via: 'wifi' })} data-testid="link-relink">{t('link.relink')}</Button> : null}
              <BubbleTip title={t('link.rename')}><Button size="icon-sm" variant="ghost" aria-label={t('link.rename')} onClick={() => rename(d)}><Pencil /></Button></BubbleTip>
              <BubbleTip title={t('link.revoke')}><Button size="icon-sm" variant="danger" aria-label={t('link.revoke')} onClick={() => revoke(d)} data-testid="link-revoke"><Trash2 /></Button></BubbleTip>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// 3.6: a part of a settings section, with its heading (Ajustes › Datos › Copias…); id: the anchor the menu jumps to.
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

// Everything of Magic Link. In Ajustes it is «who can enter this Orb»: Dispositivos (access from the phone, linking one
// and the linked ones).
export function MagicLinkPanel({ grouped = false, phoneAccess = null }) {
  const t = useT();
  const [devices, setDevices] = useState(null);
  const [pair, setPair] = useState(null);
  const load = () => call('link.devices').then(setDevices).catch(() => setDevices([]));
  useEffect(() => {
    load();
    const id = setInterval(load, 10_000);
    const off = bridge.on('*', (event) => { if (event === 'link:devices') load(); });
    return () => { clearInterval(id); off(); };
  }, []);
  if (!devices) return null;
  const title = (id) => (grouped ? t(`settings.group.${id}`) : null);
  return (
    <div className="grid gap-4 [&>*]:min-w-0" data-testid="magic-link">
      <SubSection id="dispositivos" title={title('dispositivos')}>
        {phoneAccess}
        <PairCard onPair={setPair} />
        <DevicesCard devices={devices} reload={load} onPair={setPair} />
        <PairDialog open={pair} onClose={() => setPair(null)} />
      </SubSection>
    </div>
  );
}

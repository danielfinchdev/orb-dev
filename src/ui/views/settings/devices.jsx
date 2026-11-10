// Ajustes: Android, the phone and the browser linked with this PC (Magic Link), and «Este móvil».
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import QRCode from 'qrcode';
import { FolderOpen, Smartphone, Globe, PictureInPicture2 } from 'lucide-react';
import { PageHeader } from '@/components/page.jsx';
import { confirm, form } from '@/components/dialogs.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter, Field, Input, PathText, Spinner } from '@/components/ui/basic.jsx';
import { Select, Switch, BubbleTip } from '@/components/ui/overlay.jsx';
import { call, act, bridge } from '@/lib/store.js';
import { cn } from '@/lib/utils.js';
import { t, useT } from '@/lib/i18n.js';
import { unlockCore } from '@/lib/core-access.js';
import { save, Row, PREVIEWS, previewOf } from './rows.jsx';

// 3.8.2 (D2): the pairing of «Emparejar móvil»: Android's QR (Depuración inalámbrica) that the engine waits for on the
// network, or the six-digit code by hand. unlock: the master password's token (pairing gives the agents a way in).
function PairPanel({ v, set }) {
  const t = useT();
  const [st, setSt] = useState(null); const [svg, setSvg] = useState('');
  const start = async () => {
    setSt(null); setSvg('');
    const unlock = await unlockCore('androidPair'); if (!unlock) return;
    const r = await act(call('android.pairStart', { unlock }));
    if (r) { setSt(r); setSvg(await QRCode.toString(r.qr, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })); }
  };
  useEffect(() => { if (!v.manual) start(); return () => { call('android.pairCancel').catch(() => {}); }; }, [v.manual]);
  useEffect(() => {
    if (st?.state !== 'waiting' && st?.state !== 'pairing') return undefined;
    const id = setInterval(() => { call('android.pairState').then(setSt).catch(() => {}); }, 1500);
    return () => clearInterval(id);
  }, [st?.state]);
  if (v.manual) return (
    <div className="grid gap-3">
      <p className="text-muted-foreground text-sm">{t('settings.android.manualSteps')}</p>
      <Field label={t('settings.android.address')}><Input value={v.address} onChange={(e) => set({ address: e.target.value.trim() })} placeholder="192.168.1.20:37000" autoFocus data-testid="android-pair-address" /></Field>
      <Field label={t('settings.android.code')}><Input value={v.code} inputMode="numeric" maxLength={6} onChange={(e) => set({ code: e.target.value.replace(/\D/g, '') })} data-testid="android-pair-code" /></Field>
      <Field label={t('settings.android.connectAddress')} hint={t('settings.android.connectHint')}><Input value={v.connect} onChange={(e) => set({ connect: e.target.value.trim() })} placeholder="192.168.1.20:41000" /></Field>
    </div>
  );
  const label = { waiting: 'settings.android.waiting', pairing: 'settings.android.pairing', done: 'settings.android.paired', expired: 'settings.android.expired' }[st?.state];
  return (
    <div className="grid justify-items-center gap-3">
      {svg ? <div className="size-56 rounded-xl bg-white p-2 [&_svg]:size-full" data-testid="android-pair-qr" dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="grid size-56 place-items-center"><Spinner /></div>}
      <div className={cn('flex items-center gap-2 text-sm', st?.state === 'error' && 'text-destructive')} data-testid="android-pair-state">
        {st?.state === 'waiting' || st?.state === 'pairing' ? <Spinner /> : null}{st?.state === 'error' ? st.error : label ? t(label) : null}
      </div>
      {st?.state === 'expired' || st?.state === 'error' ? <Button size="sm" variant="outline" onClick={start}>{t('settings.android.retry')}</Button> : null}
      <Button size="sm" variant="ghost" onClick={() => set({ manual: true })} data-testid="android-pair-manual">{t('settings.android.manual')}</Button>
    </div>
  );
}

// Ajustes › Android: the phone the agents test apps on (paired here, used in a chat with «Usar mi móvil Android») and
// Google's platform-tools, downloaded into core\herramientas\adb the first time.
export function AndroidCard() {
  const t = useT();
  const [st, setSt] = useState(null);
  const [phones, setPhones] = useState([]);
  const [emus, setEmus] = useState(null); // 3.8.2 (T3 3.17): { sdk, avds } of this PC's Android SDK
  const [tools, setTools] = useState(null); // 3.8.3: Flutter, the Android SDK and a JDK as they are (engine/dev-tools.mjs)
  const load = () => call('android.status').then(setSt).catch(() => setSt(null));
  const loadPhones = () => call('android.devices').then(setPhones).catch(() => setPhones([]));
  useEffect(() => { load(); const id = setInterval(load, st?.state === 'downloading' ? 1500 : 15000); return () => clearInterval(id); }, [st?.state]);
  useEffect(() => { loadPhones(); const id = setInterval(loadPhones, 15000); return () => clearInterval(id); }, []);
  useEffect(() => { call('android.emulators').then(setEmus).catch(() => setEmus(null)); }, []);
  useEffect(() => { call('devtools.check').then(setTools).catch(() => setTools(null)); }, []);
  // Starting one asks for the master password, as pairing a phone: the agents with the phone may then use it.
  const startEmulator = async (avd) => {
    const unlock = await unlockCore('androidEmulator'); if (!unlock) return;
    const r = await act(call('android.emulatorStart', { avd, unlock }));
    if (r) { toast(r); setTimeout(loadPhones, 30_000); }
  };
  const pair = async () => {
    await form(t('settings.android.pair'), {
      description: t('settings.android.pairSteps'), initial: { manual: false, address: '', code: '', connect: '' },
      body: (v, set) => <PairPanel v={v} set={set} />,
      ok: t('settings.android.pairButton'),
      onOk: async (v) => {
        if (!v.manual) return true;
        const unlock = await unlockCore('androidPair'); if (!unlock) throw new Error(t('msg.master.needUnlock'));
        return call('android.pairCode', { address: v.address, code: v.code, connect: v.connect || undefined, unlock });
      }
    });
    loadPhones(); load();
  };
  const forget = async (p) => { if (await confirm(t('settings.android.forget'), t('settings.android.forgetBody'), { ok: t('settings.android.forget') })) { await act(call('android.forget', { serial: p.serial ?? undefined, host: p.host ?? undefined })); loadPhones(); } };
  if (!st) return null;
  const label = st.ready ? t('settings.android.ready') : st.state === 'downloading' ? t('settings.android.downloading') : st.state === 'error' ? t('settings.android.error', { error: st.error }) : t('settings.android.missing');
  return (
    <Card data-testid="android-card">
      <CardHeader><CardTitle>{t('settings.android')}</CardTitle><CardDescription>{t('settings.androidDesc')}</CardDescription></CardHeader>
      <CardContent className="grid gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="grid min-w-0 flex-1"><div className={cn('text-sm', st.state === 'error' && 'text-destructive')}>{label}</div><PathText path={st.dir} className="text-muted-foreground text-xs" /></div>
          {st.ready ? <BubbleTip title={t('settings.open')}><Button size="icon-sm" variant="ghost" onClick={() => act(bridge.openPath(st.dir))} aria-label={t('settings.open')}><FolderOpen /></Button></BubbleTip>
            : st.state !== 'downloading' ? <Button size="sm" variant="outline" onClick={async () => { setSt({ ...st, state: 'downloading' }); const r = await act(call('android.install')); if (r) setSt(r); else load(); }}>{t('settings.android.download')}</Button> : null}
        </div>
        <div className="grid gap-1" data-testid="android-phones">
          {phones.length ? phones.map((p) => (
            <div key={`${p.guid ?? ''}${p.serial ?? p.host}`} className="flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2">
              <Smartphone className="text-muted-foreground size-4 shrink-0" />
              <div className="grid min-w-0 flex-1"><span className="truncate text-sm">{p.model ?? p.host}</span><span className={cn('text-xs', p.connected ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')}>{t(p.connected ? 'settings.android.connected' : 'settings.android.offline')}</span></div>
              {p.connected ? <Button size="sm" variant="ghost" onClick={async () => { await act(call('android.disconnect', { serial: p.serial })); loadPhones(); }}>{t('settings.android.disconnect')}</Button> : null}
              <Button size="sm" variant="ghost" onClick={() => forget(p)}>{t('settings.android.forget')}</Button>
            </div>
          )) : <span className="text-muted-foreground text-sm">{t('settings.android.noDevices')}</span>}
        </div>
        {emus ? (
          <div className="grid gap-1" data-testid="android-emulators">
            <span className="text-muted-foreground mt-1 text-xs font-medium">{t('settings.android.emulators')}</span>
            {!emus.sdk ? <span className="text-muted-foreground text-sm">{t('settings.android.noEmulator')}</span>
              : emus.avds.length ? emus.avds.map((avd) => (
                <div key={avd} className="flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2">
                  <Smartphone className="text-muted-foreground size-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-sm">{avd.replace(/_/g, ' ')}</span>
                  <Button size="sm" variant="ghost" onClick={() => startEmulator(avd)}>{t('settings.android.startEmulator')}</Button>
                </div>
              )) : <span className="text-muted-foreground text-sm">{t('settings.android.noAvds')}</span>}
          </div>
        ) : null}
        {tools ? (
          <div className="grid gap-1" data-testid="dev-tools">
            <span className="text-muted-foreground mt-1 text-xs font-medium">{t('settings.devtools.title')}</span>
            {tools.map((x) => (
              <div key={x.id} className="flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2" data-testid="dev-tool" data-found={x.path ? 'yes' : 'no'}>
                <div className="grid min-w-0 flex-1">
                  <span className="truncate text-sm">{x.label} · <span className={x.path ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}>{t(x.path ? 'settings.devtools.installed' : x.inCore ? 'settings.devtools.inCore' : 'settings.devtools.missing')}</span></span>
                  {x.path ? <PathText path={x.path} className="text-muted-foreground text-xs" /> : null}
                  {x.missing.map((m) => <span key={m} className="text-muted-foreground truncate text-xs">{t('settings.devtools.gone', { path: m })}</span>)}
                </div>
                {x.path ? null : <Button size="sm" variant="ghost" onClick={() => bridge.openExternal(x.url)}>{t('settings.devtools.how')}</Button>}
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
      <CardFooter><Button size="sm" onClick={pair} data-testid="android-pair"><Smartphone />{t('settings.android.pair')}</Button></CardFooter>
    </Card>
  );
}

// Phone access: on/off and the addresses (wifi, Tailscale). 3.5: the QR and the linked devices are in Magic Link.
export function MobileCard() {
  const t = useT();
  const [st, setSt] = useState(null);
  const load = () => call('remote.status').then(setSt).catch(() => {});
  useEffect(() => { load(); }, []);
  const configure = async (patch) => { const r = await act(call('remote.configure', patch)); if (r) setSt(r); };
  if (!st) return null;
  const route = (kind) => st.routes?.find((r) => r.kind === kind);
  const via = (kind) => {
    const r = route(kind);
    // 3.8.2: the local network shows its address; Tailscale, what it allows (its address is in the QR dialog).
    const hint = st.enabled && st[kind] && !r ? t('settings.mobileUnavailable') : kind === 'wifi' ? (r?.url ?? t('settings.mobileWifiHint')) : t('settings.mobileTsHint');
    return (
      <Row label={t(kind === 'wifi' ? 'settings.mobileWifi' : 'settings.mobileTs')} hint={hint}>
        <Switch data-testid={`mobile-${kind}`} checked={st[kind]} onCheckedChange={(on) => configure({ [kind]: on })} />
      </Row>
    );
  };
  return (
    <Card data-testid="mobile-card">
      <CardHeader className="flex-row items-start gap-3 [&>svg]:mt-0.5 [&>svg]:shrink-0"><Smartphone className="text-primary size-5" /><div><CardTitle>{t('settings.mobile')}</CardTitle><CardDescription>{t('settings.mobileDesc')}</CardDescription></div></CardHeader>
      <CardContent className="grid gap-4">
        <Row label={t('settings.mobileAccess')} hint={st.enabled && !st.running ? st.error : null}><Switch checked={st.enabled} onCheckedChange={async (enabled) => { const r = await act(call('remote.enable', { enabled })); if (r) setSt(r); }} /></Row>
        {st.enabled ? <div className="grid gap-1">{via('wifi')}{via('tailscale')}</div> : null}
        {st.enabled && st.error && st.running ? <p className="text-muted-foreground text-xs">{st.error}</p> : null}
        {/* 3.5: the QR, the short code and the linked devices are in Magic Link, below. 3.8.2: the firewall is mentioned
            only when linking over the local network fails (app.linkOfflineWifi, on the device). */}
        {/* 3.5.1: what notifications show when locked. */}
        {st.enabled ? (
          <Row label={t('settings.mobilePreview')} hint={t(`settings.mobilePreview.${previewOf(st.preview)}Hint`)}>
            <Select value={previewOf(st.preview)} onValueChange={(preview) => configure({ preview })} data-testid="mobile-preview" title={t('settings.mobilePreview')}
              options={PREVIEWS.map((v) => ({ value: v, label: t(`settings.mobilePreview.${v}`) }))} />
          </Row>
        ) : null}
      </CardContent>
    </Card>
  );
}

// On the phone itself: install it as an app and turn its notifications on (https only).
function PhoneCard() {
  const t = useT();
  const p = bridge.push;
  const [on, setOn] = useState(() => p?.enabled() ?? false);
  if (!p) return null;
  const installed = p.installed();
  return (
    <Card data-testid="phone-card">
      <CardHeader className="flex-row items-start gap-3 [&>svg]:mt-0.5 [&>svg]:shrink-0"><Smartphone className="text-primary size-5" /><div><CardTitle>{t('settings.phone')}</CardTitle><CardDescription>{installed ? t('settings.phoneInstalled') : t(p.ios() ? 'settings.phoneInstallIos' : 'settings.phoneInstallAndroid')}</CardDescription></div></CardHeader>
      <CardContent className="grid gap-2">
        {p.supported() && (installed || !p.ios()) ? (
          <Row label={t('settings.phonePush')} hint={t(p.whenClosed?.() === false ? 'settings.phonePushHintApp' : 'settings.phonePushHint')}>
            <Switch checked={on} onCheckedChange={async (next) => { const r = await act(next ? p.enable() : p.disable()); if (r !== undefined) setOn(r); }} />
          </Row>
        ) : <p className="text-muted-foreground text-sm">{t(p.supported() ? 'settings.phonePushInstallFirst' : 'settings.phonePushNeedsHttps')}</p>}
      </CardContent>
    </Card>
  );
}

// The agents' browser: real pages the agents drive with the orb_browser_* tools, shown live in a little window.
export function BrowserCard({ c }) {
  const t = useT();
  const on = c.browser?.enabled !== false; const pip = c.ui?.pip !== false;
  return (
    <Card>
      <CardHeader className="flex-row items-start gap-3 [&>svg]:mt-0.5 [&>svg]:shrink-0"><Globe className="text-primary size-5" /><div><CardTitle>{t('settings.browser')}</CardTitle><CardDescription>{t('settings.browserDesc')}</CardDescription></div></CardHeader>
      <CardContent className="grid gap-4">
        <Row label={t('settings.browse')} hint={t('settings.browseHint')}><Switch checked={on} onCheckedChange={(enabled) => save({ browser: { enabled } })} /></Row>
        <Row label={t('settings.pip')} hint={t('settings.pipHint')}><Switch checked={pip} disabled={!on} onCheckedChange={(v) => save({ ui: { pip: v } })} /></Row>
      </CardContent>
      {bridge.showBrowser ? <CardFooter><Button size="sm" variant="outline" disabled={!on || !pip} onClick={async () => { const r = await bridge.showBrowser(); if (!r?.tabs?.length) toast(t('settings.noBrowserUse')); }}><PictureInPicture2 />{t('settings.showPip')}</Button></CardFooter> : null}
    </Card>
  );
}

// The phone's own page («Este móvil»): Ajustes stays on the PC, but each phone installs itself and turns its notifications on.
export function PhoneView() {
  const t = useT();
  return (
    <>
      <PageHeader icon={<Smartphone className="text-primary size-5" />} title={t('settings.phone')} />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5"><div className="mx-auto grid max-w-xl gap-4"><PhoneCard /></div></div>
    </>
  );
}

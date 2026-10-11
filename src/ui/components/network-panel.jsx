// 2.7: Monitoreo del equipo › Red: the Wi-Fi in use, the networks around, the devices of this network (with names the
// user gives them), Windows' Remote Desktop or SSH to another computer, and the Android phones and TVs by adb. Every number
// comes from Windows or adb as they are now; what they do not give shows as «—».
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Wifi, WifiOff, Router, Smartphone, Tv, Monitor, RefreshCw, MoreHorizontal, Pencil, MonitorSmartphone, TerminalSquare, Link2, ShieldAlert, Battery, HardDrive, MemoryStick, Download } from 'lucide-react';
import { Button } from './ui/button.jsx';
import { Badge, Card, CardContent, CardHeader, CardTitle, CardDescription, Field, Input, Spinner, Empty } from './ui/basic.jsx';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, Collapsible, CollapsibleTrigger, CollapsibleContent } from './ui/overlay.jsx';
import { form } from './dialogs.jsx';
import { call, act } from '@/lib/store.js';
import { cn } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';

const weak = (sec) => /open|abierta|wep|ninguna|none/i.test(String(sec ?? ''));
const Bar = ({ pct }) => <span className="bg-muted block h-1.5 w-full overflow-hidden rounded-full"><span className={cn('block h-full rounded-full', pct >= 60 ? 'bg-success' : pct >= 35 ? 'bg-warning' : 'bg-destructive')} style={{ width: `${Math.max(0, Math.min(100, pct ?? 0))}%` }} /></span>;

function WifiCard() {
  const t = useT();
  const [w, setW] = useState(undefined); const [near, setNear] = useState(null);
  useEffect(() => { let alive = true; call('net.wifi').then((r) => alive && setW(r)).catch(() => alive && setW(null)); call('net.nearby').then((r) => alive && setNear(r)).catch(() => {}); return () => { alive = false; }; }, []);
  return (
    <Card data-testid="net-wifi">
      <CardHeader className="flex-row items-start gap-3">{w ? <Wifi className="text-primary size-5" /> : <WifiOff className="text-muted-foreground size-5" />}<div className="min-w-0 flex-1"><CardTitle>{w === undefined ? t('net.wifi') : w ? w.ssid : t('net.noWifi')}</CardTitle><CardDescription>{w ? [w.band, w.channel ? t('net.channel', { n: w.channel }) : null, w.radio].filter(Boolean).join(' · ') : w === null ? t('net.noWifiBody') : null}</CardDescription></div>{w === undefined ? <Spinner /> : null}</CardHeader>
      {w ? (
        <CardContent className="grid gap-3">
          <div className="grid gap-1 text-sm"><div className="flex justify-between"><span>{t('net.signal')}</span><span className="tabular-nums">{w.signalPct != null ? `${w.signalPct} %` : '—'}{w.rssi != null ? ` · ${w.rssi} dBm` : ''}</span></div><Bar pct={w.signalPct} /></div>
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
            <div><div className="text-muted-foreground text-xs">{t('net.speed')}</div>{w.rxMbps != null ? `${w.rxMbps} Mbps` : '—'}</div>
            <div><div className="text-muted-foreground text-xs">{t('net.security')}</div><span className={cn(weak(w.security) && 'text-destructive font-medium')}>{w.security ?? '—'}</span></div>
            <div className="max-sm:col-span-2"><div className="text-muted-foreground text-xs">{t('net.adapter')}</div><span className="line-clamp-1">{w.adapter ?? '—'}</span></div>
          </div>
          {weak(w.security) ? <div className="text-destructive flex items-center gap-1.5 text-xs"><ShieldAlert className="size-3.5" />{t('net.weak')}</div> : null}
          {near ? (
            <Collapsible>
              <CollapsibleTrigger className="text-muted-foreground hover:text-foreground cursor-pointer text-xs">{near.blocked ? t('net.nearbyBlocked') : t('net.nearby', { n: near.networks.length })}</CollapsibleTrigger>
              <CollapsibleContent className="mt-2 grid gap-1.5">
                {near.networks.map((n, i) => <div key={`${n.ssid}-${i}`} className="grid grid-cols-[1fr_auto] items-center gap-x-3 text-[13px]"><span className="truncate">{n.ssid ?? t('net.hidden')} <span className="text-muted-foreground text-xs">· {[n.band, n.security].filter(Boolean).join(' · ')}</span></span><span className="w-24"><Bar pct={n.signalPct} /></span></div>)}
              </CollapsibleContent>
            </Collapsible>
          ) : null}
        </CardContent>
      ) : null}
    </Card>
  );
}

function DevicesCard() {
  const t = useT();
  const [data, setData] = useState(null); const [busy, setBusy] = useState(false);
  const load = async (sweep = false) => { setBusy(true); const r = await act(call('net.devices', { sweep })); if (r) setData(r); setBusy(false); };
  useEffect(() => { load(false); }, []);
  const rename = async (d) => { const r = await form(t('net.renameTitle'), { initial: { name: d.alias ?? '' }, body: (v, set) => <Field label={t('net.name')} hint={t('net.renameHint', { ip: d.ip, mac: d.mac })}><Input autoFocus value={v.name} onChange={(e) => set({ name: e.target.value })} maxLength={40} placeholder={t('net.namePh')} /></Field>, ok: t('net.save'), onOk: (v) => call('net.rename', { mac: d.mac, name: v.name }) }); if (r) load(false); };
  const ssh = async (d) => form(t('net.sshTitle', { ip: d.ip }), { description: t('net.sshDesc'), initial: { user: '' }, body: (v, set) => <Field label={t('net.user')}><Input autoFocus value={v.user} onChange={(e) => set({ user: e.target.value })} maxLength={32} placeholder="dani" /></Field>, ok: t('net.connect'), onOk: (v) => call('net.remote', { ip: d.ip, kind: 'ssh', user: v.user.trim() }) });
  return (
    <Card data-testid="net-devices">
      <CardHeader className="flex-row items-start gap-3"><MonitorSmartphone className="text-primary size-5" /><div className="min-w-0 flex-1"><CardTitle>{t('net.devices')}</CardTitle><CardDescription>{data?.me ? t('net.devicesDesc', { ip: data.me.ip, n: data.devices.length }) : t('net.devicesHint')}</CardDescription></div>
        <Button size="sm" variant="outline" onClick={() => load(true)} disabled={busy} data-testid="net-scan">{busy ? <Spinner className="size-3.5" /> : <RefreshCw />}{busy ? t('net.scanning') : t('net.scan')}</Button></CardHeader>
      <CardContent className="grid gap-1">
        {!data ? <div className="grid place-items-center py-6"><Spinner /></div> : !data.devices.length ? <p className="text-muted-foreground py-4 text-center text-sm">{t('net.none')}</p> : data.devices.map((d) => (
          <div key={d.mac} className="hover:bg-accent/40 flex items-center gap-2.5 rounded-lg px-2 py-1.5" data-testid="net-device">
            {d.router ? <Router className="text-primary size-4 shrink-0" /> : <Monitor className="text-muted-foreground size-4 shrink-0" />}
            <div className="min-w-0 flex-1"><div className="truncate text-[13.5px] font-medium">{d.alias ?? d.name ?? (d.router ? t('net.router') : t('net.unknown'))}</div><div className="text-muted-foreground truncate font-mono text-[11px]">{d.ip} · {d.mac}</div></div>
            {d.privateMac ? <Badge variant="secondary" className="font-normal">{t('net.privateMac')}</Badge> : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button size="icon-xs" variant="ghost" aria-label={t('net.actions')}><MoreHorizontal /></Button></DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={() => rename(d)}><Pencil />{t('net.rename')}</DropdownMenuItem>
                {!d.router ? <DropdownMenuItem onSelect={() => act(call('net.remote', { ip: d.ip, kind: 'rdp' }))}><Monitor />{t('net.rdp')}</DropdownMenuItem> : null}
                {!d.router ? <DropdownMenuItem onSelect={() => ssh(d)}><TerminalSquare />{t('net.ssh')}</DropdownMenuItem> : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}
        <p className="text-muted-foreground mt-2 text-[11.5px] leading-snug">{t('net.remoteNote')}</p>
      </CardContent>
    </Card>
  );
}

function AndroidCard() {
  const t = useT();
  const [data, setData] = useState(null); const [info, setInfo] = useState({}); const [installing, setInstalling] = useState(false);
  const load = () => call('android.devices').then(setData).catch(() => setData({ ready: false, devices: [] }));
  useEffect(() => { load(); }, []);
  const open = async (serial) => { setInfo((m) => ({ ...m, [serial]: 'loading' })); const r = await act(call('android.info', { serial })); setInfo((m) => ({ ...m, [serial]: r ?? null })); };
  const pair = async () => {
    const r = await form(t('net.pairTitle'), { description: t('net.pairDesc'), initial: { host: '', code: '' },
      body: (v, set) => (<><Field label={t('net.pairHost')}><Input autoFocus value={v.host} onChange={(e) => set({ host: e.target.value.trim() })} placeholder="192.168.1.40:37145" maxLength={21} /></Field><Field label={t('net.pairCode')}><Input value={v.code} onChange={(e) => set({ code: e.target.value.replace(/\D/g, '').slice(0, 6) })} placeholder="123456" inputMode="numeric" /></Field></>),
      ok: t('net.pair'), onOk: (v) => call('android.pair', { host: v.host, code: v.code }) });
    if (r) { if (r.ok) toast.success(t('net.paired')); else toast.error(r.detail || t('net.pairFailed')); load(); }
  };
  const connect = async () => {
    const r = await form(t('net.connectTitle'), { description: t('net.connectDesc'), initial: { host: '' }, body: (v, set) => <Field label={t('net.pairHost')}><Input autoFocus value={v.host} onChange={(e) => set({ host: e.target.value.trim() })} placeholder="192.168.1.40:41237" maxLength={21} /></Field>, ok: t('net.connect'), onOk: (v) => call('android.connect', { host: v.host }) });
    if (r) { if (r.ok) toast.success(t('net.connected')); else toast.error(r.detail || t('net.connectFailed')); load(); }
  };
  return (
    <Card data-testid="net-android">
      <CardHeader className="flex-row items-start gap-3"><Smartphone className="text-success size-5" /><div className="min-w-0 flex-1"><CardTitle>{t('net.android')}</CardTitle><CardDescription>{t('net.androidDesc')}</CardDescription></div>
        {data?.ready ? <div className="flex gap-1.5"><Button size="sm" variant="outline" onClick={pair} data-testid="net-pair"><Link2 />{t('net.pair')}</Button><Button size="sm" variant="ghost" onClick={connect}>{t('net.connect')}</Button><Button size="icon-sm" variant="ghost" onClick={load} aria-label={t('net.refresh')}><RefreshCw /></Button></div> : null}</CardHeader>
      <CardContent className="grid gap-2">
        {!data ? <Spinner /> : !data.ready ? (
          <div className="flex items-center gap-3"><p className="text-muted-foreground flex-1 text-sm">{t('net.adbMissing')}</p><Button size="sm" disabled={installing} onClick={async () => { setInstalling(true); await act(call('android.install'), t('net.adbInstalled')); setInstalling(false); load(); }}>{installing ? <Spinner className="size-3.5" /> : <Download />}{t('net.adbInstall')}</Button></div>
        ) : !data.devices.length ? <p className="text-muted-foreground text-sm">{t('net.noAndroid')}</p> : data.devices.map((d) => {
          const i = info[d.serial];
          return (
            <div key={d.serial} className="grid gap-2 rounded-xl border p-2.5" data-testid="net-android-device">
              <div className="flex items-center gap-2.5">
                {i?.tv ? <Tv className="size-4" /> : <Smartphone className="size-4" />}
                <div className="min-w-0 flex-1"><div className="truncate text-[13.5px] font-medium">{i?.maker ? `${i.maker} ${i.model ?? ''}` : d.model ?? d.serial}</div><div className="text-muted-foreground truncate font-mono text-[11px]">{d.serial}</div></div>
                <Badge variant={d.state === 'device' ? 'success' : 'secondary'}>{d.state === 'device' ? t('net.ready') : d.state}</Badge>
                {d.state === 'device' ? <Button size="xs" variant="outline" onClick={() => open(d.serial)}>{t('net.inspect')}</Button> : null}
              </div>
              {i === 'loading' ? <Spinner className="size-4" /> : i ? (
                <div className="grid grid-cols-2 gap-2 text-[12.5px] sm:grid-cols-4">
                  <span>{t('net.androidVersion', { v: i.android ?? '—' })}</span>
                  <span className="flex items-center gap-1"><Battery className="size-3.5" />{i.battery.levelPct != null ? `${i.battery.levelPct} %` : '—'}{i.battery.tempC != null ? ` · ${i.battery.tempC} °C` : ''}</span>
                  <span className="flex items-center gap-1"><MemoryStick className="size-3.5" />{i.memory?.usedPct != null ? `${i.memory.usedPct} % · ${Math.round(i.memory.totalMb / 1024)} GB` : '—'}</span>
                  <span className="flex items-center gap-1"><HardDrive className="size-3.5" />{i.storage?.usedPct != null ? `${i.storage.usedPct} %` : '—'}</span>
                  {i.topApps.length ? <span className="text-muted-foreground col-span-full truncate text-[11.5px]">{t('net.topApps', { list: i.topApps.slice(0, 4).map((a) => `${a.app.split('.').pop()} ${a.memMb} MB`).join(' · ') })}</span> : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export function NetworkPanel() {
  return <div className="mx-auto grid w-full max-w-3xl gap-4 px-5 py-5" data-testid="net-panel"><WifiCard /><DevicesCard /><AndroidCard /></div>;
}

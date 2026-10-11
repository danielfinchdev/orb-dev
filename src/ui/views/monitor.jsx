// 2.7: Monitoreo del equipo: the PC's numbers at a glance and the conversation with Opti Bot (its own brain, chosen in
// Ajustes), with quick questions to start. Opti Bot only reads; whatever it wants to change comes as a card to approve.
import { useEffect, useState } from 'react';
import { Cpu, MemoryStick, HardDrive, Clock, Settings2, HeartPulse, Thermometer, Gpu, Gauge } from 'lucide-react';
import { PageHeader } from '@/components/page.jsx';
import { AgentIcon } from '@/components/agent-icon.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Empty, Spinner } from '@/components/ui/basic.jsx';
import { useStore, call, act, refresh, openSettings } from '@/lib/store.js';
import { AGENT } from '@/lib/labels.js';
import { cn } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';
import { SessionView } from './session.jsx';
import { useCatalog } from '@/components/brain-picker.jsx';
import { NetworkPanel } from '@/components/network-panel.jsx';

const QUICK = ['health', 'security', 'orb', 'backup', 'optimize'];
const tone = (pct) => (pct == null ? '' : pct >= 90 ? 'text-destructive' : pct >= 75 ? 'text-warning' : 'text-success');

function Stat({ icon: Icon, label, value, pct, sub }) {
  return (
    <div className="bg-card/80 grid gap-1 rounded-xl border px-3 py-2.5" data-testid="opti-stat">
      <span className="text-muted-foreground flex items-center gap-1.5 text-[11px] font-medium tracking-wide uppercase"><Icon className="size-3.5" />{label}</span>
      <span className={cn('text-lg leading-none font-semibold tabular-nums', tone(pct))}>{value}</span>
      {pct != null ? <span className="bg-muted h-1.5 overflow-hidden rounded-full"><span className={cn('block h-full rounded-full', pct >= 90 ? 'bg-destructive' : pct >= 75 ? 'bg-warning' : 'bg-success')} style={{ width: `${Math.min(100, pct)}%` }} /></span> : null}
      {sub ? <span className="text-muted-foreground text-[11px]">{sub}</span> : null}
    </div>
  );
}

export function MonitorView() {
  const t = useT();
  const monitor = useStore((s) => s.app.config.monitor ?? {});
  const sessions = useStore((s) => s.sessions);
  const catalog = useCatalog();
  const [id, setId] = useState(null);
  const [stats, setStats] = useState(null);
  const [tab, setTab] = useState('bot');
  useEffect(() => {
    if (!monitor.enabled) return undefined;
    let alive = true;
    call('opti.session').then(async (s) => { if (!alive) return; await refresh().catch(() => {}); setId(s.id); }).catch((e) => act(Promise.reject(e)));
    return () => { alive = false; };
  }, [monitor.enabled, monitor.agent, monitor.model]);
  useEffect(() => {
    if (!monitor.enabled) return undefined;
    let alive = true;
    const tick = () => call('opti.stats').then((s) => alive && setStats(s)).catch(() => {});
    tick(); const timer = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(timer); };
  }, [monitor.enabled]);
  if (!monitor.enabled) return <Empty icon={HeartPulse} title={t('opti.offTitle')} className="m-auto"><p>{t('opti.offBody')}</p><Button size="sm" className="mt-3" onClick={() => openSettings('monitor')}><Settings2 />{t('opti.openSettings')}</Button></Empty>;
  const s = sessions.find((x) => x.id === id);
  const modelLabel = (catalog?.find((a) => a.id === s?.agent)?.models ?? []).find((m) => m.id === s?.model)?.label ?? s?.model;
  const ask = (key) => id && act(call('sessions.send', { id, text: t(`opti.quick.${key}.text`) }));
  return (
    <>
      <PageHeader icon={<AgentIcon agent="opti" className="size-5" />} title={t('opti.title')} meta={`Opti Bot · ${AGENT[s?.agent ?? monitor.agent ?? 'claude'] ?? ''}${modelLabel ? ` · ${modelLabel}` : ''}`}>
        {/* 2.7: two views: this PC with Opti Bot, and the network (Wi-Fi, devices, Android). */}
        <div className="bg-muted flex rounded-lg p-0.5" role="tablist">
          {[['bot', t('opti.tabPc')], ['red', t('opti.tabNet')]].map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cn('cursor-pointer rounded-md px-3 py-1 text-[13px] transition-colors', tab === id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')} data-testid={`opti-tab-${id}`}>{label}</button>)}
        </div>
        <Button size="sm" variant="ghost" onClick={() => openSettings('monitor')} data-testid="opti-settings"><Settings2 />{t('opti.brain')}</Button>
      </PageHeader>
      {tab === 'red' ? <div className="min-h-0 flex-1 overflow-y-auto"><NetworkPanel /></div> : (<>
      <div className="border-b px-5 py-3" data-testid="opti-stats">
        <div className="mx-auto grid max-w-3xl grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat icon={Cpu} label={t('opti.cpu')} value={stats?.cpu != null ? `${stats.cpu} %` : '—'} pct={stats?.cpu} />
          <Stat icon={MemoryStick} label={t('opti.memory')} value={stats ? `${stats.memory.usedPct} %` : '—'} pct={stats?.memory.usedPct} sub={stats ? t('opti.ofGb', { gb: stats.memory.totalGb }) : null} />
          <Stat icon={HardDrive} label={t('opti.disk')} value={stats?.disk ? `${stats.disk.usedPct} %` : '—'} pct={stats?.disk?.usedPct} sub={stats?.disk ? t('opti.freeGb', { gb: stats.disk.freeGb }) : null} />
          <Stat icon={Clock} label={t('opti.uptime')} value={stats ? t('opti.hours', { h: stats.uptimeH }) : '—'} />
        </div>
        {/* 2.7: Open Control Edge's real sensor readings, only while it is open and sharing (else nothing is made up). */}
        {stats?.oce ? (
          <div className="mx-auto mt-2 grid max-w-3xl grid-cols-2 gap-2 sm:grid-cols-4" data-testid="opti-oce">
            <Stat icon={Thermometer} label={t('opti.cpuTemp')} value={stats.oce.cpu.tempC != null ? `${Math.round(stats.oce.cpu.tempC)} °C` : '—'} pct={stats.oce.cpu.tempC != null ? Math.round((stats.oce.cpu.tempC / 100) * 100) : null} />
            <Stat icon={Thermometer} label={t('opti.gpuTemp')} value={stats.oce.gpu?.tempC != null ? `${Math.round(stats.oce.gpu.tempC)} °C` : '—'} pct={stats.oce.gpu?.tempC != null ? Math.round(stats.oce.gpu.tempC) : null} sub={stats.oce.gpu?.name ?? null} />
            <Stat icon={Gpu} label={t('opti.gpu')} value={stats.oce.gpu?.loadPct != null ? `${Math.round(stats.oce.gpu.loadPct)} %` : '—'} pct={stats.oce.gpu?.loadPct ?? null} sub={stats.oce.gpu?.vramTotalMb ? t('opti.vram', { used: Math.round((stats.oce.gpu.vramUsedMb ?? 0) / 1024 * 10) / 10, total: Math.round(stats.oce.gpu.vramTotalMb / 1024 * 10) / 10 }) : null} />
            <Stat icon={Gauge} label="FPS" value={stats.oce.fps != null ? `${Math.round(stats.oce.fps)}` : '—'} />
          </div>
        ) : null}
        <div className="text-muted-foreground mx-auto mt-1.5 flex max-w-3xl items-center gap-1.5 text-[11px]" data-testid="opti-oce-state">
          <span className={cn('size-1.5 rounded-full', stats?.oce ? 'bg-success' : 'bg-muted-foreground/40')} />{stats?.oce ? t('opti.oceOn', { version: stats.oce.version }) : t('opti.oceOff')}
        </div>
        <div className="mx-auto mt-2.5 flex max-w-3xl flex-wrap gap-1.5">
          {QUICK.map((k) => <Button key={k} size="xs" variant="outline" className="rounded-full" disabled={!id} onClick={() => ask(k)} data-testid={`opti-quick-${k}`}>{t(`opti.quick.${k}.label`)}</Button>)}
        </div>
      </div>
      {s ? <SessionView route={{ view: 'session', id: s.id }} embedded empty={<Empty icon={HeartPulse} title={t('opti.emptyTitle')}>{t('opti.emptyBody')}</Empty>} /> : <div className="grid flex-1 place-items-center"><Spinner /></div>}
      </>)}
    </>
  );
}

// 3.7 (WS9): «Conexiones»: everything connected to this Orb in one list (Ajustes › Magic Link › Conexiones on the PC,
// a screen of its own on a phone, and the user menu). Each row: what it is, its state (a dot: connected, not connected,
// needs attention), whose it is, when it was seen, and what can be done with it (each action asks first).
// The engine (src/engine/api-connections.mjs) decides what each person sees; this screen only draws it. «Actualizar»
// asks again, and only then looks at the Android devices again if they were used before (never on its own).
import { useEffect, useRef, useState } from 'react';
import { Server, Monitor, Smartphone, Globe, Code2, Cable, TabletSmartphone, KeyRound, Network, House, ScreenShare, Unplug, Trash2, RotateCw, RefreshCw, LoaderCircle, PlugZap } from 'lucide-react';
import { PageHeader } from '@/components/page.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Badge, Card, CardContent, CardHeader, CardTitle, CardDescription, Empty } from '@/components/ui/basic.jsx';
import { BubbleTip } from '@/components/ui/overlay.jsx';
import { confirm } from '@/components/dialogs.jsx';
import { AgentIcon } from '@/components/agent-icon.jsx';
import { useStore, call, act, bridge, openSettings, go } from '@/lib/store.js';
import { cn, ago } from '@/lib/utils.js';
import { useT, useLocale } from '@/lib/i18n.js';

const ICON = { server: Server, orb: Monitor, phone: Smartphone, browser: Globe, terminal: Code2, tunnel: Cable, adb: TabletSmartphone, vault: KeyRound, tailscale: Network, ha: House, live: ScreenShare };
// The groups of the list, in order (a group without rows is not drawn).
const GROUPS = [
  { id: 'orbs', kinds: ['server', 'orb'] },
  { id: 'devices', kinds: ['phone', 'browser', 'terminal'] },
  { id: 'bridges', kinds: ['tunnel', 'adb'] },
  { id: 'services', kinds: ['vault', 'tailscale', 'ha'] },
  { id: 'agents', kinds: ['agent'] },
  { id: 'live', kinds: ['live'] }
];
// What each action does: the engine method, its kind, the button and the confirmation.
const ACTIONS = {
  revoke: { method: 'connections.close', icon: Trash2, danger: true },
  disconnect: { method: 'connections.close', icon: Unplug, danger: true },
  closeTunnel: { method: 'connections.close', icon: Unplug, danger: true },
  disconnectAdb: { method: 'connections.close', icon: Unplug, danger: true },
  closeBrowser: { method: 'connections.close', icon: Unplug, danger: true },
  reconnect: { method: 'connections.reconnect', icon: RotateCw, danger: false }
};

export function StatusDot({ status }) {
  const t = useT();
  return <span className={cn('size-2 shrink-0 rounded-full', status === 'online' ? 'bg-success' : status === 'attention' ? 'bg-warning' : 'bg-muted-foreground/40')} role="img" aria-label={t(`conn.status.${status}`)} data-testid="conn-dot" data-status={status} />;
}

function KindIcon({ row }) {
  if (row.kind === 'agent') return <span className="grid size-5 shrink-0 place-items-center"><AgentIcon agent={row.detail?.agent ?? 'claude'} className="size-4" /></span>;
  const Icon = ICON[row.kind] ?? PlugZap;
  return <Icon className="text-muted-foreground size-5 shrink-0" aria-hidden />;
}

// "3,1 GB libres de 8 GB"
function useBytes() {
  const locale = useLocale();
  return (n) => `${new Intl.NumberFormat(locale, { maximumFractionDigits: n >= 10 * 2 ** 30 ? 0 : 1 }).format(n / 2 ** 30)} GB`;
}

// The meta line of a row: what it is, whose (with two or more users, when it is someone else's), its version or RAM, and
// when it was seen.
function metaOf(row, t, bytes, many) {
  const d = row.detail ?? {};
  // (Tailscale and Home Assistant are their own name: no kind repeated)
  const parts = [row.name === t(`conn.kind.${row.kind}`) ? null : t(`conn.kind.${row.kind}`)];
  if (row.where === 'server') parts.push(t('conn.onServer'));
  if (many && row.personName) parts.push(row.personName);
  if (d.version) parts.push(t('conn.version', { v: d.version }));
  if (d.memory?.total) parts.push(t('conn.ram', { free: bytes(d.memory.free), total: bytes(d.memory.total) }));
  if (d.why) parts.push(t(`conn.why.${d.why}`));
  else if (row.kind === 'agent') parts.push(t(row.status === 'online' ? 'conn.signedIn' : 'conn.signedUnknown'));
  else if (row.kind === 'tailscale' && d.dns) parts.push(d.dns);
  else if (row.kind === 'vault' && d.server) parts.push(d.server);
  else if (row.kind === 'ha' && d.host) parts.push(d.host);
  else if (row.kind === 'live' && d.url) parts.push(d.url.replace(/^https?:\/\//, '').slice(0, 60));
  if (row.status === 'online' && ['server', 'orb', 'phone', 'browser', 'terminal'].includes(row.kind)) parts.push(t('conn.onNow'));
  else if (row.kind === 'tunnel' && row.lastSeen) parts.push(t('conn.since', { when: ago(row.lastSeen) }));
  else if (row.kind === 'adb' && row.lastSeen) parts.push(t('conn.checked', { when: ago(row.lastSeen) }));
  else if (row.lastSeen && row.status !== 'online') parts.push(t('conn.seen', { when: ago(row.lastSeen) }));
  return parts.filter(Boolean).join(' · ');
}

function Row({ row, others, busy, onAction }) {
  const t = useT();
  const many = others && Boolean(row.personName);
  const bytes = useBytes();
  // An agent's account that is not signed in: «Reconectar» opens where it signs in (this PC's Agentes, or the Server's
  // Magic Link, where «Añadir Orb Server» signs it in); a phone signs in on the PC.
  const actions = (row.actions ?? []).filter((a) => !(row.kind === 'agent' && a === 'reconnect' && bridge.mobile && row.where !== 'server'));
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-xl border px-3 py-2" data-testid="conn-row" data-kind={row.kind} data-status={row.status}>
      <KindIcon row={row} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <StatusDot status={row.status} />
          <span className="truncate text-sm font-medium" title={row.name}>{row.name}</span>
          {row.status === 'attention' ? <Badge variant="warning">{t('conn.status.attention')}</Badge> : null}
        </div>
        <div className="text-muted-foreground truncate text-xs" data-testid="conn-meta">{metaOf(row, t, bytes, many)}</div>
      </div>
      {actions.map((a) => {
        const spec = ACTIONS[a]; if (!spec) return null;
        const label = t(`conn.action.${a}`);
        if (!spec.danger) return <Button key={a} size="xs" variant="outline" disabled={busy} onClick={() => onAction(row, a)} data-testid={`conn-${a}`}><spec.icon />{label}</Button>;
        return <BubbleTip key={a} title={label}><Button size="icon-sm" variant="danger" aria-label={label} disabled={busy} onClick={() => onAction(row, a)} data-testid={`conn-${a}`}><spec.icon /></Button></BubbleTip>;
      })}
    </div>
  );
}

// The list, for Ajustes and for the phone's screen. The engine sends connections:changed when something changes; the
// list also asks again every 20 s while it is open (states like «visto hace 3 min» move on).
export function ConnectionsPanel() {
  const t = useT();
  const me = useStore((s) => s.me);
  const many = Number(me?.personsCount ?? 1) > 1;
  const myId = me?.person?.id ?? null;
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const alive = useRef(true);
  const load = async () => {
    try { const r = await call('connections.list', {}); if (alive.current) { setData(r); setError(''); } }
    catch (e) { if (alive.current) setError(e?.message ?? String(e)); }
  };
  useEffect(() => {
    alive.current = true;
    load();
    const id = setInterval(load, 20_000);
    const off = bridge.on?.('*', (event) => { if (event === 'connections:changed') load(); }) ?? (() => {});
    return () => { alive.current = false; clearInterval(id); off(); };
  }, []);
  // «Actualizar»: the user asks. The Android devices are looked at again only if they were listed before (on this PC).
  const refresh = async () => {
    setRefreshing(true);
    if (!bridge.mobile && (data?.rows ?? []).some((r) => r.kind === 'adb' && r.where !== 'server')) { try { await call('android.devices', {}); } catch { /* the cached ones stay */ } }
    await load();
    setRefreshing(false);
  };
  const onAction = async (row, action) => {
    if (row.kind === 'agent' && action === 'reconnect') {
      if (row.where === 'server') { if (bridge.mobile) go('link'); else openSettings('magiclink:orbs'); } else openSettings('agentes');
      return;
    }
    const spec = ACTIONS[action];
    const ok = await confirm(t(`conn.ask.${action}`, { name: row.name }), t(`conn.askBody.${action}`), { ok: t(`conn.action.${action}`), danger: spec.danger });
    if (!ok) return;
    setBusy(true);
    const params = { kind: row.source, id: row.ref, ...(row.where === 'server' ? { at: 'server' } : {}) };
    await act(call(spec.method, params), t(`conn.done.${action}`, { name: row.name }));
    setBusy(false);
    load();
  };
  const rows = data?.rows ?? [];
  const attention = rows.filter((r) => r.status === 'attention').length;
  const online = rows.filter((r) => r.status === 'online').length;
  return (
    <Card data-testid="connections">
      <CardHeader className="flex-row items-start gap-3">
        <PlugZap className="text-primary mt-0.5 size-5 shrink-0" />
        <div className="min-w-0 flex-1">
          <CardTitle>{t('conn.title')}</CardTitle>
          <CardDescription data-testid="conn-summary">{data ? [t(online === 1 ? 'conn.summary.online.one' : 'conn.summary.online.other', { n: online }), attention ? t(attention === 1 ? 'conn.summary.attention.one' : 'conn.summary.attention.other', { n: attention }) : null].filter(Boolean).join(' · ') : t('conn.loading')}</CardDescription>
        </div>
        <BubbleTip title={t('conn.refresh')}><Button size="icon-sm" variant="ghost" aria-label={t('conn.refresh')} onClick={refresh} disabled={refreshing} data-testid="conn-refresh">{refreshing ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}</Button></BubbleTip>
      </CardHeader>
      <CardContent className="grid gap-3">
        {error ? <p className="text-destructive text-sm" role="alert">{error}</p> : null}
        {data && !rows.length ? <Empty icon={PlugZap} title={t('conn.emptyTitle')} className="py-8">{t('conn.emptyBody')}</Empty> : null}
        {GROUPS.map((g) => {
          const list = rows.filter((r) => g.kinds.includes(r.kind));
          if (!list.length) return null;
          return (
            <section key={g.id} className="grid gap-1.5" data-testid={`conn-group-${g.id}`} aria-labelledby={`conn-group-${g.id}`}>
              <h4 id={`conn-group-${g.id}`} className="text-muted-foreground px-1 text-xs font-medium">{t(`conn.group.${g.id}`)}</h4>
              {list.map((r) => <Row key={r.id} row={r} others={many && r.where !== 'server' && r.person !== myId} busy={busy} onAction={onAction} />)}
            </section>
          );
        })}
      </CardContent>
    </Card>
  );
}

// A screen of its own on a phone or a linked browser (menu ☰ › Conexiones).
export function ConnectionsView() {
  const t = useT();
  return (
    <>
      <PageHeader icon={<PlugZap className="text-primary size-5" />} title={t('conn.title')} />
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-5 sm:px-5"><div className="mx-auto grid max-w-3xl gap-4"><ConnectionsPanel /></div></div>
    </>
  );
}

// Settings: the assistant, its brain, how tasks run, usage caps, extra MCP connectors and the assistant's folder.
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { toast } from 'sonner';
import { Settings, FolderOpen, Plus, Trash2, ArrowLeftRight, Smartphone, QrCode, Globe, PictureInPicture2, SquareTerminal, ZoomIn, ZoomOut, MonitorCog } from 'lucide-react';
import { PANELS, savePanels } from './expert.jsx';
import { PageHeader } from '@/components/page.jsx';
import { Robot } from '@/components/robot.jsx';
import { confirm, form } from '@/components/dialogs.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter, Field, Input, Textarea, Kbd } from '@/components/ui/basic.jsx';
import { Select, Switch, Checkbox } from '@/components/ui/overlay.jsx';
import { useStore, call, act, bridge, setState, getState, applyTheme, go, openTerminal } from '@/lib/store.js';
import { cn } from '@/lib/utils.js';
import { t, useT, useLocale } from '@/lib/i18n.js';
import { LANGUAGES } from '../../core/i18n.mjs';
import { REASONING, options } from '@/lib/labels.js';

async function save(patch, ok = t('settings.saved')) {
  const config = await act(call('config.save', { patch }), ok);
  if (config) { setState({ app: { ...getState().app, config } }); applyTheme(config.ui?.theme); }
  return config;
}
const num = (v) => Number(v) || 0;
// The whole row is the switch's label: clicking its text toggles it too (the switch alone is a small target).
function Row({ label, hint, children }) {
  return <label className="-mx-2 flex cursor-pointer items-center justify-between gap-4 rounded-lg px-2 py-1.5 hover:bg-accent/40"><div><div className="text-sm">{label}</div>{hint ? <div className="text-muted-foreground text-xs">{hint}</div> : null}</div>{children}</label>;
}

function AssistantCard({ c }) {
  const t = useT();
  const [v, setV] = useState({ assistantName: c.assistantName, userName: c.userName, language: c.language, theme: c.ui?.theme ?? 'sistema', companion: c.ui?.companion !== false });
  return (
    <Card>
      <CardHeader className="flex-row items-start gap-3 [&>svg]:mt-0.5 [&>svg]:shrink-0"><Robot size={40} /><div><CardTitle>{t('settings.assistant')}</CardTitle><CardDescription>{t('settings.assistantDesc')}</CardDescription></div></CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('settings.assistantName')} hint={t('settings.assistantNameHint')}><Input value={v.assistantName} onChange={(e) => setV({ ...v, assistantName: e.target.value })} maxLength={40} /></Field>
          <Field label={t('settings.userName')}><Input value={v.userName} onChange={(e) => setV({ ...v, userName: e.target.value })} maxLength={40} /></Field>
          <Field label={t('settings.language')} hint={t('settings.languageHint')}><Select className="w-full" value={v.language} onValueChange={(language) => { setV({ ...v, language }); save({ language }); }} options={Object.entries(LANGUAGES).map(([value, label]) => ({ value, label }))} /></Field>
          <Field label={t('settings.theme')}><Select className="w-full" value={v.theme} onValueChange={(theme) => setV({ ...v, theme })} options={[{ value: 'sistema', label: t('settings.theme.sistema') }, { value: 'claro', label: t('settings.theme.claro') }, { value: 'oscuro', label: t('settings.theme.oscuro') }]} /></Field>
        </div>
        <Row label={t('settings.companion')} hint={t('settings.companionHint')}><Switch checked={v.companion} onCheckedChange={(companion) => { setV({ ...v, companion }); save({ ui: { companion } }, companion ? t('settings.companionOn') : t('settings.companionOff')); }} /></Row>
      </CardContent>
      <CardFooter><Button size="sm" onClick={() => save({ assistantName: v.assistantName.trim(), userName: v.userName.trim(), language: v.language, ui: { theme: v.theme, companion: v.companion } })}>{t('settings.save')}</Button></CardFooter>
    </Card>
  );
}

function BrainCard({ c }) {
  const t = useT();
  const o = c.orchestrator;
  const [v, setV] = useState({ model: o.model, reasoning: o.reasoning, maxTurns: o.maxTurns, orchestrate: o.orchestrate !== false, account: o.account ?? 'claude' });
  const claudeAccounts = (c.accounts ?? []).filter((a) => a.agent === 'claude');
  return (
    <Card>
      <CardHeader><CardTitle>{t('settings.brain')}</CardTitle><CardDescription>{t('settings.brainDesc')}</CardDescription></CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('settings.model')}><Select className="w-full" value={v.model} onValueChange={(model) => setV({ ...v, model })} options={o.models.map((m) => ({ value: m.id, label: m.label }))} /></Field>
          <Field label={t('settings.reasoning')}><Select className="w-full" value={v.reasoning} onValueChange={(reasoning) => setV({ ...v, reasoning })} options={options(REASONING)} /></Field>
        </div>
        {claudeAccounts.length > 1 ? <Field label={t('settings.claudeAccount')}><Select className="w-full" value={v.account} onValueChange={(account) => setV({ ...v, account })} options={claudeAccounts.map((a) => ({ value: a.id, label: a.label }))} /></Field> : null}
        <Field label={t('settings.maxTurns')} hint={t('settings.maxTurnsHint')}><Input type="number" min={2} max={200} value={v.maxTurns} onChange={(e) => setV({ ...v, maxTurns: num(e.target.value) })} className="w-28" /></Field>
        <Row label={t('settings.orchestrator')} hint={t('settings.orchestratorHint')}><Switch checked={v.orchestrate} onCheckedChange={async (orchestrate) => { if (!orchestrate && !(await confirm(t('settings.freeModeTitle'), t('settings.freeModeBody', { name: c.assistantName }), { ok: t('settings.freeModeOk') }))) return; const r = await act(call('chat.settings', { orchestrate })); if (r) { setV({ ...v, orchestrate }); setState((s) => ({ app: { ...s.app, assistant: r } })); } }} /></Row>
      </CardContent>
      <CardFooter><Button size="sm" onClick={() => save({ orchestrator: v })}>{t('settings.save')}</Button></CardFooter>
    </Card>
  );
}

function TasksCard({ c }) {
  const t = useT();
  const agents = Object.keys(c.agents);
  const [v, setV] = useState({ autoRun: c.autoRun, maxParallel: c.maxParallel, perAgent: c.perAgent, timeoutMinutes: c.timeoutMinutes, review: c.review?.auto === true, high: c.policy?.highNeedsApproval !== false, windowHours: c.budget.windowHours,
    stopAt: Math.round((c.budget.stopAt ?? 0.92) * 100), caps: Object.fromEntries(agents.map((a) => [a, { maxTasks: c.budget.agents?.[a]?.maxTasks ?? 20, maxHeavy: c.budget.agents?.[a]?.maxHeavy ?? 6 }])),
    resumeAfterRestart: c.continuity?.resumeAfterRestart !== false, resumeAtReset: c.continuity?.resumeAtReset !== false,
    delegation: c.delegation?.enabled !== false, trusted: c.delegation?.trusted !== false, maxPerTask: c.delegation?.maxPerTask ?? 4 });
  const cap = (a, k, val) => setV({ ...v, caps: { ...v.caps, [a]: { ...v.caps[a], [k]: num(val) } } });
  return (
    <Card>
      <CardHeader><CardTitle>{t('settings.tasks')}</CardTitle><CardDescription>{t('settings.tasksDesc')}</CardDescription></CardHeader>
      <CardContent className="grid gap-4">
        <Row label={t('settings.autoRun')} hint={t('settings.autoRunHint')}><Switch checked={v.autoRun} onCheckedChange={(autoRun) => { setV({ ...v, autoRun }); save({ autoRun }); }} /></Row>
        <Row label={t('settings.review')} hint={t('settings.reviewHint')}><Switch checked={v.review} onCheckedChange={(review) => { setV({ ...v, review }); save({ review: { auto: review } }); }} /></Row>
        <Row label={t('settings.resumeRestart')} hint={t('settings.resumeRestartHint')}><Switch checked={v.resumeAfterRestart} onCheckedChange={(resumeAfterRestart) => { setV({ ...v, resumeAfterRestart }); save({ continuity: { resumeAfterRestart } }); }} /></Row>
        <Row label={t('settings.resumeReset')} hint={t('settings.resumeResetHint')}><Switch checked={v.resumeAtReset} onCheckedChange={(resumeAtReset) => { setV({ ...v, resumeAtReset }); save({ continuity: { resumeAtReset } }); }} /></Row>
        <Row label={t('settings.delegation')} hint={t('settings.delegationHint')}><Switch checked={v.delegation} onCheckedChange={(delegation) => { setV({ ...v, delegation }); save({ delegation: { enabled: delegation } }); }} /></Row>
        <Row label={t('settings.trusted')} hint={t('settings.trustedHint', { n: v.maxPerTask })}><Switch checked={v.trusted} disabled={!v.delegation} onCheckedChange={(trusted) => { setV({ ...v, trusted }); save({ delegation: { trusted } }); }} /></Row>
        <Row label={t('settings.highApproval')}><Switch checked={v.high} onCheckedChange={(high) => { setV({ ...v, high }); save({ policy: { highNeedsApproval: high } }); }} /></Row>
        <div className="grid grid-cols-4 gap-3">
          <Field label={t('settings.parallel')}><Input type="number" min={1} max={10} value={v.maxParallel} onChange={(e) => setV({ ...v, maxParallel: num(e.target.value) })} /></Field>
          <Field label={t('settings.perAgent')}><Input type="number" min={1} max={5} value={v.perAgent} onChange={(e) => setV({ ...v, perAgent: num(e.target.value) })} /></Field>
          <Field label={t('settings.maxMinutes')}><Input type="number" min={5} max={600} value={v.timeoutMinutes} onChange={(e) => setV({ ...v, timeoutMinutes: num(e.target.value) })} /></Field>
          <Field label={t('settings.windowHours')}><Input type="number" min={1} max={24} value={v.windowHours} onChange={(e) => setV({ ...v, windowHours: num(e.target.value) })} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('settings.stopAt')} hint={t('settings.stopAtHint')}><Input type="number" min={50} max={100} value={v.stopAt} onChange={(e) => setV({ ...v, stopAt: num(e.target.value) })} /></Field>
          <Field label={t('settings.maxPerTask')} hint={t('settings.maxPerTaskHint')}><Input type="number" min={0} max={20} value={v.maxPerTask} onChange={(e) => setV({ ...v, maxPerTask: num(e.target.value) })} /></Field>
        </div>
        <div className="grid gap-2">
          <div className="text-muted-foreground text-xs">{t('settings.safetyNet')}</div>
          <div className="text-muted-foreground grid grid-cols-3 gap-3 text-xs"><span>{t('settings.colAgent')}</span><span>{t('settings.colTasks')}</span><span>{t('settings.colHeavy')}</span></div>
          {agents.map((a) => <div key={a} className="grid grid-cols-3 items-center gap-3"><span className="text-sm">{a}</span><Input type="number" min={1} value={v.caps[a].maxTasks} onChange={(e) => cap(a, 'maxTasks', e.target.value)} /><Input type="number" min={0} value={v.caps[a].maxHeavy} onChange={(e) => cap(a, 'maxHeavy', e.target.value)} /></div>)}
        </div>
      </CardContent>
      <CardFooter><Button size="sm" onClick={() => save({ autoRun: v.autoRun, maxParallel: v.maxParallel, perAgent: v.perAgent, timeoutMinutes: v.timeoutMinutes, review: { auto: v.review }, policy: { highNeedsApproval: v.high }, budget: { windowHours: v.windowHours, stopAt: Math.min(1, Math.max(0.5, v.stopAt / 100)), agents: v.caps }, delegation: { maxPerTask: v.maxPerTask } })}>{t('settings.save')}</Button></CardFooter>
    </Card>
  );
}

function McpCard({ c }) {
  const t = useT();
  const add = () => form(t('settings.mcpAddTitle'), {
    description: t('settings.mcpAddDesc'),
    initial: { name: '', command: '', args: '', agents: '' },
    body: (v, set) => (<>
      <Field label={t('settings.mcpName')}><Input autoFocus value={v.name} onChange={(e) => set({ name: e.target.value })} placeholder={t('settings.mcpNamePh')} /></Field>
      <Field label={t('settings.mcpCommand')}><Input value={v.command} onChange={(e) => set({ command: e.target.value })} placeholder="npx" /></Field>
      <Field label={t('settings.mcpArgs')} hint={t('settings.mcpArgsHint')}><Input value={v.args} onChange={(e) => set({ args: e.target.value })} placeholder="@playwright/mcp@latest" /></Field>
      <Field label={t('settings.mcpAgents')} hint={t('settings.mcpAgentsHint')}><Input value={v.agents} onChange={(e) => set({ agents: e.target.value })} /></Field>
    </>),
    ok: t('settings.add'),
    onOk: async (v) => {
      const entry = { name: v.name.trim(), command: v.command.trim(), args: v.args.trim() ? v.args.trim().split(/\s+/) : [], agents: v.agents.split(',').map((x) => x.trim()).filter(Boolean), enabled: true };
      const config = await call('config.save', { patch: { mcpServers: [...c.mcpServers, entry] } });
      setState({ app: { ...getState().app, config } });
      return true;
    }
  });
  // Orb's mcp-servers folder: each subfolder is a server; one click adds it with the command that starts it.
  const [folder, setFolder] = useState(null);
  const loadFolder = () => call('mcp.folder').then(setFolder).catch(() => setFolder(null));
  useEffect(() => { if (!bridge.mobile) loadFolder(); }, [c.mcpServers.length]);
  const use = async (s) => {
    const entry = { name: s.name, command: s.command, args: s.args, agents: [], enabled: true };
    const config = await act(call('config.save', { patch: { mcpServers: [...c.mcpServers, entry] } }), t('settings.mcpAdded', { name: s.name }));
    if (config) setState({ app: { ...getState().app, config } });
  };
  return (
    <Card>
      <CardHeader><CardTitle>{t('settings.mcp')}</CardTitle><CardDescription>{t('settings.mcpDesc')}</CardDescription></CardHeader>
      <CardContent className="grid gap-2">
        {folder ? (
          <div className="grid gap-2" data-testid="mcp-folder">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1"><div className="text-muted-foreground text-xs">{t('settings.mcpFolder')}</div><div className="truncate font-mono text-xs">{folder.dir}</div></div>
              <Button size="icon-sm" variant="ghost" onClick={() => act(bridge.openPath(folder.dir))} title={t('settings.open')}><FolderOpen /></Button>
            </div>
            {folder.servers.map((s) => (
              <div key={s.dir} className="flex items-center gap-3 rounded-lg border border-dashed px-3 py-2">
                <div className="min-w-0 flex-1"><div className="text-sm">{s.name}</div><div className="text-muted-foreground truncate font-mono text-xs">{s.command ? `${s.command} ${s.args.join(' ')}` : t('settings.mcpNoStart')}</div></div>
                {s.configured ? <span className="text-muted-foreground text-xs">{t('settings.mcpInUse', { name: s.configured })}</span>
                  : s.command ? <Button size="sm" variant="outline" onClick={() => use(s)}><Plus />{t('settings.mcpUse')}</Button> : null}
              </div>
            ))}
          </div>
        ) : null}
        {c.mcpServers.length ? c.mcpServers.map((s, i) => (
          <div key={s.name} className="flex items-center gap-3 rounded-lg border px-3 py-2">
            <div className="min-w-0 flex-1"><div className="text-sm">{s.name}</div><div className="text-muted-foreground truncate font-mono text-xs">{s.command} {(s.args ?? []).join(' ')}</div></div>
            <span className="text-muted-foreground text-xs">{s.agents?.length ? s.agents.join(', ') : t('settings.all')}</span>
            <Button variant="danger" size="icon-sm" onClick={async () => { if (await confirm(t('settings.mcpRemoveTitle'), t('settings.mcpRemoveBody', { name: s.name }), { ok: t('settings.remove'), danger: true })) save({ mcpServers: c.mcpServers.filter((_, j) => j !== i) }); }}><Trash2 /></Button>
          </div>
        )) : <p className="text-muted-foreground text-sm">{t('settings.none')}</p>}
      </CardContent>
      <CardFooter><Button size="sm" variant="outline" onClick={add}><Plus />{t('settings.mcpAdd')}</Button></CardFooter>
    </Card>
  );
}

// Android's adb: downloaded by Orb into android\adb-tools (and in the agents' PATH).
function AndroidCard() {
  const t = useT();
  const [st, setSt] = useState(null);
  const load = () => call('android.status').then(setSt).catch(() => setSt(null));
  useEffect(() => { load(); const id = setInterval(load, st?.state === 'downloading' ? 1500 : 15000); return () => clearInterval(id); }, [st?.state]);
  if (!st) return null;
  const label = st.ready ? t('settings.android.ready') : st.state === 'downloading' ? t('settings.android.downloading') : st.state === 'error' ? t('settings.android.error', { error: st.error }) : t('settings.android.missing');
  return (
    <Card data-testid="android-card">
      <CardHeader><CardTitle>{t('settings.android')}</CardTitle><CardDescription>{t('settings.androidDesc')}</CardDescription></CardHeader>
      <CardContent className="grid gap-2">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1"><div className={cn('text-sm', st.state === 'error' && 'text-destructive')}>{label}</div><div className="text-muted-foreground truncate font-mono text-xs">{st.dir}</div></div>
          {st.ready ? <Button size="icon-sm" variant="ghost" onClick={() => act(bridge.openPath(st.dir))} title={t('settings.open')}><FolderOpen /></Button>
            : st.state !== 'downloading' ? <Button size="sm" variant="outline" onClick={async () => { setSt({ ...st, state: 'downloading' }); const r = await act(call('android.install')); if (r) setSt(r); else load(); }}>{t('settings.android.download')}</Button> : null}
        </div>
      </CardContent>
    </Card>
  );
}

function FolderCard({ c, home }) {
  const t = useT();
  const [roots, setRoots] = useState((c.projectRoots ?? []).join('\n'));
  return (
    <Card>
      <CardHeader><CardTitle>{t('settings.folder')}</CardTitle><CardDescription>{t('settings.folderDesc')}</CardDescription></CardHeader>
      <CardContent className="grid gap-4">
        <div className="bg-muted rounded-lg px-3 py-2 font-mono text-xs break-all">{home}</div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => act(bridge.openPath(home))}><FolderOpen />{t('settings.open')}</Button>
          <Button size="sm" variant="ghost" onClick={async () => { const f = await bridge.pickFolder(t('settings.pickOtherHome')); if (f && await confirm(t('settings.switchTitle'), t('settings.switchBody', { path: f }), { ok: t('settings.switchOk') })) act(bridge.switchHome(f)); }}><ArrowLeftRight />{t('settings.useOther')}</Button>
        </div>
        <Field label={t('settings.roots')} hint={t('settings.rootsHint')}><Textarea rows={2} value={roots} onChange={(e) => setRoots(e.target.value)} /></Field>
      </CardContent>
      <CardFooter><Button size="sm" onClick={() => save({ projectRoots: roots.split(/\r?\n/).map((x) => x.trim()).filter(Boolean) })}>{t('settings.save')}</Button></CardFooter>
    </Card>
  );
}

// Phone access: on/off, the address, a one-time QR to pair a phone, and the paired devices (each can be removed).
function MobileCard() {
  const t = useT();
  const locale = useLocale();
  const [st, setSt] = useState(null);
  const [qr, setQr] = useState(null);
  const load = () => call('remote.status').then(setSt).catch(() => {});
  useEffect(() => { load(); }, []);
  useEffect(() => { if (!qr) return undefined; const timer = setInterval(() => { if (Date.now() > qr.expiresAt) setQr(null); }, 1000); return () => clearInterval(timer); }, [qr]);
  const pair = async () => {
    const r = await act(call('remote.pair'));
    if (r) setQr({ ...r, svg: await QRCode.toString(r.url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) });
  };
  if (!st) return null;
  return (
    <Card>
      <CardHeader className="flex-row items-start gap-3 [&>svg]:mt-0.5 [&>svg]:shrink-0"><Smartphone className="text-primary size-5" /><div><CardTitle>{t('settings.mobile')}</CardTitle><CardDescription>{t('settings.mobileDesc')}</CardDescription></div></CardHeader>
      <CardContent className="grid gap-4">
        <Row label={t('settings.mobileAccess')} hint={st.running ? st.url : st.error ?? t('settings.disabled')}><Switch checked={st.enabled} onCheckedChange={async (enabled) => { const r = await act(call('remote.enable', { enabled })); if (r) setSt(r); }} /></Row>
        {st.running ? (
          <div className="grid gap-3">
            {qr ? (
              <div className="grid justify-items-center gap-2 rounded-xl border p-4 text-center">
                <img alt={t('settings.qrAlt')} className="size-52 rounded-lg bg-white p-2" src={`data:image/svg+xml;utf8,${encodeURIComponent(qr.svg)}`} />
                <p className="text-sm">{t('settings.qrScan')}</p>
                <p className="text-muted-foreground text-xs">{t('settings.qrInstall')}</p>
              </div>
            ) : <div><Button size="sm" onClick={pair}><QrCode />{t('settings.pair')}</Button></div>}
            <div className="grid gap-1.5">
              <div className="text-muted-foreground text-xs">{t('settings.devices')}</div>
              {st.devices.length ? st.devices.map((d) => (
                <div key={d.id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                  <Smartphone className="text-muted-foreground size-4" /><span className="flex-1">{d.name}</span><span className="text-muted-foreground text-xs">{d.last_seen ? new Date(d.last_seen).toLocaleString(locale, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}</span>
                  <Button size="icon-sm" variant="danger" title={t('settings.revokeTip')} onClick={async () => { if (await confirm(t('settings.revokeTitle'), t('settings.revokeBody', { name: d.name }), { ok: t('settings.remove'), danger: true })) { await act(call('remote.revoke', { id: d.id }), t('settings.revoked')); load(); } }}><Trash2 /></Button>
                </div>
              )) : <p className="text-muted-foreground text-sm">{t('settings.none')}</p>}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// The agents' browser: real pages the agents drive with the orb_browser_* tools, shown live in a little window.
function BrowserCard({ c }) {
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

// Interface: its size on this PC (also Ctrl + / Ctrl - / Ctrl 0) and the terminal that Ctrl+J opens.
export const sizes = () => [{ value: '0.87', label: t('settings.size.small') }, { value: '1', label: t('settings.size.normal') }, { value: '1.15', label: t('settings.size.large') }];
function InterfaceCard({ c }) {
  const t = useT();
  const [zoom, setZoom] = useState(null);
  const terminals = { auto: t('settings.term.auto'), warp: 'Warp', wt: 'Windows Terminal', powershell: 'PowerShell', cmd: t('settings.term.cmd') };
  useEffect(() => { bridge.zoom?.().then(setZoom).catch(() => {}); return bridge.on('ui:zoom', (p) => setZoom(p.zoom)); }, []);
  if (!bridge.zoom) return null; // phone: the browser has its own zoom
  const SIZES = sizes();
  const preset = SIZES.find((o) => Math.abs(Number(o.value) - zoom) < 0.01)?.value;
  const change = async (value) => setZoom(await act(bridge.zoom(Number(value))));
  return (
    <Card>
      <CardHeader className="flex-row items-start gap-3 [&>svg]:mt-0.5 [&>svg]:shrink-0"><MonitorCog className="text-primary size-5" /><div><CardTitle>{t('settings.interface')}</CardTitle><CardDescription>{t('settings.interfaceDesc')} <Kbd>Ctrl</Kbd> <Kbd>J</Kbd>.</CardDescription></div></CardHeader>
      <CardContent className="grid gap-4">
        <Field label={t('settings.sizeLabel')} hint={<>{t('settings.sizeHint1')} <Kbd>Ctrl</Kbd> <Kbd>+</Kbd> {t('settings.sizeHint2')} <Kbd>Ctrl</Kbd> <Kbd>-</Kbd> {t('settings.sizeHint3')} <Kbd>Ctrl</Kbd> <Kbd>0</Kbd> {t('settings.sizeHint4')} <Kbd>Ctrl</Kbd> {t('settings.sizeHint5')}</>}>
          <div className="flex flex-wrap items-center gap-2">
            <Select className="w-44" value={preset} placeholder={zoom ? t('settings.custom', { pct: Math.round(zoom * 100) }) : '…'} onValueChange={change} options={SIZES} />
            <Button size="icon-sm" variant="outline" title={t('settings.zoomOut')} onClick={() => change(zoom - 0.1)}><ZoomOut /></Button>
            <Button size="icon-sm" variant="outline" title={t('settings.zoomIn')} onClick={() => change(zoom + 0.1)}><ZoomIn /></Button>
            <span className="text-muted-foreground text-xs tabular-nums">{zoom ? `${Math.round(zoom * 100)} %` : ''}</span>
          </div>
        </Field>
        <Field label={t('settings.terminal')} hint={t('settings.terminalHint')}>
          <div className="flex flex-wrap items-center gap-2">
            <Select className="w-72 max-w-full" value={c.ui?.terminal ?? 'auto'} onValueChange={(terminal) => save({ ui: { terminal } })} options={Object.entries(terminals).map(([value, label]) => ({ value, label }))} />
            <Button size="sm" variant="outline" onClick={() => openTerminal()}><SquareTerminal />{t('settings.openTerminal')}</Button>
          </div>
        </Field>
      </CardContent>
    </Card>
  );
}

// Expert mode: an IDE-like view (PC only) with the panels the user picks.
function ExpertCard({ c }) {
  const t = useT();
  const on = c.expert?.enabled === true; const panels = c.expert?.panels ?? {};
  return (
    <Card>
      <CardHeader className="flex-row items-start gap-3 [&>svg]:mt-0.5 [&>svg]:shrink-0"><SquareTerminal className="text-primary size-5" /><div><CardTitle>{t('settings.expert')}</CardTitle><CardDescription>{t('settings.expertDesc')}</CardDescription></div></CardHeader>
      <CardContent className="grid gap-4">
        <Row label={t('settings.expertOn')} hint={t('settings.expertOnHint')}><Switch checked={on} onCheckedChange={(enabled) => save({ expert: { enabled } }, enabled ? t('settings.expertEnabled') : t('settings.expertDisabled'))} data-testid="expert-switch" /></Row>
        <div className="grid gap-2 sm:grid-cols-2">
          {Object.entries(PANELS).map(([id, label]) => <label key={id} className={cn('-mx-1 flex items-center gap-2 rounded-md px-1 py-1 text-[13px]', on ? 'hover:bg-accent/40 cursor-pointer' : 'text-muted-foreground cursor-not-allowed')}><Checkbox disabled={!on} checked={panels[id] !== false} onCheckedChange={(v) => savePanels({ ...panels, [id]: v === true })} />{label}</label>)}
        </div>
      </CardContent>
      {on ? <CardFooter><Button size="sm" variant="outline" onClick={() => go('expert')}><SquareTerminal />{t('settings.expertOpen')}</Button></CardFooter> : null}
    </Card>
  );
}

export function SettingsView() {
  const t = useT();
  const app = useStore((s) => s.app);
  const c = app.config;
  return (
    <>
      <PageHeader icon={<Settings className="text-primary size-5" />} title={t('settings.title')} meta={t('settings.version', { v: app.version })} />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-2">
          <AssistantCard c={c} /><InterfaceCard c={c} /><BrainCard c={c} /><TasksCard c={c} /><div className="grid content-start gap-4"><MobileCard /><ExpertCard c={c} /><BrowserCard c={c} /><McpCard c={c} />{bridge.mobile ? null : <AndroidCard />}<FolderCard c={c} home={app.home} /></div>
        </div>
      </div>
    </>
  );
}

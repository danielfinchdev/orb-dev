// Settings: the assistant, its brain, how tasks run, usage caps, extra MCP connectors and the assistant's folder.
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { toast } from 'sonner';
import { Settings, FolderOpen, Plus, Trash2, ArrowLeftRight, Smartphone, QrCode, Globe, PictureInPicture2, SquareTerminal, ZoomIn, ZoomOut, MonitorCog, Palette, HeartHandshake, HandHeart, MessageSquareText, Camera, ImagePlus, X, Send, Download, LayoutGrid, UserRound, Brain, ListChecks, Wrench, RefreshCw } from 'lucide-react';
import { ToolIcon } from '@/components/agent-icon.jsx';
import { SKINS, FONTS, CODE_FONTS, CODE_THEMES, APPEARANCE_DEFAULTS } from '../../core/appearance.mjs';
import { PRODUCT, AUTHOR } from '../../core/product.mjs';
import { PANELS, savePanels } from './expert.jsx';
import { PageHeader } from '@/components/page.jsx';
import { Robot } from '@/components/robot.jsx';
import { confirm, form } from '@/components/dialogs.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter, Field, Input, Textarea, Kbd, PathText, Spinner } from '@/components/ui/basic.jsx';
import { Select, Switch, Checkbox, Dialog, DialogContent, DialogTitle, BubbleTip } from '@/components/ui/overlay.jsx';
import { useStore, call, act, bridge, setState, getState, applyTheme, applyAppearance, go, openTerminal, openSettings, closeSettings } from '@/lib/store.js';
import { cn } from '@/lib/utils.js';
import { t, useT, useLocale } from '@/lib/i18n.js';
import { LANGUAGES } from '../../core/i18n.mjs';
import { REASONING, options } from '@/lib/labels.js';
import { useUpdate, updateActions, notesUrl } from '@/components/update-card.jsx';
import { play } from '@/lib/sounds.js';

async function save(patch, ok = t('settings.saved')) {
  const config = await act(call('config.save', { patch }), ok);
  if (config) { setState({ app: { ...getState().app, config } }); applyTheme(config.ui?.theme); applyAppearance(config.ui); }
  return config;
}
const num = (v) => Number(v) || 0;
// The whole row is the switch's label: clicking its text toggles it too (the switch alone is a small target).
function Row({ label, hint, children }) {
  return <label className="-mx-2 flex cursor-pointer items-center justify-between gap-4 rounded-lg px-2 py-1.5 hover:bg-accent/40"><div><div className="text-sm">{label}</div>{hint ? <div className="text-muted-foreground text-xs">{hint}</div> : null}</div>{children}</label>;
}

function AssistantCard({ c }) {
  const t = useT();
  const [v, setV] = useState({ assistantName: c.assistantName, userName: c.userName, language: c.language });
  return (
    <Card>
      <CardHeader className="flex-row items-start gap-3 [&>svg]:mt-0.5 [&>svg]:shrink-0"><Robot size={40} /><div><CardTitle>{t('settings.assistant')}</CardTitle><CardDescription>{t('settings.assistantDesc')}</CardDescription></div></CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('settings.assistantName')} hint={t('settings.assistantNameHint')}><Input value={v.assistantName} onChange={(e) => setV({ ...v, assistantName: e.target.value })} maxLength={40} /></Field>
          <Field label={t('settings.userName')}><Input value={v.userName} onChange={(e) => setV({ ...v, userName: e.target.value })} maxLength={40} /></Field>
          <Field label={t('settings.language')} hint={t('settings.languageHint')}><Select className="w-full" value={v.language} onValueChange={(language) => { setV({ ...v, language }); save({ language }); }} options={Object.entries(LANGUAGES).map(([value, label]) => ({ value, label }))} /></Field>
        </div>
      </CardContent>
      <CardFooter><Button size="sm" onClick={() => save({ assistantName: v.assistantName.trim(), userName: v.userName.trim(), language: v.language })}>{t('settings.save')}</Button></CardFooter>
    </Card>
  );
}

// A small picture of each visual theme for its button.
const SWATCH = {
  orb: 'radial-gradient(120% 90% at 30% 10%, #f3f5ff 0%, #c9d0fb 55%, #8fa0f2 100%)',
  vaporwave: 'linear-gradient(180deg, #2b1055 0%, #d53a9d 55%, #ff9a5a 80%, #2de2e6 100%)',
  retro: `url("data:image/svg+xml,${encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 11 8' shape-rendering='crispEdges'><path fill='#39ff14' d='M2 0h1v1H2zM8 0h1v1H8zM3 1h1v1H3zM7 1h1v1H7zM2 2h7v1H2zM1 3h2v1H1zM4 3h3v1H4zM8 3h2v1H8zM0 4h11v1H0zM0 5h1v1H0zM2 5h7v1H2zM10 5h1v1h-1zM0 6h1v1H0zM2 6h1v1H2zM8 6h1v1H8zM10 6h1v1h-1zM3 7h2v1H3zM6 7h2v1H6z'/></svg>")}") center / 22px 16px space no-repeat, #070a1a`,
  profesional: 'linear-gradient(90deg, #18181b 0 34%, #f4f4f5 34% 100%)',
  nube: 'radial-gradient(9% 26% at 34% 64%, #fff 0 70%, transparent 74%), radial-gradient(12% 36% at 46% 52%, #fff 0 70%, transparent 74%), radial-gradient(9% 26% at 58% 64%, #fff 0 70%, transparent 74%), radial-gradient(22% 14% at 46% 72%, #fff 0 70%, transparent 74%), radial-gradient(28% 70% at 12% 20%, #ffc4dc, transparent), radial-gradient(28% 70% at 88% 22%, #dccbff, transparent), radial-gradient(30% 60% at 20% 95%, #bdeedd, transparent), radial-gradient(30% 60% at 85% 90%, #ffd9b8, transparent), #fff6f3'
};

// Appearance: light / dark, the visual theme, fonts, colours of code and the robot (floating, sounds, animations).
// Everything is saved as soon as it changes. The professional theme has no robot, so its options are hidden there.
function AppearanceCard({ c }) {
  const t = useT();
  const ui = { ...APPEARANCE_DEFAULTS, ...c.ui };
  const [volume, setVolume] = useState(c.ui?.volume ?? 0.5);
  const set = (patch, ok = null) => save({ ui: patch }, ok);
  const opts = (list, prefix) => list.map((value) => ({ value, label: t(`${prefix}.${value}`) }));
  const robot = ui.skin !== 'profesional';
  return (
    <Card>
      <CardHeader className="flex-row items-start gap-3 [&>svg]:mt-0.5 [&>svg]:shrink-0"><Palette className="text-primary size-5" /><div><CardTitle>{t('appearance.title')}</CardTitle><CardDescription>{t('appearance.desc')}</CardDescription></div></CardHeader>
      <CardContent className="grid gap-5">
        <Field label={t('settings.theme')}>
          <div className="bg-muted inline-flex w-fit gap-1 rounded-lg p-1" role="radiogroup" aria-label={t('settings.theme')}>
            {['claro', 'oscuro', 'sistema'].map((theme) => <button key={theme} type="button" role="radio" aria-checked={(ui.theme ?? 'sistema') === theme} onClick={() => set({ theme })} className={cn('cursor-pointer rounded-md px-3 py-1.5 text-[13px]', (ui.theme ?? 'sistema') === theme ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground')}>{t(`settings.theme.${theme}`)}</button>)}
          </div>
        </Field>
        <Field label={t('appearance.skin')} hint={t('appearance.skinHint')}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label={t('appearance.skin')} data-testid="skin-picker">
            {SKINS.map((skin) => (
              <button key={skin} type="button" role="radio" aria-checked={ui.skin === skin} onClick={() => set({ skin })} data-testid={`skin-${skin}`}
                className={cn('grid cursor-pointer gap-1.5 rounded-xl border p-2 text-left transition-colors', ui.skin === skin ? 'border-primary ring-primary/30 ring-2' : 'hover:bg-accent/40')}>
                <span className="h-10 rounded-lg border border-black/5" style={{ background: SWATCH[skin] }} aria-hidden />
                <span className="text-[13px] font-medium">{t(`appearance.skin.${skin}`)}</span>
              </button>
            ))}
          </div>
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('appearance.font')}><Select className="w-full" value={ui.font} onValueChange={(font) => set({ font })} options={opts(FONTS, 'appearance.font')} /></Field>
          <Field label={t('appearance.codeFont')}><Select className="w-full" value={ui.codeFont} onValueChange={(codeFont) => set({ codeFont })} options={opts(CODE_FONTS, 'appearance.codeFont')} /></Field>
          <Field label={t('appearance.codeTheme')}><Select className="w-full" value={ui.codeTheme} onValueChange={(codeTheme) => set({ codeTheme })} options={opts(CODE_THEMES, 'appearance.codeTheme')} /></Field>
        </div>
        <pre className="code-sample hljs overflow-x-auto rounded-lg border p-3 text-[12.5px] leading-[1.55]" aria-label={t('appearance.codeSample')}><code><span className="hljs-keyword">const</span> <span className="hljs-variable">orb</span> = <span className="hljs-title function_">director</span>(<span className="hljs-string">'bolsillo'</span>, {'{ '}<span className="hljs-attr">fases</span>: <span className="hljs-number">3</span>{' }'}); <span className="hljs-comment">// Orbe</span></code></pre>
        {robot ? (
          <div className="grid gap-1">
            <Row label={t('settings.companion')} hint={t('settings.companionHint')}><Switch checked={ui.companion !== false} onCheckedChange={(companion) => set({ companion }, companion ? t('settings.companionOn') : t('settings.companionOff'))} /></Row>
            <Row label={t('settings.sounds')} hint={t('settings.soundsHint')}><Switch checked={ui.sounds !== false} onCheckedChange={(sounds) => set({ sounds }, sounds ? t('settings.soundsOn') : t('settings.soundsOff')).then(() => sounds && play('wake'))} /></Row>
            {ui.sounds !== false ? (
              <div className="flex items-center gap-3 py-1 text-sm">
                <span className="text-muted-foreground text-xs">{t('settings.volume')}</span>
                <input type="range" min={0.1} max={1} step={0.1} value={volume} aria-label={t('settings.volume')} className="accent-primary w-40 cursor-pointer"
                  onChange={(e) => setVolume(Number(e.target.value))} onPointerUp={() => set({ volume }).then(() => play('boop'))} onKeyUp={() => set({ volume })} />
              </div>
            ) : null}
            <Row label={t('settings.motion')} hint={t('settings.motionHint')}><Switch checked={ui.motion !== 'minima'} onCheckedChange={(on) => set({ motion: on ? 'completa' : 'minima' }, on ? t('settings.motionOn') : t('settings.motionOff'))} /></Row>
          </div>
        ) : <p className="text-muted-foreground text-xs">{t('appearance.noRobot')}</p>}
      </CardContent>
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
          <div className="grid min-w-0 gap-2" data-testid="mcp-folder">
            <div className="flex min-w-0 items-center gap-2">
              <div className="grid min-w-0 flex-1"><div className="text-muted-foreground text-xs">{t('settings.mcpFolder')}</div><PathText path={folder.dir} className="text-xs" /></div>
              <BubbleTip title={t('settings.open')}><Button size="icon-sm" variant="ghost" onClick={() => act(bridge.openPath(folder.dir))} aria-label={t('settings.open')}><FolderOpen /></Button></BubbleTip>
            </div>
            {folder.servers.map((s) => (
              <div key={s.dir} className="flex min-w-0 items-center gap-3 rounded-lg border border-dashed px-3 py-2">
                <div className="min-w-0 flex-1"><div className="text-sm">{s.name}</div><div className="text-muted-foreground truncate font-mono text-xs">{s.command ? `${s.command} ${s.args.join(' ')}` : t('settings.mcpNoStart')}</div></div>
                {s.configured ? <span className="text-muted-foreground text-xs">{t('settings.mcpInUse', { name: s.configured })}</span>
                  : s.command ? <Button size="sm" variant="outline" onClick={() => use(s)}><Plus />{t('settings.mcpUse')}</Button> : null}
              </div>
            ))}
          </div>
        ) : null}
        {c.mcpServers.length ? c.mcpServers.map((s, i) => (
          <div key={s.name} className="flex min-w-0 items-center gap-3 rounded-lg border px-3 py-2">
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

// New versions of Orb (GitHub Releases): the installed version, «Buscar actualizaciones» and the same steps as the card.
function UpdatesCard() {
  const t = useT();
  const st = useUpdate();
  if (!st) return null;
  const line = {
    off: t('settings.update.off'), idle: '', checking: t('settings.update.checking'), none: t('settings.update.none'),
    available: t('settings.update.available', { version: st.version }), downloading: t('settings.update.downloading', { version: st.version, percent: st.percent ?? 0 }),
    downloaded: t('settings.update.downloaded', { version: st.version }), error: t('settings.update.error', { error: st.error })
  }[st.state] ?? '';
  return (
    <Card data-testid="updates-card">
      <CardHeader><CardTitle>{t('settings.updates')}</CardTitle><CardDescription>{st.portable ? t('settings.update.portable') : t('settings.updatesDesc')}</CardDescription></CardHeader>
      <CardContent className="grid gap-1">
        <div className="text-sm">{t('settings.update.current', { version: st.current })}</div>
        {line ? <div className={cn('text-xs', st.state === 'error' ? 'text-destructive' : 'text-muted-foreground')}>{line}</div> : null}
      </CardContent>
      {st.state === 'off' ? null : (
        <CardFooter>
          {st.state === 'available' ? <Button size="sm" onClick={() => updateActions.update(st)}>{st.portable ? t('update.download') : t('update.update')}</Button>
            : st.state === 'downloaded' ? <Button size="sm" onClick={updateActions.restart}>{t('update.restart')}</Button>
              : <Button size="sm" variant="outline" disabled={['checking', 'downloading'].includes(st.state)} onClick={updateActions.check}>{t('settings.update.check')}</Button>}
          {st.version ? <Button size="sm" variant="ghost" onClick={() => act(bridge.openExternal(notesUrl(st.version)))}>{t('update.notes')}</Button> : null}
        </CardFooter>
      )}
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
        <div className="flex min-w-0 items-center gap-2">
          <div className="grid min-w-0 flex-1"><div className={cn('text-sm', st.state === 'error' && 'text-destructive')}>{label}</div><PathText path={st.dir} className="text-muted-foreground text-xs" /></div>
          {st.ready ? <BubbleTip title={t('settings.open')}><Button size="icon-sm" variant="ghost" onClick={() => act(bridge.openPath(st.dir))} aria-label={t('settings.open')}><FolderOpen /></Button></BubbleTip>
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
  const pair = async (kind) => {
    const r = await act(call('remote.pair', { kind }));
    if (r) setQr({ ...r, svg: await QRCode.toString(r.url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) });
  };
  const configure = async (patch) => { setQr(null); const r = await act(call('remote.configure', patch)); if (r) setSt(r); };
  if (!st) return null;
  const route = (kind) => st.routes?.find((r) => r.kind === kind);
  const via = (kind) => {
    const r = route(kind);
    const hint = r ? `${r.url}${r.secure ? ` · ${t('settings.mobileSecure')}` : ''}` : st.enabled && st[kind] ? t('settings.mobileUnavailable') : t(kind === 'wifi' ? 'settings.mobileWifiHint' : 'settings.mobileTsHint');
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
        <Row label={t('settings.mobileAccess')} hint={st.running ? t('settings.mobileOn') : st.error ?? t('settings.disabled')}><Switch checked={st.enabled} onCheckedChange={async (enabled) => { setQr(null); const r = await act(call('remote.enable', { enabled })); if (r) setSt(r); }} /></Row>
        {st.enabled ? <div className="grid gap-1">{via('wifi')}{via('tailscale')}</div> : null}
        {st.enabled && st.error && st.running ? <p className="text-muted-foreground text-xs">{st.error}</p> : null}
        {st.running ? (
          <div className="grid gap-3">
            {qr ? (
              <div className="grid justify-items-center gap-2 rounded-xl border p-4 text-center" data-testid="mobile-qr">
                <img alt={t('settings.qrAlt')} className="size-52 rounded-lg bg-white p-2" src={`data:image/svg+xml;utf8,${encodeURIComponent(qr.svg)}`} />
                <p className="text-sm">{t(qr.kind === 'wifi' ? 'settings.qrScanWifi' : 'settings.qrScanTs')}</p>
                <p className="text-muted-foreground text-xs">{t(qr.secure ? 'settings.qrInstallSecure' : 'settings.qrInstall')}</p>
                <p className="text-muted-foreground font-mono text-[11px]">{t('settings.qrPc', { pc: qr.pc })}</p>
                <Button size="sm" variant="ghost" onClick={() => setQr(null)}>{t('settings.close')}</Button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {route('wifi') ? <Button size="sm" onClick={() => pair('wifi')}><QrCode />{t('settings.pairWifi')}</Button> : null}
                {route('tailscale') ? <Button size="sm" variant={route('wifi') ? 'outline' : 'default'} onClick={() => pair('tailscale')}><QrCode />{t('settings.pairTs')}</Button> : null}
              </div>
            )}
            {route('wifi') ? <p className="text-muted-foreground text-xs">{t('settings.mobileWifiNote')}</p> : null}
            <div className="grid gap-1.5">
              <div className="text-muted-foreground text-xs">{t('settings.devices')}</div>
              {st.devices.length ? st.devices.map((d) => (
                <div key={d.id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                  <Smartphone className="text-muted-foreground size-4" />
                  <div className="min-w-0 flex-1"><div className="truncate">{d.name}</div><div className="text-muted-foreground text-xs">{[d.route === 'tailscale' ? 'Tailscale' : d.route === 'wifi' ? t('settings.mobileWifiShort') : null, d.push ? t('settings.mobilePushOn') : null].filter(Boolean).join(' · ')}</div></div>
                  <span className="text-muted-foreground text-xs">{d.last_seen ? new Date(d.last_seen).toLocaleString(locale, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}</span>
                  <BubbleTip title={t('settings.revokeTip')}><Button size="icon-sm" variant="danger" aria-label={t('settings.revokeTip')} onClick={async () => { if (await confirm(t('settings.revokeTitle'), t('settings.revokeBody', { name: d.name }), { ok: t('settings.remove'), danger: true })) { await act(call('remote.revoke', { id: d.id }), t('settings.revoked')); load(); } }}><Trash2 /></Button></BubbleTip>
                </div>
              )) : <p className="text-muted-foreground text-sm">{t('settings.none')}</p>}
            </div>
          </div>
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
          <Row label={t('settings.phonePush')} hint={t('settings.phonePushHint')}>
            <Switch checked={on} onCheckedChange={async (next) => { const r = await act(next ? p.enable() : p.disable()); if (r !== undefined) setOn(r); }} />
          </Row>
        ) : <p className="text-muted-foreground text-sm">{t(p.supported() ? 'settings.phonePushInstallFirst' : 'settings.phonePushNeedsHttps')}</p>}
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
            <BubbleTip title={t('settings.zoomOut')}><Button size="icon-sm" variant="outline" aria-label={t('settings.zoomOut')} onClick={() => change(zoom - 0.1)}><ZoomOut /></Button></BubbleTip>
            <BubbleTip title={t('settings.zoomIn')}><Button size="icon-sm" variant="outline" aria-label={t('settings.zoomIn')} onClick={() => change(zoom + 0.1)}><ZoomIn /></Button></BubbleTip>
            <span className="text-muted-foreground text-xs tabular-nums">{zoom ? `${Math.round(zoom * 100)} %` : ''}</span>
          </div>
        </Field>
        <Field label={t('settings.terminal')} hint={t('settings.terminalHint')}>
          {/* Narrow window: the selector takes the row and its long option is cut, instead of widening the card. */}
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:flex sm:flex-wrap">
            <Select className="w-full min-w-0 sm:w-72" value={c.ui?.terminal ?? 'auto'} onValueChange={(terminal) => save({ ui: { terminal } })} options={Object.entries(terminals).map(([value, label]) => ({ value, label }))} />
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

// Contribute: a contribution through PayPal and feedback straight to the developer's inbox (src/main/feedback.mjs).
function SupportCard() {
  const t = useT();
  return (
    <Card>
      <CardHeader className="flex-row items-start gap-3 [&>svg]:mt-0.5 [&>svg]:shrink-0"><HeartHandshake className="text-primary size-5" /><div><CardTitle>{t('contribute.supportTitle')}</CardTitle><CardDescription>{t('contribute.supportDesc')}</CardDescription></div></CardHeader>
      <CardFooter><Button size="sm" onClick={() => bridge.openExternal(AUTHOR.paypal)} data-testid="contribute-paypal"><HandHeart />{t('contribute.paypal')}</Button></CardFooter>
    </Card>
  );
}

const FEEDBACK_TYPES = ['error', 'idea', 'otro'];
function FeedbackCard() {
  const t = useT();
  const [v, setV] = useState({ type: 'idea', message: '', contact: '' });
  const [images, setImages] = useState([]);
  const [busy, setBusy] = useState(false);
  const room = images.length < 3;
  const add = (list) => setImages((now) => [...now, ...list.filter(Boolean)].slice(0, 3));
  // The capture shows the app behind Ajustes (what the user wants to report), so the window hides while it is taken.
  const capture = async () => {
    document.documentElement.dataset.capturing = '1';
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try { return await act(bridge.feedback.capture()); } finally { delete document.documentElement.dataset.capturing; }
  };
  const send = async () => {
    setBusy(true);
    const ok = await act(bridge.feedback.send({ ...v, images }), t('contribute.sent'));
    setBusy(false);
    if (ok) { setV({ ...v, message: '' }); setImages([]); }
  };
  return (
    <Card>
      <CardHeader className="flex-row items-start gap-3 [&>svg]:mt-0.5 [&>svg]:shrink-0"><MessageSquareText className="text-primary size-5" /><div><CardTitle>{t('contribute.feedbackTitle')}</CardTitle><CardDescription>{t('contribute.feedbackDesc')}</CardDescription></div></CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
          <Field label={t('contribute.type')}><Select className="w-full" value={v.type} onValueChange={(type) => setV({ ...v, type })} options={FEEDBACK_TYPES.map((value) => ({ value, label: t(`contribute.type.${value}`) }))} /></Field>
          <Field label={t('contribute.contact')} hint={t('contribute.contactHint')}><Input type="email" value={v.contact} maxLength={120} placeholder={t('contribute.contactPh')} onChange={(e) => setV({ ...v, contact: e.target.value })} /></Field>
        </div>
        <Field label={t('contribute.message')}><Textarea rows={5} maxLength={5000} value={v.message} placeholder={t('contribute.messagePh')} onChange={(e) => setV({ ...v, message: e.target.value })} data-testid="feedback-message" /></Field>
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={!room} onClick={async () => add([await capture()])} data-testid="feedback-capture"><Camera />{t('contribute.capture')}</Button>
            <Button size="sm" variant="outline" disabled={!room} onClick={async () => add((await act(bridge.feedback.images())) ?? [])}><ImagePlus />{t('contribute.addImage')}</Button>
            <span className="text-muted-foreground text-xs">{t('contribute.imagesLimit')}</span>
          </div>
          {images.length ? (
            <div className="flex flex-wrap gap-2">
              {images.map((img, i) => (
                <div key={`${img.name}-${i}`} className="group relative">
                  <img src={`data:${img.type};base64,${img.data}`} alt={img.name} className="h-16 w-24 rounded-md border object-cover" />
                  <button type="button" className="bg-background/90 absolute top-1 right-1 grid size-5 cursor-pointer place-items-center rounded-full border" aria-label={t('contribute.removeImage')} onClick={() => setImages(images.filter((_, j) => j !== i))}><X className="size-3" /></button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <p className="text-muted-foreground text-xs">{t('contribute.privacy')}</p>
      </CardContent>
      <CardFooter><Button size="sm" disabled={busy || !v.message.trim()} onClick={send} data-testid="feedback-send">{busy ? <Spinner className="border-white/40 border-t-white" /> : <Send />}{t('contribute.send')}</Button></CardFooter>
    </Card>
  );
}

// Other apps by the same developer, with their latest version and a download button.
function MoreAppsCard() {
  const t = useT();
  const locale = useLocale();
  const [apps, setApps] = useState(null);
  useEffect(() => { bridge.moreApps?.().then(setApps).catch(() => setApps([])); }, []);
  const DESC = { 'open-control-edge': t('apps.openControl') };
  return (
    <Card>
      <CardContent className="grid gap-3">
        {!apps ? <div className="flex items-center gap-2 text-sm"><Spinner />{t('apps.loading')}</div> : apps.map((a) => (
          <div key={a.id} className="flex flex-wrap items-center gap-3 rounded-xl border p-3" data-testid={`app-${a.id}`}>
            <img src={`apps/${a.id}.png`} alt="" className="size-11 rounded-xl" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{a.name}</div>
              <div className="text-muted-foreground text-xs">{DESC[a.id]}</div>
              <div className="text-muted-foreground mt-0.5 text-xs">{a.version ? t('apps.latest', { version: a.version, date: a.date ? new Date(a.date).toLocaleDateString(locale) : '' }) : t('apps.offline')}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" onClick={() => bridge.openExternal(a.page)}>{t('apps.details')}</Button>
              <Button size="sm" onClick={() => bridge.openExternal(a.download)}><Download />{t('apps.download')}</Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// Ajustes is a window over the app: sections on the left, with the developer's GitHub and the version at the bottom.
const SECTIONS = [
  { id: 'general', icon: UserRound, cards: (c, app) => <><AssistantCard c={c} /><FolderCard c={c} home={app.home} /></> },
  { id: 'apariencia', icon: Palette, cards: (c) => <><AppearanceCard c={c} /><InterfaceCard c={c} /></> },
  { id: 'modelo', icon: Brain, cards: (c) => <BrainCard c={c} /> },
  { id: 'tareas', icon: ListChecks, cards: (c) => <TasksCard c={c} /> },
  { id: 'movil', icon: Smartphone, cards: () => <MobileCard /> },
  { id: 'herramientas', icon: Wrench, cards: (c) => <><BrowserCard c={c} /><McpCard c={c} /><AndroidCard /></> },
  { id: 'experto', icon: SquareTerminal, cards: (c) => <ExpertCard c={c} /> },
  { id: 'actualizaciones', icon: RefreshCw, cards: () => <UpdatesCard /> },
  { id: 'contribuye', icon: HeartHandshake, cards: () => <><SupportCard /><FeedbackCard /></> },
  { id: 'apps', icon: LayoutGrid, cards: () => <MoreAppsCard /> }
];

export function SettingsDialog() {
  const t = useT();
  const open = useStore((s) => s.settings);
  const app = useStore((s) => s.app);
  if (!app) return null;
  const section = SECTIONS.find((s) => s.id === open) ?? SECTIONS[0];
  const c = app.config;
  return (
    <Dialog open={Boolean(open)} onOpenChange={(o) => { if (!o) closeSettings(); }}>
      <DialogContent className="flex h-[min(780px,90vh)] w-[min(1080px,94vw)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none" data-testid="settings-dialog" aria-describedby={undefined}>
        <div className="flex h-16 shrink-0 items-center border-b px-6 pr-14">
          <DialogTitle className="text-lg font-medium">{PRODUCT.name} · {t('settings.title')}</DialogTitle>
        </div>
        <div className="flex min-h-0 flex-1">
          <nav className="flex w-56 shrink-0 flex-col max-sm:w-16" aria-label={t('settings.title')}>
            <div className="grid min-h-0 flex-1 content-start gap-1 overflow-y-auto px-3 pt-4">
              {SECTIONS.map(({ id, icon: Icon }) => (
                <button key={id} type="button" onClick={() => openSettings(id)} data-testid={`settings-nav-${id}`} aria-label={t(`settings.section.${id}`)} aria-current={section.id === id ? 'page' : undefined}
                  className={cn('flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm', section.id === id ? 'bg-accent text-accent-foreground font-medium' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground')}>
                  <Icon className="size-[18px] shrink-0" /><span className="truncate max-sm:hidden">{t(`settings.section.${id}`)}</span>
                </button>
              ))}
            </div>
            <div className="grid gap-0.5 px-6 pt-3 pb-5 max-sm:px-3" data-testid="settings-about">
              <BubbleTip title={`@${AUTHOR.github}`} text={AUTHOR.url.replace('https://', '')} side="top" align="start">
                <button type="button" onClick={() => bridge.openExternal(AUTHOR.url)} className="hover:text-primary flex w-fit cursor-pointer items-center gap-1.5 text-[13px] font-medium" aria-label={AUTHOR.url.replace('https://', '')}>
                  <ToolIcon tool="gh" className="size-4" /><span className="max-sm:hidden">@{AUTHOR.github}</span>
                </button>
              </BubbleTip>
              <span className="text-muted-foreground text-xs max-sm:hidden">{PRODUCT.name} {app.version}</span>
            </div>
          </nav>
          <div key={section.id} className="min-h-0 min-w-0 flex-1 overflow-y-auto px-6 pt-6 pb-8">
            {/* min-w-0 on the cards: a long one-line text inside (a path, a wide control) must not widen the column in a narrow window */}
            <div className="mx-auto grid max-w-3xl gap-4 [&>*]:min-w-0">
              <div className="grid gap-1 pb-1"><h2 className="text-2xl font-medium">{t(`settings.section.${section.id}`)}</h2><p className="text-muted-foreground text-sm">{t(`settings.sectionDesc.${section.id}`)}</p></div>
              {section.cards(c, app)}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

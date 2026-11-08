// Settings: the assistant, its brain, how tasks run, usage caps, skills and MCP servers and the assistant's folder.
// 3.6 (DESIGN-SYSTEM §2.3): six sections — General, Magic Link (Dispositivos), Agentes y uso, Datos, Avanzado and
// Acerca de.
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { DatabaseBackup, Settings, FlaskConical, FolderOpen, Plus, Trash2, ArrowLeftRight, Smartphone, Globe, PictureInPicture2, SquareTerminal, ZoomIn, ZoomOut, MonitorCog, Palette, HeartHandshake, HandHeart, MessageSquareText, Camera, ImagePlus, X, Send, Download, Wrench, ChevronRight, SlidersHorizontal, Radar, Cpu, Info, ExternalLink, ShieldBan, RotateCcw, Puzzle } from 'lucide-react';
import { ToolIcon } from '@/components/agent-icon.jsx';
import { SKINS, FONTS, CODE_FONTS, CODE_THEMES, APPEARANCE_DEFAULTS } from '../../core/appearance.mjs';
import { PRODUCT, AUTHOR } from '../../core/product.mjs';
import { PANELS, savePanels } from './expert.jsx';
import { PageHeader } from '@/components/page.jsx';
import { Robot } from '@/components/robot.jsx';
import { SkinPreview } from '@/components/skin-preview.jsx';
import { confirm, form } from '@/components/dialogs.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Badge, Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter, Field, Input, Textarea, Kbd, PathText, Spinner } from '@/components/ui/basic.jsx';
import { Select, Switch, Checkbox, Dialog, DialogContent, DialogTitle, BubbleTip, Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/overlay.jsx';
import { ModelGuide } from '@/components/model-guide.jsx';
import { AGENT } from '@/lib/labels.js';
import { useStore, call, act, bridge, setState, getState, applyTheme, applyAppearance, go, openTerminal, openSettings, closeSettings, fullPc, runTest } from '@/lib/store.js';
import { cn } from '@/lib/utils.js';
import { t, useT, useLocale } from '@/lib/i18n.js';
import { LANGUAGES } from '../../core/i18n.mjs';
import { useUpdate, updateActions, notesUrl } from '@/components/update-card.jsx';
import { play } from '@/lib/sounds.js';
import { MagicLinkPanel, SubSection } from './magic-link.jsx';
import { DataCards } from './data.jsx';
import { ExtensionsPanel } from './extensions.jsx';
import { unlockCore } from '@/lib/core-access.js';
import { DEFAULT_PROTECTED } from '../../core/layout.mjs';

// unlock: the master password's token, for a change that needs it (src/core/permissions.mjs › needsUnlock).
async function save(patch, ok = t('settings.saved'), unlock = null) {
  const config = await act(call('config.save', { patch, ...(unlock ? { unlock } : {}) }), ok);
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
          <Field label={t('settings.userName')}><Input value={v.userName} onChange={(e) => setV({ ...v, userName: e.target.value })} maxLength={40} /></Field>          <Field label={t('settings.language')} hint={t('settings.languageHint')}><Select className="w-full" value={v.language} onValueChange={(language) => { setV({ ...v, language }); save({ language }); }} options={Object.entries(LANGUAGES).map(([value, label]) => ({ value, label }))} /></Field>
        </div>
      </CardContent>
      <CardFooter><Button size="sm" onClick={() => save({ assistantName: v.assistantName.trim(), userName: v.userName.trim(), language: v.language })}>{t('settings.save')}</Button></CardFooter>
    </Card>
  );
}

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
        {fullPc() ? <Field label={t('appearance.skin')} hint={t('appearance.skinHint')}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label={t('appearance.skin')} data-testid="skin-picker">
            {SKINS.map((skin) => (
              <button key={skin} type="button" role="radio" aria-checked={ui.skin === skin} onClick={() => set({ skin })} data-testid={`skin-${skin}`}
                className={cn('grid cursor-pointer gap-1.5 rounded-xl border p-2 text-left transition-colors', ui.skin === skin ? 'border-primary ring-primary/30 ring-2' : 'hover:bg-accent/40')}>
                <SkinPreview skin={skin} />
                <span className="text-[13px] font-medium">{t(`appearance.skin.${skin}`)}</span>
              </button>
            ))}
          </div>
        </Field> : null}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('appearance.font')}><Select className="w-full" value={ui.font} onValueChange={(font) => set({ font })} options={opts(FONTS, 'appearance.font')} /></Field>
          <Field label={t('appearance.codeFont')}><Select className="w-full" value={ui.codeFont} onValueChange={(codeFont) => set({ codeFont })} options={opts(CODE_FONTS, 'appearance.codeFont')} /></Field>
          <Field label={t('appearance.codeTheme')}><Select className="w-full" value={ui.codeTheme} onValueChange={(codeTheme) => set({ codeTheme })} options={opts(CODE_THEMES, 'appearance.codeTheme')} /></Field>
        </div>
        <pre className="code-sample hljs overflow-x-auto rounded-lg border p-3 text-[12.5px] leading-[1.55]" aria-label={t('appearance.codeSample')}><code><span className="hljs-keyword">const</span> <span className="hljs-variable">orb</span> = <span className="hljs-title function_">director</span>(<span className="hljs-string">'bolsillo'</span>, {'{ '}<span className="hljs-attr">fases</span>: <span className="hljs-number">3</span>{' }'}); <span className="hljs-comment">// Orbe</span></code></pre>
        <Row label={t('appearance.usageLine')} hint={t('appearance.usageLineHint')}><Switch checked={ui.usageLine !== false} onCheckedChange={(usageLine) => set({ usageLine })} data-testid="usage-line-switch" /></Row>
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

// 2.6: the brain (agent, model, reasoning) and the Orquestador switch are chosen under the chat's message box; here only
// what is not there: how long a conversation lasts and, with several accounts of the brain's agent, which one it uses.
function ChatCard({ c }) {
  const t = useT();
  const o = c.orchestrator;
  const agent = o.agent || 'claude';
  const [v, setV] = useState({ maxTurns: o.maxTurns, account: o.account || agent });
  const accounts = (c.accounts ?? []).filter((a) => a.agent === agent);
  return (
    <Card>
      <CardHeader><CardTitle>{t('settings.chatCard')}</CardTitle><CardDescription>{t('settings.chatCardDesc')}</CardDescription></CardHeader>
      <CardContent className="grid gap-4">
        <Field label={t('settings.maxTurns')} hint={t('settings.maxTurnsHint')}><Input type="number" min={2} max={200} value={v.maxTurns} onChange={(e) => setV({ ...v, maxTurns: num(e.target.value) })} className="w-28" /></Field>
        {accounts.length > 1 ? <Field label={t('settings.brainAccount')}><Select className="w-full" value={v.account} onValueChange={(account) => setV({ ...v, account })} options={accounts.map((a) => ({ value: a.id, label: a.label }))} /></Field> : null}
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
    delegation: c.delegation?.enabled !== false, trusted: c.delegation?.trusted !== false, maxPerTask: c.delegation?.maxPerTask ?? 4,
    oneAtATime: c.oneAtATime === true, approvalWait: c.approvalWaitMinutes ?? 10, parallelChats: c.orchestrator?.parallel ?? 3 });
  const cap = (a, k, val) => setV({ ...v, caps: { ...v.caps, [a]: { ...v.caps[a], [k]: num(val) } } });
  // 2.6: one slider from maximum saving to maximum use sets every limit at once (and how careful the assistant is with
  // the quota); the limits themselves stay in «Opciones avanzadas» for whoever wants to tune them by hand.
  const [profile, setProfile] = useState(c.budget.profile === undefined ? 2 : c.budget.profile);
  const [advanced, setAdvanced] = useState(false);
  const applyProfile = (level) => {
    const p = SPEND_PRESETS[level];
    const caps = Object.fromEntries(agents.map((a) => [a, { maxTasks: p.maxTasks, maxHeavy: p.maxHeavy }]));
    setProfile(level);
    setV({ ...v, maxParallel: p.maxParallel, perAgent: p.perAgent, timeoutMinutes: p.timeoutMinutes, stopAt: Math.round(p.stopAt * 100), caps, high: p.high, maxPerTask: p.maxPerTask, trusted: p.trusted, review: p.review });
    save({ maxParallel: p.maxParallel, perAgent: p.perAgent, timeoutMinutes: p.timeoutMinutes, review: { auto: p.review }, policy: { highNeedsApproval: p.high }, budget: { profile: level, stopAt: p.stopAt, agents: caps }, delegation: { maxPerTask: p.maxPerTask, trusted: p.trusted } });
  };
  const level = profile ?? null;
  return (
    <Card>
      <CardHeader><CardTitle>{t('settings.tasks')}</CardTitle><CardDescription>{t('settings.tasksDesc')}</CardDescription></CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2" data-testid="spend-profile">
          <div className="flex items-baseline justify-between gap-3"><span className="text-sm font-medium">{t('settings.spend')}</span><span className="text-sm font-medium text-primary">{level == null ? t('settings.spendCustom') : t(`settings.spend${level}`)}</span></div>
          <div className="text-muted-foreground flex justify-between text-xs"><span>{t('settings.spendLow')}</span><span>{t('settings.spendHigh')}</span></div>
          <input type="range" min={0} max={4} step={1} value={level ?? 2} onChange={(e) => applyProfile(Number(e.target.value))} className="spend-slider" aria-label={t('settings.spend')} aria-valuetext={level == null ? t('settings.spendCustom') : t(`settings.spend${level}`)} data-testid="spend-slider" />
          <div className="spend-ticks" aria-hidden="true">{[0, 1, 2, 3, 4].map((i) => <span key={i} className={cn(i === 2 && 'spend-ticks-rec')}>{i === 2 ? t('settings.spendRecommended') : ''}</span>)}</div>
          <p className="text-muted-foreground text-xs leading-snug">{level == null ? t('settings.spendCustomHint') : t(`settings.spend${level}Hint`)}</p>
        </div>
        {/* 2.7: Orb chooses each task's model and reasoning (on by default), and the guide says what it uses for what. */}
        <Row label={t('settings.autoModel')} hint={t('settings.autoModelHint')}><Switch checked={c.budget?.autoModel !== false} onCheckedChange={(autoModel) => save({ budget: { autoModel } })} data-testid="auto-model" /></Row>
        <ModelGuide auto={c.budget?.autoModel !== false} />
        <Row label={t('settings.autoRun')} hint={t('settings.autoRunHint')}><Switch checked={v.autoRun} onCheckedChange={(autoRun) => { setV({ ...v, autoRun }); save({ autoRun }); }} /></Row>
        {/* 3.1: tasks work at the same time by default; this makes them wait for each other. */}
        <Row label={t('settings.oneAtATime')} hint={t('settings.oneAtATimeHint')}><Switch checked={v.oneAtATime} onCheckedChange={(oneAtATime) => { setV({ ...v, oneAtATime }); save({ oneAtATime }); }} data-testid="one-at-a-time" /></Row>
        <Row label={t('settings.resumeRestart')} hint={t('settings.resumeRestartHint')}><Switch checked={v.resumeAfterRestart} onCheckedChange={(resumeAfterRestart) => { setV({ ...v, resumeAfterRestart }); save({ continuity: { resumeAfterRestart } }); }} /></Row>
        <Row label={t('settings.resumeReset')} hint={t('settings.resumeResetHint')}><Switch checked={v.resumeAtReset} onCheckedChange={(resumeAtReset) => { setV({ ...v, resumeAtReset }); save({ continuity: { resumeAtReset } }); }} /></Row>
        <Row label={t('settings.delegation')} hint={t('settings.delegationHint')}><Switch checked={v.delegation} onCheckedChange={(delegation) => { setV({ ...v, delegation }); save({ delegation: { enabled: delegation } }); }} /></Row>
        <Collapsible open={advanced} onOpenChange={setAdvanced}>
          <CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-1.5 text-sm" data-testid="spend-advanced"><ChevronRight className={cn('size-4 transition-transform', advanced && 'rotate-90')} />{t('settings.advanced')}</CollapsibleTrigger>
          <CollapsibleContent>
        <div className="grid gap-4 pt-4">
        <p className="text-muted-foreground text-xs leading-snug">{t('settings.advancedHint')}</p>
        <Row label={t('settings.review')} hint={t('settings.reviewHint')}><Switch checked={v.review} onCheckedChange={(review) => { setV({ ...v, review }); setProfile(null); save({ review: { auto: review }, budget: { profile: null } }); }} /></Row>
        <Row label={t('settings.trusted')} hint={t('settings.trustedHint', { n: v.maxPerTask })}><Switch checked={v.trusted} disabled={!v.delegation} onCheckedChange={(trusted) => { setV({ ...v, trusted }); setProfile(null); save({ delegation: { trusted }, budget: { profile: null } }); }} /></Row>
        <Row label={t('settings.highApproval')}><Switch checked={v.high} onCheckedChange={(high) => { setV({ ...v, high }); setProfile(null); save({ policy: { highNeedsApproval: high }, budget: { profile: null } }); }} /></Row>
        <div className="grid grid-cols-4 gap-3">
          <Field label={t('settings.parallel')}><Input type="number" min={1} max={10} value={v.maxParallel} onChange={(e) => setV({ ...v, maxParallel: num(e.target.value) })} /></Field>
          <Field label={t('settings.perAgent')}><Input type="number" min={1} max={5} value={v.perAgent} onChange={(e) => setV({ ...v, perAgent: num(e.target.value) })} /></Field>
          <Field label={t('settings.maxMinutes')}><Input type="number" min={5} max={600} value={v.timeoutMinutes} onChange={(e) => setV({ ...v, timeoutMinutes: num(e.target.value) })} /></Field>
          <Field label={t('settings.windowHours')}><Input type="number" min={1} max={24} value={v.windowHours} onChange={(e) => setV({ ...v, windowHours: num(e.target.value) })} /></Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label={t('settings.stopAt')} hint={t('settings.stopAtHint')}><Input type="number" min={50} max={100} value={v.stopAt} onChange={(e) => setV({ ...v, stopAt: num(e.target.value) })} /></Field>
          <Field label={t('settings.maxPerTask')} hint={t('settings.maxPerTaskHint')}><Input type="number" min={0} max={20} value={v.maxPerTask} onChange={(e) => setV({ ...v, maxPerTask: num(e.target.value) })} /></Field>
          <Field label={t('settings.approvalWait')} hint={t('settings.approvalWaitHint')}><Input type="number" min={0} max={240} value={v.approvalWait} onChange={(e) => setV({ ...v, approvalWait: num(e.target.value) })} data-testid="approval-wait" /></Field>
          {/* 3.2: how many conversations the assistant answers at the same time (the others wait their turn). */}
          <Field label={t('settings.parallelChats')} hint={t('settings.parallelChatsHint')}><Input type="number" min={1} max={6} value={v.parallelChats} onChange={(e) => setV({ ...v, parallelChats: num(e.target.value) })} data-testid="parallel-chats" /></Field>
        </div>
        <div className="grid gap-2">
          <div className="text-muted-foreground text-xs">{t('settings.safetyNet')}</div>
          <div className="text-muted-foreground grid grid-cols-3 gap-3 text-xs"><span>{t('settings.colAgent')}</span><span>{t('settings.colTasks')}</span><span>{t('settings.colHeavy')}</span></div>
          {agents.map((a) => <div key={a} className="grid grid-cols-3 items-center gap-3"><span className="text-sm">{AGENT[a] ?? a}</span><Input type="number" min={1} value={v.caps[a].maxTasks} onChange={(e) => cap(a, 'maxTasks', e.target.value)} /><Input type="number" min={0} value={v.caps[a].maxHeavy} onChange={(e) => cap(a, 'maxHeavy', e.target.value)} /></div>)}
        </div>
        <div><Button size="sm" onClick={() => { setProfile(null); save({ autoRun: v.autoRun, maxParallel: v.maxParallel, perAgent: v.perAgent, timeoutMinutes: v.timeoutMinutes, review: { auto: v.review }, policy: { highNeedsApproval: v.high }, budget: { profile: null, windowHours: v.windowHours, stopAt: Math.min(1, Math.max(0.5, v.stopAt / 100)), agents: v.caps }, delegation: { maxPerTask: v.maxPerTask }, approvalWaitMinutes: Math.min(240, Math.max(0, v.approvalWait)), orchestrator: { parallel: Math.min(6, Math.max(1, v.parallelChats || 3)) } }); }} data-testid="spend-save">{t('settings.save')}</Button></div>
        </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

// The five levels of the «ahorro ↔ uso» slider: the limits each one sets (2 = the usual ones, recommended).
const SPEND_PRESETS = [
  { maxParallel: 1, perAgent: 1, timeoutMinutes: 30, stopAt: 0.75, maxTasks: 8, maxHeavy: 1, high: true, maxPerTask: 1, trusted: false, review: false },
  { maxParallel: 2, perAgent: 1, timeoutMinutes: 45, stopAt: 0.85, maxTasks: 12, maxHeavy: 3, high: true, maxPerTask: 2, trusted: true, review: false },
  { maxParallel: 3, perAgent: 1, timeoutMinutes: 60, stopAt: 0.92, maxTasks: 20, maxHeavy: 6, high: true, maxPerTask: 4, trusted: true, review: false },
  { maxParallel: 4, perAgent: 2, timeoutMinutes: 90, stopAt: 0.96, maxTasks: 30, maxHeavy: 10, high: false, maxPerTask: 6, trusted: true, review: true },
  { maxParallel: 6, perAgent: 2, timeoutMinutes: 120, stopAt: 0.99, maxTasks: 50, maxHeavy: 20, high: false, maxPerTask: 10, trusted: true, review: true }
];

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

// Android's adb: downloaded by Orb into core\herramientas\adb (and in the agents' PATH).
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

// 3.0: the test request, always here (in the chat it shows only on the first opening of the day).
function TestCard() {
  const t = useT();
  return (
    <Card>
      <CardHeader><CardTitle>{t('test.title')}</CardTitle><CardDescription>{t('test.desc')}</CardDescription></CardHeader>
      <CardFooter><Button size="sm" variant="outline" onClick={() => { closeSettings(); runTest(t('test.prompt')); }} data-testid="settings-test"><FlaskConical />{t('test.button')}</Button></CardFooter>
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

// Phone access: on/off and the addresses (wifi, Tailscale). 3.5: the QR and the linked devices are in Magic Link.
function MobileCard() {
  const t = useT();
  const [st, setSt] = useState(null);
  const load = () => call('remote.status').then(setSt).catch(() => {});
  useEffect(() => { load(); }, []);
  const configure = async (patch) => { const r = await act(call('remote.configure', patch)); if (r) setSt(r); };
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
        <Row label={t('settings.mobileAccess')} hint={st.running ? t('settings.mobileOn') : st.error ?? t('settings.disabled')}><Switch checked={st.enabled} onCheckedChange={async (enabled) => { const r = await act(call('remote.enable', { enabled })); if (r) setSt(r); }} /></Row>
        {st.enabled ? <div className="grid gap-1">{via('wifi')}{via('tailscale')}</div> : null}
        {st.enabled && st.error && st.running ? <p className="text-muted-foreground text-xs">{st.error}</p> : null}
        {/* 3.5: the QR, the short code and the linked devices are in Magic Link, below. */}
        {st.running && route('wifi') ? <p className="text-muted-foreground text-xs">{t('settings.mobileWifiNote')}</p> : null}
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

// «Cosas que nadie toca» (config.protected, src/core/guard.mjs › protectedHit): names, paths or containers no agent
// touches. Chips to remove, a field to add; saved at once. 3.8: taking off one of the defaults (a password manager) asks
// first, and «Restaurar los de serie» brings back the ones missing (adding needs no password).
function ProtectedCard({ c }) {
  const t = useT();
  const [draft, setDraft] = useState('');
  const list = Array.isArray(c.protected) ? c.protected : [];
  const store = async (items) => {
    const seen = new Set();
    const clean = items.map((x) => String(x ?? '').trim()).filter((x) => x.length >= 2 && !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase()));
    // 3.8: taking something off the list asks for the master password first.
    const unlock = list.some((x) => !clean.includes(x)) ? await unlockCore('protected') : null;
    if (list.some((x) => !clean.includes(x)) && !unlock) return undefined;
    return save({ protected: clean.slice(0, 50) }, t('settings.protectedSaved'), unlock);
  };
  const add = async () => { if (draft.trim().length >= 2 && await store([...list, draft])) setDraft(''); };
  const isDefault = (x) => DEFAULT_PROTECTED.some((d) => d.toLowerCase() === x.toLowerCase());
  const remove = async (x) => {
    if (isDefault(x) && !await confirm(t('settings.protectedRemoveTitle', { name: x }), t('settings.protectedRemoveBody'), { ok: t('settings.remove'), danger: true })) return;
    await store(list.filter((y) => y !== x));
  };
  const missing = DEFAULT_PROTECTED.filter((d) => !list.some((x) => x.toLowerCase() === d.toLowerCase()));
  return (
    <Card data-testid="protected-card">
      <CardHeader className="flex-row items-start gap-3 [&>svg]:mt-0.5 [&>svg]:shrink-0"><ShieldBan className="text-primary size-5" /><div><CardTitle>{t('settings.protected')}</CardTitle><CardDescription>{t('settings.protectedHint')}</CardDescription></div></CardHeader>
      <CardContent className="grid gap-3">
        {list.length ? (
          <div className="flex flex-wrap gap-1.5">
            {list.map((x) => (
              <Badge key={x} variant="secondary" className="gap-1 font-mono" data-testid="protected-item">
                {x}
                <button type="button" className="hover:text-destructive -mr-0.5 rounded-sm" aria-label={t('settings.protectedRemove', { name: x })} onClick={() => remove(x)} data-testid="protected-remove"><X className="size-3" /></button>
              </Badge>
            ))}
          </div>
        ) : <p className="text-muted-foreground text-sm">{t('settings.protectedEmpty')}</p>}
        <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <Input value={draft} maxLength={200} onChange={(e) => setDraft(e.target.value)} placeholder={t('settings.protectedPh')} data-testid="protected-input" />
          <Button type="submit" size="sm" variant="outline" disabled={draft.trim().length < 2 || list.length >= 50}><Plus />{t('settings.protectedAdd')}</Button>
        </form>
        {missing.length ? <div><Button size="sm" variant="ghost" onClick={() => store([...list, ...missing])} data-testid="protected-defaults"><RotateCcw />{t('settings.protectedDefaults')}</Button></div> : null}
      </CardContent>
    </Card>
  );
}

// Interface: its size on this PC (also Ctrl + / Ctrl - / Ctrl 0) and the terminal that Ctrl+J opens.
export const sizes = () => [{ value: '0.87', label: t('settings.size.small') }, { value: '1', label: t('settings.size.normal') }, { value: '1.15', label: t('settings.size.large') }];
function InterfaceCard({ c }) {
  const t = useT();
  const [zoom, setZoom] = useState(null);
  // 3.7: on Linux, its usual terminals (src/engine/terminal.mjs LINUX_TERMINALS) instead of Windows' ones.
  const linux = window.orb?.platform === 'linux';
  const terminals = linux ? { auto: t('settings.term.auto'), warp: 'Warp', 'x-terminal-emulator': t('settings.term.system'), 'gnome-terminal': 'GNOME Terminal', konsole: 'Konsole', 'xfce4-terminal': 'Xfce Terminal', kitty: 'kitty', alacritty: 'Alacritty', xterm: 'XTerm' }
    : window.orb?.platform && window.orb.platform !== 'win32' ? { auto: t('settings.term.auto'), warp: 'Warp' }
      : { auto: t('settings.term.auto'), warp: 'Warp', wt: 'Windows Terminal', powershell: 'PowerShell', cmd: t('settings.term.cmd') };
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

// Contribute: a contribution through PayPal and feedback straight to the developer's inbox (src/engine/feedback.mjs).
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

// 3.6: «Acerca de»: the version, the developer's GitHub and the licence (they were at the foot of the sections list).
function AboutCard({ version }) {
  const t = useT();
  return (
    <Card data-testid="settings-about">
      <CardHeader className="flex-row items-center gap-3"><img src="./icon-o.png" alt="" className="size-10 shrink-0 rounded-[22%]" data-testid="about-icon" /><div><CardTitle>{PRODUCT.name} {version}</CardTitle></div></CardHeader>
      <CardContent className="grid gap-1 text-sm">
        <div className="flex items-center justify-between gap-3"><span className="text-muted-foreground">{t('about.developer')}</span>
          <button type="button" onClick={() => bridge.openExternal(AUTHOR.url)} className="hover:text-primary inline-flex cursor-pointer items-center gap-1.5 font-medium" data-testid="about-github"><ToolIcon tool="gh" className="size-4" />@{AUTHOR.github}<ExternalLink className="text-muted-foreground size-3.5" /></button>
        </div>
        <div className="flex items-center justify-between gap-3"><span className="text-muted-foreground">{t('about.license')}</span><span>MIT</span></div>
      </CardContent>
    </Card>
  );
}

// What a notification shows on a locked phone. 3.8: «all» (before, the bots' messages too) shows the same as «chat»:
// it is offered no more and reads as «chat».
const PREVIEWS = ['chat', 'none'];
const previewOf = (v) => (v === 'none' ? 'none' : 'chat');

// Ajustes is a window over the app: six sections on the left (DESIGN-SYSTEM §2.3). groups: the parts of a section, each
// with its heading; the active section lists them under its name in the menu, to jump to one.
const SECTIONS = [
  { id: 'general', icon: SlidersHorizontal, groups: ['apariencia', 'actualizaciones'],
    cards: (c, app) => <><AssistantCard c={c} /><FolderCard c={c} home={app.home} /><SubSection id="apariencia" title={t('settings.group.apariencia')}><AppearanceCard c={c} /><InterfaceCard c={c} /></SubSection><SubSection id="actualizaciones" title={t('settings.group.actualizaciones')}><UpdatesCard /></SubSection></> },
  // Who can enter this Orb: the linked phones and browsers.
  { id: 'magiclink', icon: Radar, groups: ['dispositivos'],
    cards: () => <MagicLinkPanel grouped phoneAccess={<MobileCard />} /> },
  { id: 'agentes', icon: Cpu, cards: (c) => <><ChatCard c={c} /><TasksCard c={c} />{bridge.mobile ? null : <TestCard />}</> },
  // 3.8.1: every skill and MCP server of core (src/ui/views/extensions.jsx); this PC only.
  { id: 'extensiones', icon: Puzzle, pcOnly: true, cards: () => <ExtensionsPanel /> },
  { id: 'datos', icon: DatabaseBackup, cards: () => <DataCards /> },
  { id: 'avanzado', icon: Wrench, groups: () => ['herramientas', ...(fullPc() ? ['experto'] : [])],
    cards: (c) => <><SubSection id="herramientas" title={t('settings.group.herramientas')}><BrowserCard c={c} /><ProtectedCard c={c} /><AndroidCard /></SubSection>
      {fullPc() ? <SubSection id="experto" title={t('settings.group.experto')}><ExpertCard c={c} /></SubSection> : null}</> },
  { id: 'acerca', icon: Info, groups: ['contribuye', 'apps'],
    cards: (c, app) => <><AboutCard version={app.version} /><SubSection id="contribuye" title={t('settings.group.contribuye')}><SupportCard /><FeedbackCard /></SubSection><SubSection id="apps" title={t('settings.group.apps')}><MoreAppsCard /></SubSection></> }
];
// The names of before 3.6 (links in tutorials, notices and the sidebar) → [section, part].
const ALIASES = { conexiones: ['magiclink', 'dispositivos'], movil: ['magiclink', 'dispositivos'], apariencia: ['general', 'apariencia'], actualizaciones: ['general', 'actualizaciones'], tareas: ['agentes'],
  herramientas: ['avanzado', 'herramientas'], mcp: ['extensiones'], skills: ['extensiones'], experto: ['avanzado', 'experto'], monitor: ['avanzado', 'herramientas'], contribuye: ['acerca', 'contribuye'], apps: ['acerca', 'apps'] };
export function resolveSection(open) {
  if (!open || open === true) return ['general', null];
  const [id, part = null] = String(open).split(':');
  return ALIASES[id] ? [ALIASES[id][0], part ?? ALIASES[id][1] ?? null] : [id, part];
}
const groupsOf = (section) => (typeof section.groups === 'function' ? section.groups() : section.groups ?? []);

export function SettingsDialog() {
  const t = useT();
  const open = useStore((s) => s.settings);
  const app = useStore((s) => s.app);
  const [wanted, part] = resolveSection(open);
  const openedAt = useStore((s) => s.settingsAt);
  // The part asked for (a link to «Copias de seguridad», a notice about updates…): scrolled into view once the section is drawn.
  // Some parts appear only after their data loads: it waits for them for a moment, and the sections above them may
  // still grow, so it follows for a second. Clicking the same part again scrolls again.
  useEffect(() => {
    if (!open || !part) return undefined;
    let frame = 0; const until = performance.now() + 1500;
    const tick = () => {
      document.getElementById(`settings-${part}`)?.scrollIntoView({ block: 'start' });
      if (performance.now() < until) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    // The person scrolls or clicks on their own (a menu opening must not jump away): stop following.
    const stop = () => cancelAnimationFrame(frame);
    window.addEventListener('wheel', stop, { once: true, passive: true });
    window.addEventListener('touchmove', stop, { once: true, passive: true });
    window.addEventListener('keydown', stop, { once: true });
    window.addEventListener('pointerdown', stop, { once: true, capture: true });
    return () => { stop(); window.removeEventListener('wheel', stop); window.removeEventListener('touchmove', stop); window.removeEventListener('keydown', stop); window.removeEventListener('pointerdown', stop, { capture: true }); };
  }, [open, part, openedAt]);
  if (!app) return null;
  const section = SECTIONS.find((s) => s.id === wanted && (!s.pcOnly || !bridge.mobile)) ?? SECTIONS[0];
  const c = app.config;
  return (
    <Dialog open={Boolean(open)} onOpenChange={(o) => { if (!o) closeSettings(); }}>
      <DialogContent className="flex h-[min(780px,90vh)] w-[min(1080px,94vw)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none" data-testid="settings-dialog" aria-describedby={undefined}>
        <div className="flex h-16 shrink-0 items-center border-b px-6 pr-14">
          <DialogTitle className="text-lg font-medium">{t('settings.title')}</DialogTitle>
        </div>
        <div className="flex min-h-0 flex-1">
            <nav className="flex w-56 shrink-0 flex-col max-sm:w-16" aria-label={t('settings.title')}>
              <div className="grid min-h-0 flex-1 content-start gap-1 overflow-y-auto px-3 pt-4 pb-4">
                {SECTIONS.filter((sec) => !sec.pcOnly || !bridge.mobile).map((sec) => {
                  const { id, icon: Icon } = sec;
                  const on = section.id === id;
                  const groups = on ? groupsOf(sec) : [];
                  return (
                    <div key={id} className="grid gap-0.5">
                      <button type="button" onClick={() => openSettings(id)} data-testid={`settings-nav-${id}`} aria-label={t(`settings.section.${id}`)} aria-current={on ? 'page' : undefined}
                        className={cn('flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm', on ? 'bg-accent text-accent-foreground font-medium' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground')}>
                        <Icon className="size-[18px] shrink-0" /><span className="truncate max-sm:hidden">{t(`settings.section.${id}`)}</span>
                      </button>
                      {groups.length ? (
                        <div className="grid gap-0.5 pb-1 pl-[42px] max-sm:hidden">
                          {groups.map((g) => (
                            <button key={g} type="button" onClick={() => openSettings(`${id}:${g}`)} data-testid={`settings-sub-${g}`} aria-current={part === g ? 'location' : undefined}
                              className={cn('cursor-pointer truncate rounded-lg px-2 py-1 text-left text-[13px]', part === g ? 'text-foreground font-medium' : 'text-muted-foreground hover:text-foreground')}>{t(`settings.group.${g}`)}</button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
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

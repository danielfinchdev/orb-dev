// Ajustes: the assistant, appearance, chat, tasks, interface, God mode, the folder, «Cosas que nadie toca» and the daily test.
import { useEffect, useState } from 'react';
import { FlaskConical, FolderOpen, Plus, ArrowLeftRight, SquareTerminal, ZoomIn, ZoomOut, MonitorCog, Palette, X, ChevronRight, ShieldBan, RotateCcw } from 'lucide-react';
import { SKINS, FONTS, CODE_FONTS, CODE_THEMES, APPEARANCE_DEFAULTS, plainSkin } from '../../../shared/appearance.mjs';
import { PANELS, savePanels } from '../expert.jsx';
import { Robot } from '@/components/robot.jsx';
import { SkinPreview } from '@/components/skin-preview.jsx';
import { confirm, form } from '@/components/dialogs.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Badge, Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter, Field, Input, Textarea } from '@/components/ui/basic.jsx';
import { Select, Switch, Checkbox, BubbleTip, Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/overlay.jsx';
import { ModelGuide } from '@/components/model-guide.jsx';
import { AGENT } from '@/lib/labels.js';
import { act, bridge, go, openTerminal, closeSettings, fullPc, runTest } from '@/lib/store.js';
import { cn } from '@/lib/utils.js';
import { t, useT } from '@/lib/i18n.js';
import { LANGUAGES } from '../../../shared/i18n.mjs';
import { play } from '@/lib/sounds.js';
import { unlockCore } from '@/lib/core-access.js';
import { DEFAULT_PROTECTED } from '../../../shared/layout.mjs';
import { available as musicAvailable, musicPrefs, setMusicVolume } from '@/lib/music.js';
import { save, num, Row, WithKeys, sizes } from './rows.jsx';

export function AssistantCard({ c }) {
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
export function AppearanceCard({ c }) {
  const t = useT();
  const ui = { ...APPEARANCE_DEFAULTS, ...c.ui };
  const [volume, setVolume] = useState(c.ui?.volume ?? 0.5);
  const set = (patch, ok = null) => save({ ui: patch }, ok);
  const opts = (list, prefix) => list.map((value) => ({ value, label: t(`${prefix}.${value}`) }));
  const robot = !plainSkin(ui.skin);
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
        {musicAvailable() ? <MusicVolume /> : null}
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
export function ChatCard({ c }) {
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

export function TasksCard({ c }) {
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
        <Row label={t('settings.autoModel')} info={t('settings.autoModelHint')}><Switch checked={c.budget?.autoModel !== false} onCheckedChange={(autoModel) => save({ budget: { autoModel } })} data-testid="auto-model" /></Row>
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
          <Field label={t('settings.approvalWait')} hint={t('settings.approvalWaitHint')}><div className="flex items-center gap-2"><Input type="number" min={0} max={240} value={v.approvalWait} onChange={(e) => setV({ ...v, approvalWait: num(e.target.value) })} aria-label={`${t('settings.approvalWait')} (${t('settings.minutes')})`} data-testid="approval-wait" /><span className="text-muted-foreground text-xs">{t('settings.minutes')}</span></div></Field>
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

// 3.0: the test request, always here (in the chat it shows only on the first opening of the day).
export function TestCard() {
  const t = useT();
  return (
    <Card>
      <CardHeader><CardTitle>{t('test.title')}</CardTitle><CardDescription>{t('test.desc')}</CardDescription></CardHeader>
      <CardFooter><Button size="sm" variant="outline" onClick={() => { closeSettings(); runTest(t('test.prompt')); }} data-testid="settings-test"><FlaskConical />{t('test.button')}</Button></CardFooter>
    </Card>
  );
}

export function FolderCard({ c, home }) {
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

// «Cosas que nadie toca» (config.protected, src/domain/security/guard.mjs › protectedHit): names, paths or containers no agent
// touches. Chips to remove, a field to add; saved at once. 3.8: taking off one of the defaults (a password manager) asks
// first, and «Restaurar los de serie» brings back the ones missing (adding needs no password).
export function ProtectedCard({ c }) {
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

export function InterfaceCard({ c }) {
  const t = useT();
  const [zoom, setZoom] = useState(null);
  // 3.7: on Linux, its usual terminals (src/engine/host/terminal.mjs LINUX_TERMINALS) instead of Windows' ones.
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
      <CardHeader className="flex-row items-start gap-3 [&>svg]:mt-0.5 [&>svg]:shrink-0"><MonitorCog className="text-primary size-5" /><div><CardTitle>{t('settings.interface')}</CardTitle><CardDescription><WithKeys text={t('settings.interfaceDesc')} keys={{ shortcut: ['Ctrl', 'J'] }} /></CardDescription></div></CardHeader>
      <CardContent className="grid gap-4">
        <Field label={t('settings.sizeLabel')} hint={<WithKeys text={t('settings.sizeHint')} keys={{ zoomIn: ['Ctrl', '+'], zoomOut: ['Ctrl', '-'], reset: ['Ctrl', '0'] }} />}>
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
export function ExpertCard({ c }) {
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

// 3.8.2: the background music's volume (Windows; lib/music.js), heard while it is dragged and saved when let go.
function MusicVolume() {
  const t = useT();
  const [v, setV] = useState(() => musicPrefs().volume);
  const keep = () => setMusicVolume(v, { save: true });
  return (
    <div className="flex items-center justify-between gap-4 py-1 text-sm">
      <span>{t('appearance.musicVolume')}</span>
      <input type="range" min={0} max={1} step={0.05} value={v} aria-label={t('appearance.musicVolume')} className="accent-primary w-40 cursor-pointer" data-testid="music-volume"
        onChange={(e) => { const n = Number(e.target.value); setV(n); setMusicVolume(n); }} onPointerUp={keep} onKeyUp={keep} />
    </div>
  );
}

// Ajustes: the assistant, appearance (theme, letter, size, chats, sound, music), terminal, git, chat, tasks, permissions, expert mode, the folder and the daily test.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { LayoutDashboard, Gem, Bot, Waves, Candy, Terminal, FlaskConical, FolderOpen, Plus, SquareTerminal, ZoomIn, ZoomOut, X, RotateCcw } from 'lucide-react';
import { SKINS, FONTS, CODE_FONTS, CODE_THEMES, PALETTES, APPEARANCE_DEFAULTS, plainSkin } from '../../../shared/appearance.mjs';
import { PANELS, savePanels, panelOn } from '../expert.jsx';
import { confirm } from '@/components/dialogs.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Badge, Input, Textarea } from '@/components/ui/basic.jsx';
import { Segmented } from '@/components/ui/primitives.jsx';
import { Select, Switch, Checkbox, Range, BubbleTip } from '@/components/ui/overlay.jsx';
import { ModelGuide } from '@/components/model-guide.jsx';
import { AGENT } from '@/lib/labels.js';
import { act, call, refresh, bridge, go, openTerminal, closeSettings, fullPc, runTest, darkOnlySkin, lightOnlySkin, useStore } from '@/lib/store.js';
import { cn } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';
import { LANGUAGES } from '../../../shared/i18n-core.mjs';
import { play } from '@/lib/sounds.js';
import { DEFAULT_PROTECTED } from '../../../shared/layout.mjs';
import { available as musicAvailable, musicPrefs, musicState, subscribe as onMusic, toggleMusic, setMusicVolume, setMusicTheme, setMusicReactive, setMusicIntensity } from '@/lib/music.js';
import { ADAPTIVE_THEMES } from '../../../shared/music.mjs';
import { SkinPreview } from '@/components/skin-preview.jsx';
import { save, markSaved, num, Row, WithKeys, sizes, MoreOptions, Block, Panel, Setting, Fld, Stack, Hint } from './rows.jsx';
import { quiet } from '@/lib/quiet.js';
import { DICTATION_ENGINES, dictationChoice, resolveDictation } from '../../../shared/dictation.mjs';

export function AssistantCard({ c }) {
  const t = useT();
  const [v, setV] = useState({ assistantName: c.assistantName, userName: c.userName, language: c.language });
  // The names save when the field is left (not on every key); an unchanged one saves nothing.
  const keep = (key) => { const val = v[key].trim(); if (val !== (c[key] ?? '')) save({ [key]: val }); };
  return (
    <Block title={t('settings.assistant')} note={t('settings.assistantDesc')}>
      <Panel>
        <Setting label={t('settings.assistantName')} hint={t('settings.assistantNameHint')}><Input className="w-[200px]" value={v.assistantName} onChange={(e) => setV({ ...v, assistantName: e.target.value })} onBlur={() => keep('assistantName')} maxLength={40} aria-label={t('settings.assistantName')} data-testid="assistant-name" /></Setting>
        <Setting label={t('settings.userName')} hint={t('settings.userNameHint')}><Input className="w-[200px]" value={v.userName} onChange={(e) => setV({ ...v, userName: e.target.value })} onBlur={() => keep('userName')} maxLength={40} aria-label={t('settings.userName')} data-testid="user-name" /></Setting>
        <Setting label={t('settings.language')} hint={t('settings.languageHint')}><Select caret="solid" value={v.language} onValueChange={(language) => { setV({ ...v, language }); save({ language }); }} title={t('settings.language')} options={Object.entries(LANGUAGES).map(([value, label]) => ({ value, label: label.replace(/\s*\(.*\)$/, '') }))} /></Setting>
      </Panel>
    </Block>
  );
}

// The icon of each theme's card, as the mock-up draws them.
const SKIN_ICON = { predeterminado: LayoutDashboard, cristal: Gem, orb: Bot, vaporwave: Waves, candy: Candy, retro: Terminal };
// The sample of each palette's accent (the mock-up's swatches).
const PALETTE_SWATCH = { grafito: 'oklch(0.6 0.18 40)', oceano: 'oklch(0.6 0.17 252)', bosque: 'oklch(0.6 0.13 155)', uva: 'oklch(0.6 0.18 300)', rubi: 'oklch(0.6 0.19 15)', arena: 'oklch(0.62 0.12 65)' };

// Appearance, in the blocks of the mock-up: theme, letter, size, chats, sound and music. Everything is saved as soon as it
// changes. Only the Orb theme shows the robot; the plain themes have no sounds nor motion.
function useUi(c) {
  const ui = { ...APPEARANCE_DEFAULTS, ...c.ui };
  const set = (patch, ok = null) => save({ ui: patch }, ok);
  return [ui, set];
}

export function ThemeCard({ c }) {
  const t = useT();
  const [ui, set] = useUi(c);
  const darkOnly = fullPc() && darkOnlySkin(ui.skin);
  const lightOnly = fullPc() && lightOnlySkin(ui.skin);
  const locked = darkOnly || lightOnly;
  const mode = ui.theme ?? 'sistema';
  return (
    <Block title={t('settings.themeTitle')} note={t('settings.themeNote')} data-testid="theme-card">
      <Panel>
        <Setting label={t('settings.theme')} hint={darkOnly ? t('comp.theme.darkOnly') : lightOnly ? t('comp.theme.lightOnly') : t('settings.themeHint')}>
          <div className="segm bg-secondary inline-flex gap-0.5 rounded-ctl p-0.5" role="radiogroup" aria-label={t('settings.theme')}>
            {['sistema', 'claro', 'oscuro'].map((theme) => (
              <button key={theme} type="button" role="radio" aria-checked={mode === theme} disabled={locked} onClick={() => set({ theme })}
                className={cn('focus-visible:outline-ring inline-flex h-(--ctl-sm) items-center rounded-[calc(var(--r-ctl)-2px)] px-2.5 text-control whitespace-nowrap outline-none focus-visible:outline-2', locked ? 'cursor-not-allowed opacity-50' : 'cursor-pointer', mode === theme ? 'bg-card text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.08)]' : 'text-muted-foreground hover:text-foreground')}>{t(`settings.theme.${theme}`)}</button>
            ))}
          </div>
        </Setting>
        {fullPc() ? (
          <>
            <Stack className="border-border border-t pb-0"><div className="flex flex-col gap-0.5"><span className="text-control font-medium">{t('appearance.skin')}</span><Hint>{t('appearance.skinHint')}</Hint></div></Stack>
            <div className="grid grid-cols-3 gap-2 px-3.5 py-3 max-[900px]:grid-cols-2" role="radiogroup" aria-label={t('appearance.skin')} data-testid="skin-picker">
              {SKINS.map((skin) => (
                <button key={skin} type="button" role="radio" aria-checked={ui.skin === skin} onClick={() => set({ skin })} data-testid={`skin-${skin}`}
                  className={cn('focus-visible:outline-ring flex min-w-0 cursor-pointer flex-col items-start gap-1 rounded-card border p-2.5 text-left outline-none focus-visible:outline-2', ui.skin === skin ? 'border-primary-text bg-card shadow-[0_0_0_1px_var(--primary-text)]' : 'border-border bg-card hover:bg-accent')}>
                  <span className="block w-full" data-testid={`skin-preview-${skin}`}><SkinPreview skin={skin} palette={ui.palette} /></span>
                  {(() => { const Icon = SKIN_ICON[skin]; return <Icon className="size-4" aria-hidden="true" />; })()}
                  <span className="text-control leading-[1.45] font-medium">{t(`appearance.skin.${skin}`)}</span>
                  <span className="text-muted-foreground text-caption leading-[1.45]">{t(`appearance.skinDesc.${skin}`)}</span>
                </button>
              ))}
            </div>
          </>
        ) : null}
        {fullPc() && plainSkin(ui.skin) ? (
          <Setting label={t('appearance.palette')} hint={t('appearance.paletteHint')} data-testid="palette-settings">
            <div className="flex gap-1.5" role="radiogroup" aria-label={t('appearance.palette')} data-testid="palette-picker">
              {PALETTES.map((id) => (
                <button key={id} type="button" role="radio" aria-checked={ui.palette === id} aria-label={t(`appearance.palette.${id}`)} title={t(`appearance.palette.${id}`)} onClick={() => set({ palette: id })} data-testid={`palette-${id}`}
                  className={cn('focus-visible:outline-ring grid size-8 cursor-pointer place-items-center rounded-full border outline-none focus-visible:outline-2', ui.palette === id ? 'border-foreground border-2' : 'border-border')}>
                  <i className="pal-dot block size-5 rounded-full" data-palette={id} style={{ width: 20, height: 20, background: PALETTE_SWATCH[id] }} aria-hidden="true" />
                </button>
              ))}
            </div>
          </Setting>
        ) : null}
      </Panel>
    </Block>
  );
}

// The letter of the interface and of the code, with a preview that follows the choice (html[data-font] is applied as it saves).
export function FontCard({ c }) {
  const t = useT();
  const [ui, set] = useUi(c);
  const opts = (list, prefix) => list.map((value) => ({ value, label: t(`${prefix}.${value}`) }));
  return (
    <Block title={t('settings.fontTitle')} note={t('settings.fontNote')} data-testid="font-card">
      <Panel>
        <Setting label={t('appearance.font')} hint={t('appearance.fontHint')}><Select caret="solid" value={ui.font} onValueChange={(font) => set({ font })} title={t('appearance.font')} options={opts(FONTS, 'appearance.font')} data-testid="font-select" /></Setting>
        <Setting label={t('appearance.codeFont')} hint={t('appearance.codeFontHint')}><Select caret="solid" value={ui.codeFont} onValueChange={(codeFont) => set({ codeFont })} title={t('appearance.codeFont')} options={opts(CODE_FONTS, 'appearance.codeFont')} data-testid="code-font-select" /></Setting>
        <Setting label={t('appearance.codeTheme')} hint={t('appearance.codeThemeHint')}><Select caret="solid" value={ui.codeTheme} onValueChange={(codeTheme) => set({ codeTheme })} title={t('appearance.codeTheme')} options={opts(CODE_THEMES, 'appearance.codeTheme')} /></Setting>
        <Stack className="border-border border-t">
          <span className="text-control font-medium">{t('appearance.codeSample')}</span>
          <p className="m-0 text-control" data-testid="font-preview-text">{t('settings.fontPreview')}</p>
          <pre className="bg-secondary border-border rounded-ctl m-0 overflow-x-auto border px-3 py-2.5 font-mono text-caption" aria-label={t('appearance.codeSample')}><code>{`const robot = await orbe.saluda('Dani');
if (robot.listo) console.log('Tarea hecha');`}</code></pre>
        </Stack>
      </Panel>
    </Block>
  );
}

// Zoom of the whole interface: the sizes of the list and the buttons − and + (steps of 10 %). Not on a phone: the browser has its own.
export function SizeCard() {
  const t = useT();
  const [zoom, setZoom] = useState(null);
  useEffect(() => { bridge.zoom?.().then(setZoom).catch(quiet); return bridge.on('ui:zoom', (p) => setZoom(p.zoom)); }, []);
  if (!bridge.zoom) return null;
  const SIZES = sizes();
  const preset = SIZES.find((o) => Math.abs(Number(o.value) - zoom) < 0.01)?.value;
  const change = async (value) => { const z = await act(bridge.zoom(Number(value))); if (z) { setZoom(z); markSaved(); } };
  return (
    <Block title={t('settings.sizeTitle')} note={t('settings.sizeNote')} data-testid="size-card">
      <Panel>
        <Setting label={t('settings.sizeLabel')} hint={<WithKeys plain text={t('settings.sizeHint')} keys={{ zoomIn: ['Ctrl', '+'], zoomOut: ['Ctrl', '-'], reset: ['Ctrl', '0'] }} />} data-testid="zoom-fine">
          <Select caret="solid" value={preset} placeholder={zoom ? t('settings.custom', { pct: Math.round(zoom * 100) }) : '…'} onValueChange={change} title={t('settings.sizeLabel')} options={SIZES} />
          <BubbleTip title={t('settings.zoomOut')}><Button size="icon-sm" variant="outline" aria-label={t('settings.zoomOut')} data-testid="zoom-out" onClick={() => change(zoom - 0.1)}><ZoomOut /></Button></BubbleTip>
          <BubbleTip title={t('settings.zoomIn')}><Button size="icon-sm" variant="outline" aria-label={t('settings.zoomIn')} data-testid="zoom-in" onClick={() => change(zoom + 0.1)}><ZoomIn /></Button></BubbleTip>
          <span className="text-muted-foreground min-w-9 text-caption tabular-nums">{zoom ? `${Math.round(zoom * 100)} %` : ''}</span>
        </Setting>
      </Panel>
    </Block>
  );
}

// How the chats are shown: the tabs and the cost line under each reply.
export function ChatsLookCard({ c }) {
  const t = useT();
  const [ui, set] = useUi(c);
  return (
    <Block title={t('settings.chatsTitle')} note={t('settings.chatsNote')} data-testid="chats-look-card">
      <Panel>
        <Row label={t('tabs.setting')} hint={t('tabs.settingHint')}><Switch checked={c.ui?.tabs !== false} onCheckedChange={(tabs) => save({ ui: { tabs } })} data-testid="tabs-switch" /></Row>
        <Row label={t('appearance.usageLine')} hint={t('appearance.usageLineHint')}><Switch checked={ui.usageLine !== false} onCheckedChange={(usageLine) => set({ usageLine })} data-testid="usage-line-switch" /></Row>
      </Panel>
    </Block>
  );
}

export function SoundCard({ c }) {
  const t = useT();
  const [ui, set] = useUi(c);
  const [volume, setVolume] = useState(c.ui?.volume ?? 0.5);
  return (
    <Block title={t('settings.soundTitle')} note={t('appearance.noRobot')} data-testid="sound-card">
      <Panel>
        <Row label={t('settings.companion')} hint={t('settings.companionHint')}><Switch checked={ui.companion !== false} onCheckedChange={(companion) => set({ companion }, companion ? t('settings.companionOn') : t('settings.companionOff'))} /></Row>
        <Row label={t('settings.motion')} hint={t('settings.motionHint')}><Switch checked={ui.motion !== 'minima'} onCheckedChange={(on) => set({ motion: on ? 'completa' : 'minima' }, on ? t('settings.motionOn') : t('settings.motionOff'))} /></Row>
        <Row label={t('settings.sounds')} hint={t('settings.soundsHint')}><Switch checked={ui.sounds !== false} onCheckedChange={(sounds) => set({ sounds }, sounds ? t('settings.soundsOn') : t('settings.soundsOff')).then(() => sounds && play('wake'))} /></Row>
        <Setting label={t('settings.volume')} hint={t('settings.volumeHint')}>
          <Range min={0.1} max={1} step={0.1} value={volume} aria-label={t('settings.volume')} disabled={ui.sounds === false} className="w-[120px]! cursor-pointer"
            onChange={(e) => setVolume(Number(e.target.value))} onPointerUp={() => set({ volume }).then(() => play('boop'))} onKeyUp={() => set({ volume })} />
        </Setting>
      </Panel>
    </Block>
  );
}

export function MusicCard() {
  const t = useT();
  if (!musicAvailable()) return null;
  return (
    <Block title={t('settings.musicTitle')} note={t('settings.musicNote')} data-testid="music-card">
      <Panel><MusicSettings /></Panel>
      <MusicMore />
    </Block>
  );
}

// What the mock-up does not draw of the music (its style, whether it follows what happens in Orb, or keeps one intensity): a second
// panel under the music rows, without its own «Más opciones» heading (General already ends with that one).
function MusicMore() {
  const t = useT();
  useStore((s) => s.app?.config?.ui?.music);
  const prefs = musicPrefs();
  const [level, setLevel] = useState(prefs.intensity);
  const keepLevel = () => setMusicIntensity(level, { save: true });
  return (
    <>
      <Panel data-testid="more-options-music">
        <Setting label={t('appearance.musicTheme')}>
          <Select caret="solid" className="w-52 shrink-0" value={prefs.theme} onValueChange={setMusicTheme} title={t('appearance.musicTheme')} data-testid="music-theme" options={ADAPTIVE_THEMES.map((value) => ({ value, label: t(`appearance.musicTheme.${value}`) }))} />
        </Setting>
        <Row label={t('appearance.musicReactive')} hint={t('appearance.musicReactiveHint')}><Switch checked={prefs.reactive} onCheckedChange={setMusicReactive} data-testid="music-reactive" /></Row>
        {prefs.reactive ? null : (
          <Setting label={t('appearance.musicIntensity')}>
            <Range min={0} max={1} step={0.05} value={level} aria-label={t('appearance.musicIntensity')} className="w-[120px]! cursor-pointer" data-testid="music-intensity"
              onChange={(e) => { const n = Number(e.target.value); setLevel(n); setMusicIntensity(n); }} onPointerUp={keepLevel} onKeyUp={keepLevel} />
          </Setting>
        )}
      </Panel>
    </>
  );
}

// the brain (agent, model, reasoning) and the Orquestador switch are chosen under the chat's message box; here only
// what is not there: how long a conversation lasts and, with several accounts of the brain's agent, which one it uses.
export function ChatCard({ c }) {
  const t = useT();
  const o = c.orchestrator;
  const agent = o.agent || 'claude';
  const [v, setV] = useState({ maxTurns: o.maxTurns, account: o.account || agent });
  const keepTurns = () => { if (v.maxTurns && v.maxTurns !== o.maxTurns) save({ orchestrator: { maxTurns: v.maxTurns } }); };
  const accounts = (c.accounts ?? []).filter((a) => a.agent === agent);
  return (
    <Block title={t('settings.chatCard')} note={t('settings.chatCardDesc')}>
      <Panel>
        <Setting label={t('settings.maxTurns')} hint={t('settings.maxTurnsHint')}><Input type="number" min={2} max={200} value={v.maxTurns} onChange={(e) => setV({ ...v, maxTurns: num(e.target.value) })} onBlur={keepTurns} className="w-[72px]" aria-label={t('settings.maxTurns')} data-testid="max-turns" /></Setting>
        {accounts.length > 1 ? <Setting label={t('settings.brainAccount')} hint={t('settings.brainAccountHint')}><Select caret="solid" value={v.account} onValueChange={(account) => { setV({ ...v, account }); save({ orchestrator: { account } }); }} title={t('settings.brainAccount')} options={accounts.map((a) => ({ value: a.id, label: a.label }))} /></Setting> : null}
      </Panel>
    </Block>
  );
}

// the agents' permission level for everything that does not choose its own (new chats, the assistant's tasks).
export function PermissionsCard({ c }) {
  const t = useT();
  const mode = c.permissions?.mode === 'preguntar' ? 'editar' : 'auto';
  return (
    <Block title={t('settings.autonomy')} note={t('settings.autonomyNote')}>
      <Panel>
        <Setting label={t('settings.autonomyLabel')} hint={<><b className="text-control font-medium">{t('session.autoMode')}:</b> {t('settings.autonomyHintAuto')} <b className="text-control font-medium">{t('session.askMode')}:</b> {t('settings.autonomyHintAsk')}</>}>
          {/* the same action as the chat's selector (the pieces of the mock-up here: two buttons, Auto and Preguntar) */}
          <Segmented value={mode} data-testid="settings-autonomy" aria-label={t('settings.autonomyLabel')} onChange={(p) => act(call('permissions.setMode', { mode: p === 'auto' ? 'auto' : 'preguntar' }), p === 'auto' ? t('session.autoOn') : t('session.askOn')).then(() => refresh())}
            options={[{ value: 'auto', label: t('session.autoMode'), testid: 'settings-autonomy-auto' }, { value: 'editar', label: t('session.askMode'), testid: 'settings-autonomy-editar' }]} />
        </Setting>
        <Stack><Hint className="leading-[1.45]">{t('settings.autonomyAlways')}</Hint><Hint className="leading-[1.45]">{t('settings.autonomyMore')}</Hint></Stack>
      </Panel>
    </Block>
  );
}

// How long a permission question waits for an answer before it is denied (own save: it is not part of the tasks form).
export function ApprovalWaitCard({ c }) {
  const t = useT();
  const saved = c.approvalWaitMinutes ?? 10;
  const [minutes, setMinutes] = useState(saved);
  return (
    <Block title={t('settings.approvalWaitTitle')} note={t('settings.approvalWaitNote')}>
      <Panel>
        <Setting label={t('settings.approvalWait')} hint={t('settings.approvalWaitHint')}>
          <Input type="number" min={0} max={240} value={minutes} onChange={(e) => setMinutes(num(e.target.value))} onBlur={() => { const next = Math.min(240, Math.max(0, minutes)); setMinutes(next); if (next !== saved) save({ approvalWaitMinutes: next }).then((r) => { if (!r) setMinutes(saved); }); }} className="w-[72px]" aria-label={`${t('settings.approvalWait')} (${t('settings.minutes')})`} data-testid="approval-wait" /><span className="text-muted-foreground text-control">{t('settings.minutes')}</span>
        </Setting>
      </Panel>
    </Block>
  );
}

export function TasksCard({ c }) {
  const t = useT();
  const agents = Object.keys(c.agents);
  const [v, setV] = useState({ autoRun: c.autoRun, maxParallel: c.maxParallel, perAgent: c.perAgent, timeoutMinutes: c.timeoutMinutes, review: c.review?.auto === true, high: c.policy?.highNeedsApproval !== false, windowHours: c.budget.windowHours,
    caps: Object.fromEntries(agents.map((a) => [a, { maxTasks: c.budget.agents?.[a]?.maxTasks ?? 20, maxHeavy: c.budget.agents?.[a]?.maxHeavy ?? 6 }])),
    resumeAfterRestart: c.continuity?.resumeAfterRestart !== false, resumeAtReset: c.continuity?.resumeAtReset !== false,
    delegation: c.delegation?.enabled !== false, trusted: c.delegation?.trusted !== false, maxPerTask: c.delegation?.maxPerTask ?? 4,
    oneAtATime: c.oneAtATime === true, parallelChats: c.orchestrator?.parallel ?? 3 });
  // What is stored now: a field saves when it is left, and only if it differs from this.
  const base = useRef(v);
  const cap = (a, k, val) => setV({ ...v, caps: { ...v.caps, [a]: { ...v.caps[a], [k]: num(val) } } });
  // one slider from maximum saving to maximum use sets every limit at once (and how careful the assistant is with
  // the quota); the limits themselves stay in «Opciones avanzadas» for whoever wants to tune them by hand.
  const [profile, setProfile] = useState(c.budget.profile === undefined ? 2 : c.budget.profile);
  const [advanced, setAdvanced] = useState(false);
  const applyProfile = (level) => {
    const p = SPEND_PRESETS[level];
    const caps = Object.fromEntries(agents.map((a) => [a, { maxTasks: p.maxTasks, maxHeavy: p.maxHeavy }]));
    const before = { profile, v };
    setProfile(level);
    const next = { ...v, maxParallel: p.maxParallel, perAgent: p.perAgent, timeoutMinutes: p.timeoutMinutes, stopAt: Math.round(p.stopAt * 100), caps, high: p.high, maxPerTask: p.maxPerTask, trusted: p.trusted, review: p.review };
    setV(next); base.current = next;
    // cancelling the password puts the slider and the fields back
    save({ maxParallel: p.maxParallel, perAgent: p.perAgent, timeoutMinutes: p.timeoutMinutes, review: { auto: p.review }, policy: { highNeedsApproval: p.high }, budget: { profile: level, stopAt: p.stopAt, agents: caps }, delegation: { maxPerTask: p.maxPerTask, trusted: p.trusted } }).then((r) => { if (!r) { setProfile(before.profile); setV(before.v); base.current = before.v; } });
  };
  const level = profile ?? null;
  const saveAdvanced = () => {
    const sent = v; const was = profile; setProfile(null);
    save({ autoRun: v.autoRun, maxParallel: v.maxParallel, perAgent: v.perAgent, timeoutMinutes: v.timeoutMinutes, review: { auto: v.review }, policy: { highNeedsApproval: v.high }, budget: { profile: null, windowHours: v.windowHours, agents: v.caps }, delegation: { maxPerTask: v.maxPerTask }, orchestrator: { parallel: Math.min(6, Math.max(1, v.parallelChats || 3)) } }).then((r) => {
      // only a saved value counts as stored; a cancelled password or a failure puts the fields back, so no later change resends it
      if (r) { base.current = sent; return; }
      setProfile(was);
      const b = base.current;
      setV((cur) => ({ ...cur, maxParallel: b.maxParallel, perAgent: b.perAgent, timeoutMinutes: b.timeoutMinutes, windowHours: b.windowHours, maxPerTask: b.maxPerTask, parallelChats: b.parallelChats, caps: b.caps }));
    });
  };
  const keepCaps = () => { const now = v.caps; if (JSON.stringify(now) !== JSON.stringify(base.current.caps)) saveAdvanced(); };
  const numField = (key, label, hint, extra = {}) => (
    <Setting label={label} hint={hint}><Input type="number" className="w-[72px]" value={v[key]} onChange={(e) => setV({ ...v, [key]: num(e.target.value) })} onBlur={() => { if (v[key] !== base.current[key]) saveAdvanced(); }} aria-label={label} {...extra} /></Setting>
  );
  return (
    <>
      <Block title={t('settings.tasks')} note={t('settings.tasksDesc')}>
        <Panel>
          <Setting label={t('settings.spend')} hint={level == null ? t('settings.spendCustomHint') : t(`settings.spend${level}Hint`)} data-testid="spend-profile">
            <Segmented className="max-w-full @max-[28rem]:w-full @max-[28rem]:flex-col" value={SPEND_BUTTON[level] ?? null} onChange={(k) => applyProfile(SPEND_LEVEL[k])} aria-label={t('settings.spend')}
              options={[{ value: 'low', label: t('settings.spendLow'), testid: 'spend-low' }, { value: 'recommended', label: t('settings.spendRecommended'), testid: 'spend-recommended' }, { value: 'high', label: t('settings.spendHigh'), testid: 'spend-high' }]} />
          </Setting>
          {/* Orb chooses each task's model and reasoning (on by default), and the guide says what it uses for what. */}
          <Row label={t('settings.autoModel')} hint={t('settings.autoModelHint')}><Switch checked={c.budget?.autoModel !== false} onCheckedChange={(autoModel) => save({ budget: { autoModel } })} data-testid="auto-model" /></Row>
          <Row label={t('settings.hideModelHelp')} hint={t('settings.hideModelHelpHint')}><Switch checked={c.ui?.hideModelHelp === true} onCheckedChange={(hideModelHelp) => save({ ui: { hideModelHelp } })} data-testid="hide-model-help" /></Row>
          <Row label={t('settings.autoRun')} hint={t('settings.autoRunHint')}><Switch checked={v.autoRun} onCheckedChange={(autoRun) => { setV({ ...v, autoRun }); save({ autoRun }); }} /></Row>
          {/* tasks work at the same time by default; this makes them wait for each other. */}
          <Row label={t('settings.oneAtATime')} hint={t('settings.oneAtATimeHint')}><Switch checked={v.oneAtATime} onCheckedChange={(oneAtATime) => { setV({ ...v, oneAtATime }); save({ oneAtATime }).then((r) => { if (!r) setV((cur) => ({ ...cur, oneAtATime: !oneAtATime })); }); }} data-testid="one-at-a-time" /></Row>
          <Row label={t('settings.resumeRestart')} hint={t('settings.resumeRestartHint')}><Switch checked={v.resumeAfterRestart} onCheckedChange={(resumeAfterRestart) => { setV({ ...v, resumeAfterRestart }); save({ continuity: { resumeAfterRestart } }); }} /></Row>
          <Row label={t('settings.resumeReset')} hint={t('settings.resumeResetHint')}><Switch checked={v.resumeAtReset} onCheckedChange={(resumeAtReset) => { setV({ ...v, resumeAtReset }); save({ continuity: { resumeAtReset } }); }} /></Row>
          <Row label={t('settings.delegation')} hint={t('settings.delegationHint')}><Switch checked={v.delegation} onCheckedChange={(delegation) => { setV({ ...v, delegation }); save({ delegation: { enabled: delegation } }); }} /></Row>
        </Panel>
      </Block>
      {bridge.mobile ? null : <TestCard />}
      <MoreOptions fold open={advanced} onOpenChange={setAdvanced} testid="spend-more" triggerTestid="spend-advanced">
            <Panel className="mt-0"><Row data-testid="settings-suggest" label={t('settings.suggest')} hint={`${t('settings.suggestDesc')}`} info={t('settings.suggestWarn')}><Switch checked={c.suggestNext === true} onCheckedChange={(suggestNext) => save({ suggestNext })} data-testid="suggest-next" /></Row></Panel>
            <Hint>{t('settings.advancedHint')}</Hint>
            <Panel>
              <Setting label={t('settings.spendFine')} hint={t('settings.spendFineHint')}>
                <span className="text-primary-text text-control font-medium">{level == null ? t('settings.spendCustom') : t(`settings.spend${level}`)}</span>
                <Range min={0} max={4} step={1} value={level ?? 2} onChange={(e) => applyProfile(Number(e.target.value))} className="w-[120px]! cursor-pointer" aria-label={t('settings.spendFine')} aria-valuetext={level == null ? t('settings.spendCustom') : t(`settings.spend${level}`)} data-testid="spend-slider" />
              </Setting>
              <Row label={<>{t('settings.review')} <Badge variant="info">{t('settings.reviewBadge')}</Badge></>} hint={t('settings.reviewHint')}><Switch checked={v.review} onCheckedChange={(review) => { setV({ ...v, review }); setProfile(null); save({ review: { auto: review }, budget: { profile: null } }); }} /></Row>
              <Row label={t('settings.trusted')} hint={t('settings.trustedHint', { n: v.maxPerTask })}><Switch checked={v.trusted} disabled={!v.delegation} onCheckedChange={(trusted) => { setV({ ...v, trusted }); setProfile(null); save({ delegation: { trusted }, budget: { profile: null } }); }} /></Row>
              <Row label={t('settings.highApproval')} hint={t('settings.highApprovalHint')}><Switch checked={v.high} onCheckedChange={(high) => { setV({ ...v, high }); setProfile(null); save({ policy: { highNeedsApproval: high }, budget: { profile: null } }); }} /></Row>
              {numField('maxParallel', t('settings.parallel'), t('settings.parallelHint'), { min: 1, max: 10 })}
              {numField('perAgent', t('settings.perAgent'), t('settings.perAgentHint'), { min: 1, max: 5 })}
              {numField('timeoutMinutes', t('settings.maxMinutes'), t('settings.maxMinutesHint'), { min: 5, max: 600 })}
              {numField('windowHours', t('settings.windowHours'), t('settings.windowHoursHint'), { min: 1, max: 24 })}
              {numField('maxPerTask', t('settings.maxPerTask'), t('settings.maxPerTaskHint'), { min: 0, max: 20 })}
              {/* how many conversations the assistant answers at the same time (the others wait their turn). */}
              {numField('parallelChats', t('settings.parallelChats'), t('settings.parallelChatsHint'), { min: 1, max: 6, 'data-testid': 'parallel-chats' })}
            </Panel>
            <Block title={t('settings.capsTitle')} note={t('settings.capsNote')}>
              <Panel>
                {agents.map((a) => (
                  <Setting key={a} label={AGENT[a] ?? a} hint={`${t('settings.colTasks')} · ${t('settings.colHeavy')}`}>
                    <Input type="number" min={1} className="w-[72px]" value={v.caps[a].maxTasks} onChange={(e) => cap(a, 'maxTasks', e.target.value)} onBlur={keepCaps} aria-label={`${AGENT[a] ?? a}, ${t('settings.colTasks')}`} />
                    <Input type="number" min={0} className="w-[72px]" value={v.caps[a].maxHeavy} onChange={(e) => cap(a, 'maxHeavy', e.target.value)} onBlur={keepCaps} aria-label={`${AGENT[a] ?? a}, ${t('settings.colHeavy')}`} />
                  </Setting>
                ))}
              </Panel>
            </Block>
            {/* the guide of models: the mock-up does not draw it, so it lives here with the other settings it does not draw */}
            <Panel className="mt-0"><Stack><ModelGuide auto={c.budget?.autoModel !== false} /></Stack></Panel>
      </MoreOptions>
    </>
  );
}

// The three buttons of «Ahorro o potencia» are levels 0, 2 and 4; 1 and 3 are reached with the exact-level slider of the advanced options.
const SPEND_LEVEL = { low: 0, recommended: 2, high: 4 };
const SPEND_BUTTON = { 0: 'low', 2: 'recommended', 4: 'high' };
// The five levels of the «ahorro ↔ uso» slider: the limits each one sets (2 = the usual ones, recommended).
const SPEND_PRESETS = [
  { maxParallel: 1, perAgent: 1, timeoutMinutes: 30, stopAt: 0.75, maxTasks: 8, maxHeavy: 1, high: true, maxPerTask: 1, trusted: false, review: false },
  { maxParallel: 2, perAgent: 1, timeoutMinutes: 45, stopAt: 0.85, maxTasks: 12, maxHeavy: 3, high: true, maxPerTask: 2, trusted: true, review: false },
  { maxParallel: 3, perAgent: 1, timeoutMinutes: 60, stopAt: 0.92, maxTasks: 20, maxHeavy: 6, high: true, maxPerTask: 4, trusted: true, review: false },
  { maxParallel: 4, perAgent: 2, timeoutMinutes: 90, stopAt: 0.96, maxTasks: 30, maxHeavy: 10, high: false, maxPerTask: 6, trusted: true, review: true },
  { maxParallel: 6, perAgent: 2, timeoutMinutes: 120, stopAt: 0.99, maxTasks: 50, maxHeavy: 20, high: false, maxPerTask: 10, trusted: true, review: true }
];

// the test request, always here (in the chat it shows only on the first opening of the day).
export function TestCard() {
  const t = useT();
  return (
    <Block title={t('test.title')} note={t('test.desc')}>
      <Panel>
        <Setting label={t('test.title')} hint={t('test.hint')}>
          <Button size="sm" variant="outline" onClick={() => { closeSettings(); runTest(t('test.prompt')); }} data-testid="settings-test"><FlaskConical />{t('test.button')}</Button>
        </Setting>
      </Panel>
    </Block>
  );
}

export function FolderCard({ c, home }) {
  const t = useT();
  const [roots, setRoots] = useState((c.projectRoots ?? []).join('\n'));
  // One path per line, saved when the field is left and only if the list changed.
  const keepRoots = () => { const list = roots.split(/\r?\n/).map((x) => x.trim()).filter(Boolean); if (JSON.stringify(list) !== JSON.stringify(c.projectRoots ?? [])) save({ projectRoots: list }); };
  return (
    <Block title={t('settings.folder')} note={t('settings.folderDesc')}>
      <Panel>
        <Setting label={<span className="break-all">{home}</span>} hint={<Badge variant="success">{t('settings.folderCurrent')}</Badge>}>
          <Button size="sm" variant="outline" onClick={() => act(bridge.openPath(home))}><FolderOpen />{t('settings.open')}</Button>
          <Button size="sm" variant="outline" onClick={async () => { const f = await bridge.pickFolder(t('settings.pickOtherHome')); if (f && await confirm(t('settings.switchTitle'), t('settings.switchBody', { path: f }), { ok: t('settings.switchOk'), danger: true })) act(bridge.switchHome(f)); }}>{t('settings.useOther')}</Button>
        </Setting>
        <Fld label={t('settings.roots')} hint={t('settings.rootsHint')}><Textarea className="h-[72px] resize-y" rows={3} value={roots} onChange={(e) => setRoots(e.target.value)} onBlur={keepRoots} data-testid="project-roots" /></Fld>
      </Panel>
    </Block>
  );
}

// «Cosas que nadie toca» (config.protected, src/domain/security/guard.mjs › protectedHit): names, paths or containers no agent
// touches. Chips to remove, a field to add; saved at once. Taking off one of the defaults (a password manager) asks
// first, and «Restaurar los de serie» brings back the ones missing (adding needs no password).
export function ProtectedCard({ c }) {
  const t = useT();
  const [draft, setDraft] = useState('');
  const list = Array.isArray(c.protected) ? c.protected : [];
  const store = async (items) => {
    const seen = new Set();
    const clean = items.map((x) => String(x ?? '').trim()).filter((x) => x.length >= 2 && !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase()));
    // the list is a rail value: save() asks for the master password (every time) when it would change.
    return save({ protected: clean.slice(0, 50) }, t('settings.protectedSaved'));
  };
  const add = async () => { if (draft.trim().length >= 2 && await store([...list, draft])) setDraft(''); };
  const isDefault = (x) => DEFAULT_PROTECTED.some((d) => d.toLowerCase() === x.toLowerCase());
  const remove = async (x) => {
    if (isDefault(x) && !await confirm(t('settings.protectedRemoveTitle', { name: x }), t('settings.protectedRemoveBody'), { ok: t('settings.remove'), danger: true })) return;
    await store(list.filter((y) => y !== x));
  };
  const missing = DEFAULT_PROTECTED.filter((d) => !list.some((x) => x.toLowerCase() === d.toLowerCase()));
  return (
    <Block title={t('settings.protected')} count={list.length} note={t('settings.protectedHint')} data-testid="protected-card">
      <Panel>
        {list.length ? (
          <div className="flex flex-wrap gap-1.5 px-3.5 py-3">
            {list.map((x) => (
              <code key={x} className="border-border inline-flex items-center gap-1 rounded-full border py-[3px] pr-1 pl-2.5 font-mono text-caption" data-testid="protected-item">
                {x}
                <button type="button" className="hover:bg-accent hover:text-destructive grid size-(--ctl-sm) cursor-pointer place-items-center rounded-ctl" aria-label={t('settings.protectedRemove', { name: x })} onClick={() => remove(x)} data-testid="protected-remove"><X className="size-3.5" /></button>
              </code>
            ))}
          </div>
        ) : <Stack><Hint>{t('settings.protectedEmpty')}</Hint></Stack>}
        <form className="contents" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <Setting label={t('settings.protectedAddTitle')} hint={t('settings.protectedPh')} className="border-t">
            <Input className="w-[220px]" value={draft} maxLength={200} onChange={(e) => setDraft(e.target.value)} placeholder={t('settings.protectedInputPh')} aria-label={t('settings.protectedInputPh')} data-testid="protected-input" />
            <Button type="submit" size="sm" variant="outline" disabled={draft.trim().length < 2 || list.length >= 50}><Plus />{t('settings.protectedAdd')}</Button>
          </Setting>
        </form>
        <Setting label={t('settings.protectedDefaults')} hint={t('settings.protectedDefaultsHint')}>
          <Button size="sm" variant="outline" disabled={!missing.length} onClick={() => store([...list, ...missing])} data-testid="protected-defaults"><RotateCcw />{t('settings.protectedDefaults')}</Button>
        </Setting>
      </Panel>
    </Block>
  );
}

// The terminal that Ctrl J opens (src/engine/host/terminal.mjs), and «Abrir terminal» now.
export function TerminalCard({ c }) {
  const t = useT();
  // on Linux, its usual terminals (src/engine/host/terminal.mjs LINUX_TERMINALS) instead of Windows' ones.
  const linux = window.orb?.platform === 'linux';
  const terminals = linux ? { auto: t('settings.term.auto'), warp: 'Warp', 'x-terminal-emulator': t('settings.term.system'), 'gnome-terminal': 'GNOME Terminal', konsole: 'Konsole', 'xfce4-terminal': 'Xfce Terminal', kitty: 'kitty', alacritty: 'Alacritty', xterm: 'XTerm' }
    : window.orb?.platform && window.orb.platform !== 'win32' ? { auto: t('settings.term.auto'), warp: 'Warp' }
      : { auto: t('settings.term.auto'), warp: 'Warp', wt: 'Windows Terminal', powershell: 'PowerShell', cmd: t('settings.term.cmd') };
  if (!bridge.zoom) return null; // phone: there is no terminal to open
  return (
    <Block title={t('settings.terminalTitle')} note={t('settings.terminalNote')} data-testid="terminal-card">
      <Panel>
        <Setting label={t('settings.terminal')} hint={t('settings.terminalHint')}>
          <Select caret="solid" className="min-w-0" value={c.ui?.terminal ?? 'auto'} onValueChange={(terminal) => save({ ui: { terminal } })} title={t('settings.terminal')} options={Object.entries(terminals).map(([value, label]) => ({ value, label }))} />
          <Button size="sm" variant="outline" onClick={() => openTerminal()}><SquareTerminal />{t('settings.openTerminal')}</Button>
          <span className="text-faint-foreground text-control">Ctrl J</span>
        </Setting>
      </Panel>
    </Block>
  );
}

// The speech-to-text engine of the microphone button. Windows is the default; Handy and Whisper are offered when found
// on this PC (read-only search in the engine, nothing is downloaded). A chosen engine that is missing falls back to
// Windows (composer.jsx), and the card says so.
export function DictationCard({ c }) {
  const t = useT();
  const [found, setFound] = useState(null);
  const look = () => { setFound(null); Promise.resolve(bridge.dictationEngines?.()).then((r) => setFound(r ?? {})).catch(() => setFound({})); };
  useEffect(look, []);
  if (!bridge.dictateWindows) return null; // only Orb for Windows dictates with an engine of this PC
  const choice = dictationChoice(c);
  const name = (id) => t(`settings.dictation.${id}`);
  const have = (id) => id === 'windows' || Boolean(found?.[id]?.found);
  const plan = found ? resolveDictation(choice, { handy: have('handy'), whisper: have('whisper') }) : null;
  const status = !found ? t('settings.dictationChecking')
    : plan?.reason === 'missing' ? t('settings.dictationMissingChosen', { engine: name(choice) }) : null;
  const w = found?.whisper;
  return (
    <Block title={t('settings.dictationTitle')} note={t('settings.dictationNote')} data-testid="dictation-card">
      <Panel>
        <Setting label={t('settings.dictationEngine')} hint={t('settings.dictationEngineHint')}>
          <Select caret="solid" className="min-w-0" value={choice} onValueChange={(dictation) => save({ ui: { dictation } })} title={t('settings.dictationEngine')}
            options={DICTATION_ENGINES.map((id) => ({ value: id, label: found && id !== 'windows' && have(id) ? `${name(id)} · ${t('settings.dictationFound')}` : name(id) }))} />
          <Button size="sm" variant="outline" onClick={look} data-testid="dictation-recheck">{t('settings.dictationRecheck')}</Button>
        </Setting>
        {status ? <Stack><Hint data-testid="dictation-status">{status}</Hint></Stack> : null}
        {found ? <Stack>
          {DICTATION_ENGINES.filter((id) => id !== 'windows' && !have(id)).map((id) => <Hint key={id}>{t('settings.dictationMissing', { engine: name(id) })}</Hint>)}
          {found.handy?.found || w?.found ? <details>
            <summary className="text-faint-foreground text-caption cursor-pointer">{t('settings.dictationDetails')}</summary>
            <div className="text-faint-foreground text-caption mt-1 flex flex-col gap-0.5 break-all">
              {found.handy?.found ? <span>Handy · {t('settings.dictationFile', { file: found.handy.file })}</span> : null}
              {w?.found ? <span>Whisper · {t('settings.dictationFile', { file: w.file })}</span> : null}
              {w?.version ? <span>{t('settings.dictationVersion', { version: w.version })}</span> : null}
              {w?.found ? <span>{w.model ? t('settings.dictationModelFound') : t('settings.dictationModelMissing')}</span> : null}
            </div>
          </details> : null}
        </Stack> : null}
      </Panel>
    </Block>
  );
}

// How «Hacer commit…» writes its message (src/engine/commit-message.mjs): the style the person picks; never an AI signature.
// The style saves when it changes; the own instructions when the field is left.
export function GitCard({ c }) {
  const t = useT();
  const cfg = c.git ?? {};
  const style = cfg.commitStyle ?? 'conventional';
  const [text, setText] = useState(cfg.commitInstructions ?? '');
  const options = ['conventional', 'repo', 'custom'].map((v) => ({ value: v, label: t(`agents.commit.${v}`) }));
  const keepText = () => { if (text !== (cfg.commitInstructions ?? '')) save({ git: { commitInstructions: text } }); };
  return (
    <Block title={t('settings.gitTitle')} note={t('settings.gitNote')} data-testid="commit-style">
      <Panel>
        <Setting label={t('agents.commit.title')} hint={t('settings.commitHint')}>
          <Select caret="solid" value={style} onValueChange={(commitStyle) => save({ git: { commitStyle } })} options={options} title={t('agents.commit.title')} data-testid="commit-style-select" />
        </Setting>
        {style === 'custom' ? (
          <Fld label={t('agents.commit.instructions')} hint={t('settings.commitInstructionsHint')}>
            <Textarea value={text} onChange={(e) => setText(e.target.value)} onBlur={keepText} rows={3} maxLength={2000} placeholder={t('agents.commit.ph')} data-testid="commit-instructions" />
          </Fld>
        ) : null}
      </Panel>
    </Block>
  );
}

// Expert mode: an IDE-like view (PC only) with the panels the user picks.
export function ExpertCard({ c }) {
  const t = useT();
  const on = c.expert?.enabled === true; const panels = c.expert?.panels ?? {};
  return (
    <Block title={t('settings.expert')} note={t('settings.expertDesc')}>
      <Panel>
        <Row label={t('settings.expertOn')} hint={t('settings.expertOnHint')}><Switch checked={on} onCheckedChange={(enabled) => save({ expert: { enabled } }, enabled ? t('settings.expertEnabled') : t('settings.expertDisabled'))} data-testid="expert-switch" /></Row>
        <Setting label={t('settings.expertOpen')} hint={t('settings.expertOpenHint')}><Button size="sm" variant="outline" disabled={!on} onClick={() => go('expert')}><SquareTerminal />{t('settings.expertOpen')}</Button></Setting>
        {/* which panels it shows (Orb's own choice) */}
        <Stack className="border-border border-t" data-testid="expert-panels">
          <span className="text-control font-medium">{t('settings.expertPanels')}</span>
          <div className="grid gap-2 sm:grid-cols-2">
            {Object.entries(PANELS).map(([id, label]) => <label key={id} className={cn('-mx-1 flex items-center gap-2 rounded-md px-1 py-1 text-control', on ? 'hover:bg-accent/40 cursor-pointer' : 'text-muted-foreground cursor-not-allowed')}><Checkbox disabled={!on} checked={panelOn(panels, id)} onCheckedChange={(v) => savePanels({ ...panels, [id]: v === true })} />{label}</label>)}
          </div>
        </Stack>
      </Panel>
    </Block>
  );
}

// the background music (Windows; lib/music.js): the adaptive music, made by Orb on the spot: its theme, whether it follows
// what happens in Orb (or keeps one intensity) and the volume. Each change is heard at once when the music is playing;
// the sliders are heard while they are dragged and saved when let go.
function MusicSettings() {
  const t = useT();
  useStore((s) => s.app?.config?.ui?.music); // drawn again when a choice is saved
  const prefs = musicPrefs();
  const playing = useSyncExternalStore(onMusic, () => { const s = musicState(); return Boolean(s.playing || s.loading); });
  const [v, setV] = useState(prefs.volume);
  const keepVolume = () => setMusicVolume(v, { save: true });
  return (
    <div className="contents" data-testid="music-settings">
      <Row label={t('appearance.music')} hint={t('appearance.musicHint')}><Switch checked={playing} onCheckedChange={() => toggleMusic()} aria-label={t('appearance.music')} data-testid="music-on" /></Row>
      {/* the mock-up's rows first (on, volume); what it does not draw, after them */}
      <Setting label={t('appearance.musicVolume')} hint={t('appearance.musicVolumeHint')}>
        <Range min={0} max={1} step={0.05} value={v} aria-label={t('appearance.musicVolume')} className="w-[120px]! cursor-pointer" data-testid="music-volume"
          onChange={(e) => { const n = Number(e.target.value); setV(n); setMusicVolume(n); }} onPointerUp={keepVolume} onKeyUp={keepVolume} />
      </Setting>
    </div>
  );
}

// Why Orb never runs the hooks of a project (.claude/settings.json, .cursor/hooks.json): it is not a setting, only the explanation.
export function ProjectScriptsCard() {
  const t = useT();
  return (
    <Block title={t('settings.scripts.title')} note={t('settings.scripts.note')} data-testid="project-scripts">
      <Panel>
        <Setting label={t('settings.scripts.hooks')} hint={t('settings.scripts.hooksHint')}>
          <Button size="sm" variant="outline" onClick={() => confirm(t('settings.scripts.hooks'), t('settings.scripts.whyBody'), { ok: t('comp.dialogs.ok'), cancel: null, tone: 'primary' })} data-testid="project-scripts-why">{t('settings.scripts.why')}</Button>
        </Setting>
      </Panel>
    </Block>
  );
}

// Agents: which CLIs are installed, their login, models and how much of each subscription window is used.
import { useEffect, useState } from 'react';
import { Bot, RefreshCw, LogIn, ChevronRight, ChevronDown, ExternalLink, UserPlus, Trash2, FolderOpen, ScanSearch } from 'lucide-react';
import { toast } from 'sonner';
import { useCatalog } from '@/components/brain-picker.jsx';
import { confirm, form } from '@/components/dialogs.jsx';
import { Installer } from '@/components/installer.jsx';
import { PageHeader } from '@/components/page.jsx';
import { AgentIcon } from '@/components/agent-icon.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Badge, Card, CardContent, CardHeader, CardTitle, CardDescription, Field, Input, Spinner } from '@/components/ui/basic.jsx';
import { Switch, Collapsible, CollapsibleTrigger, CollapsibleContent, BubbleTip, Checkbox, Select, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem } from '@/components/ui/overlay.jsx';
import { cn, baseName } from '@/lib/utils.js';
import { useStore, call, act, bridge, setState, getState } from '@/lib/store.js';
import { LOGIN } from '@/lib/labels.js';
import { t, useT, useLocale } from '@/lib/i18n.js';

const INSTALL = { claude: 'https://docs.claude.com/en/docs/claude-code/setup', codex: 'https://developers.openai.com/codex/cli', cursor: 'https://cursor.com/cli',
  gemini: 'https://github.com/google-gemini/gemini-cli', opencode: 'https://opencode.ai', qwen: 'https://github.com/QwenLM/qwen-code', copilot: 'https://github.com/github/copilot-cli' };
const WINDOW = { five_hour: 'agents.win.fiveHour', seven_day: 'agents.win.week', seven_day_opus: 'agents.win.weekOpus', seven_day_sonnet: 'agents.win.weekSonnet', '300min': 'agents.win.fiveHour', '10080min': 'agents.win.week', '43200min': 'agents.win.month' };
const windowLabel = (w) => (WINDOW[w] ? t(WINDOW[w]) : w);
// How each agent is connected (2.3: all of them live).
const KIND = { sdk: 'agents.kind.sdk', 'app-server': 'agents.kind.appServer', 'cli-stream': 'agents.kind.cliStream', acp: 'agents.kind.acp' };

async function save(agent, patch) {
  const config = await act(call('config.save', { patch: { agents: { [agent]: patch } } }), t('agents.saved'));
  if (config) setState({ app: { ...getState().app, config } });
  return config;
}

// The subscriptions of one agent: each with its own login folder, so two Codex or three Claude accounts never mix.
function Accounts({ a, reload }) {
  const t = useT();
  const locale = useLocale();
  // 2.7: only a name. Orb makes the account's folder and opens the agent's sign-in at once (in the browser), so the other
  // subscription is used without closing this one. An existing folder, only under «Opciones avanzadas», never typed.
  const add = async () => {
    const r = await form(t('agents.addAccountTitle', { label: a.label }), {
      description: t('agents.addAccountDesc'),
      initial: { label: `${a.label} ${a.accounts.length + 1}`, home: '', advanced: false },
      body: (v, set) => (<>
        <Field label={t('agents.accountName')}><Input autoFocus value={v.label} onChange={(e) => set({ label: e.target.value })} maxLength={60} placeholder={t('agents.accountNamePh', { label: a.label })} /></Field>
        <Collapsible open={v.advanced} onOpenChange={(advanced) => set({ advanced })}>
          <CollapsibleTrigger className="text-muted-foreground hover:text-foreground group flex cursor-pointer items-center gap-1 text-xs"><ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />{t('agents.advanced')}</CollapsibleTrigger>
          <CollapsibleContent className="mt-3">
            <Field label={t('agents.sessionFolder')} hint={v.home ? t('agents.folderHintCustom') : t('agents.folderHintEmpty')}>
              <div className="flex min-w-0 items-center gap-2 rounded-lg border px-3 py-1.5">
                <span className="text-muted-foreground min-w-0 flex-1 truncate text-[13px]">{v.home ? baseName(v.home) : t('agents.folderPlaceholder')}</span>
                {v.home ? <Button type="button" size="xs" variant="ghost" onClick={() => set({ home: '' })}>{t('agents.folderNew')}</Button> : null}
                <Button type="button" size="xs" variant="outline" onClick={async () => { const f = await bridge.pickFolder(t('agents.pickFolder')); if (f) set({ home: f }); }}><FolderOpen />{t('agents.pickProgram')}</Button>
              </div>
            </Field>
          </CollapsibleContent>
        </Collapsible>
      </>),
      ok: t('agents.addAndLogin'), onOk: (v) => call('accounts.add', { agent: a.id, label: v.label.trim() || `${a.label} ${a.accounts.length + 1}`, home: v.home.trim() })
    });
    if (!r) return;
    reload();
    // A new folder has no login yet: the sign-in opens straight away.
    if (/[\\/]cuentas[\\/][^\\/]+$/.test(r.home ?? '') && r.home.endsWith(r.id)) act(call('agents.login', { account: r.id }), t('agents.followSteps'));
  };
  // 2.7: «Buscar y añadir»: saved logins of this agent elsewhere on the PC become accounts (Orb only checks that the
  // login file is there; it never opens it). One found: added at once. Several: ticked in a list. None: a new account.
  const scan = async () => {
    const found = await act(call('accounts.scan', { agent: a.id }));
    if (!found) return;
    if (!found.length) {
      if (await confirm(t('agents.scanNone', { label: a.label }), t('agents.scanNoneBody', { label: a.label }), { ok: t('agents.addAnother') })) add();
      return;
    }
    // Named after its plan when Codex says it (Codex Pro, Codex Go…), otherwise numbered.
    const addAll = async (list) => {
      let n = a.accounts.length;
      for (const f of list) await call('accounts.add', { agent: a.id, label: `${a.label} ${planName(f.plan) ?? ++n}`, home: f.dir });
      return list.length;
    };
    if (found.length === 1) {
      const n = await act(addAll(found), t('agents.scanAddedOne', { label: a.label }));
      if (n) reload();
      return;
    }
    const when = (iso) => new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
    const r = await form(t('agents.scanFoundTitle', { n: found.length, label: a.label }), {
      description: t('agents.scanFoundDesc'),
      initial: { picked: found.map((f) => f.dir) },
      body: (v, set) => (
        <div className="grid gap-1.5">
          {found.map((f) => (
            <label key={f.dir} className="hover:bg-accent/40 flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2">
              <Checkbox checked={v.picked.includes(f.dir)} onCheckedChange={(on) => set({ picked: on ? [...v.picked, f.dir] : v.picked.filter((d) => d !== f.dir) })} />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{f.name}</span>
              {planName(f.plan) ? <Badge variant="secondary" className="font-normal">{planName(f.plan)}</Badge> : null}
              <span className="text-muted-foreground shrink-0 text-xs">{t('agents.scanSavedAt', { when: when(f.savedAt) })}</span>
            </label>
          ))}
        </div>
      ),
      ok: t('agents.add'), onOk: (v) => addAll(found.filter((f) => v.picked.includes(f.dir)))
    });
    if (r) { toast.success(t('agents.scanAddedMany', { n: r })); reload(); }
  };
  if (!a.installed) return null;
  return (
    <div className="grid gap-1.5">
      <div className="text-muted-foreground text-xs">{t('agents.accounts')}</div>
      {a.accounts.map((acc) => {
        const login = LOGIN[acc.login] ?? LOGIN.desconocido;
        return (
          // One line: the name with its state, what can be done with it and its switch (2.7: no folder path).
          <div key={acc.id} className={cn('rounded-lg border px-3 py-2', acc.enabled === false && 'opacity-60')}>
            <div className="flex items-center gap-1.5">
              <div className="min-w-0 flex-1 truncate text-[13px] font-medium">{acc.label}</div>
              <Badge variant={login[1]}>{login[0]}</Badge>
              <BubbleTip title={t('agents.login')}><Button size="icon-xs" variant="ghost" aria-label={t('agents.login')} onClick={() => act(call('agents.login', { account: acc.id }), t('agents.followSteps'))}><LogIn /></Button></BubbleTip>
              {acc.id !== acc.agent ? <BubbleTip title={t('agents.removeTitle')} text={t('agents.removeTip')}><Button size="icon-xs" variant="danger" aria-label={t('agents.removeTitle')} onClick={async () => { if (await confirm(t('agents.removeTitle'), t('agents.removeBody', { label: acc.label }), { ok: t('agents.remove'), danger: true })) act(call('accounts.remove', { id: acc.id }), t('agents.accountRemoved')).then(reload); }}><Trash2 /></Button></BubbleTip> : null}
              {/* The bubble wraps a span: on the switch itself, the bubble's data-state hid «checked» and it looked off. */}
              <BubbleTip title={t('agents.useAccount')}><span className="inline-flex shrink-0"><Switch checked={acc.enabled !== false} onCheckedChange={(enabled) => act(call('accounts.update', { id: acc.id, enabled })).then(reload)} aria-label={t('agents.useAccount')} /></span></BubbleTip>
            </div>
          </div>
        );
      })}
      {a.multi ? <div className="flex flex-wrap gap-1"><Button size="sm" variant="ghost" className="w-fit" onClick={add}><UserPlus />{t('agents.addAnother')}</Button><BubbleTip title={t('agents.scan')} text={t('agents.scanTip', { label: a.label })}><Button size="sm" variant="ghost" className="w-fit" onClick={scan} data-testid={`agent-scan-${a.id}`}><ScanSearch />{t('agents.scan')}</Button></BubbleTip></div> :<p className="text-muted-foreground text-[11px] leading-snug">{t('agents.fixedSession', { label: a.label })}</p>}
    </div>
  );
}

// 2.7: what an agent is good at, picked from a list (the assistant reads it to share out the work). It is saved as the
// labels in words, as before; a saved text is read back by the words in it, in Spanish or English.
const AGENT_DEFAULT = '__agent';
// The plan names Codex reports (account/read), as its plans are called.
const PLANS = { free: 'Free', go: 'Go', plus: 'Plus', pro: 'Pro', prolite: 'Pro', team: 'Team', business: 'Business', enterprise: 'Enterprise', edu: 'Edu' };
const planName = (plan) => (plan ? PLANS[String(plan).toLowerCase()] ?? null : null);
const dirOf = (file) => String(file).replace(/[\\/][^\\/]*$/, '');
const STRENGTHS = {
  architecture: ['arquitectura', 'architecture'], review: ['revisión de código', 'revisar', 'review'], docs: ['documentación', 'documentar', 'documentation'],
  writing: ['redacción', 'writing'], design: ['diseño', 'design'], implementation: ['implementación', 'implementation'], backend: ['backend'],
  frontend: ['frontend', 'interfaz', 'interface'], refactors: ['refactor'], tests: ['tests', 'pruebas'], scripts: ['scripts'],
  debugging: ['depurar', 'depuración', 'debug'], quick: ['cambios rápidos', 'quick'], large: ['proyectos grandes', 'contexto enorme', 'large'],
  research: ['investigar', 'investigación', 'research'], repetitive: ['repetitivas', 'repetitive'], cheap: ['barata', 'bajo coste', 'low cost'],
  github: ['github'], providers: ['proveedores', 'providers']
};
const strengthsIn = (text) => { const s = String(text ?? '').toLowerCase(); return Object.keys(STRENGTHS).filter((id) => STRENGTHS[id].some((w) => s.includes(w))); };

function StrengthsPicker({ value, onChange, testid }) {
  const t = useT();
  const [picked, setPicked] = useState(() => strengthsIn(value));
  useEffect(() => setPicked(strengthsIn(value)), [value]);
  const label = (id) => t(`agents.str.${id}`);
  // Saved when the list closes, so ticking several makes one change.
  const close = (open) => { if (open) return; const next = Object.keys(STRENGTHS).filter((id) => picked.includes(id)); if (next.join() !== strengthsIn(value).join()) onChange(next.map(label).join(', ')); };
  return (
    <DropdownMenu onOpenChange={close}>
      <DropdownMenuTrigger asChild>
        <button type="button" className="border-input hover:bg-accent/40 flex min-h-9 w-full cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-left text-[13px]" data-testid={testid}>
          <span className="flex min-w-0 flex-1 flex-wrap gap-1">
            {picked.length ? picked.map((id) => <Badge key={id} variant="secondary" className="font-normal">{label(id)}</Badge>) : <span className="text-muted-foreground">{t('agents.strengthsPick')}</span>}
          </span>
          <ChevronDown className="text-muted-foreground size-4 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto">
        {Object.keys(STRENGTHS).map((id) => <DropdownMenuCheckboxItem key={id} checked={picked.includes(id)} onCheckedChange={(on) => setPicked((p) => (on ? [...p, id] : p.filter((x) => x !== id)))}>{label(id)}</DropdownMenuCheckboxItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// One agent. In the wide grid the card is a subgrid of five rows (title, state, actions, accounts, settings), so
// every section sits at the same height in the three cards of a row.
function AgentCard({ a, reload }) {
  const t = useT();
  const cfg = useStore((s) => s.app.config.agents[a.id]);
  // The models the agent itself says it has (the catalog), its own default first, and the saved one even if not listed.
  const catalog = useCatalog();
  const listed = catalog?.find((x) => x.id === a.id)?.models.filter((m) => m.id) ?? [];
  const modelOptions = [{ value: AGENT_DEFAULT, label: t('agents.defaultOfAgent') }, ...listed.map((m) => ({ value: m.id, label: m.label }))];
  // A saved alias (sonnet, opus…) shows as the model it stands for (Sonnet 5.5), not as a second entry.
  const alias = /^(sonnet|opus|haiku)$/.test(cfg.defaultModel ?? '') ? listed.find((m) => m.id.includes(cfg.defaultModel))?.id : null;
  const defaultValue = alias ?? (cfg.defaultModel || AGENT_DEFAULT);
  if (cfg.defaultModel && !alias && !modelOptions.some((o) => o.value === cfg.defaultModel)) modelOptions.push({ value: cfg.defaultModel, label: /^[a-z]+$/.test(cfg.defaultModel) ? cfg.defaultModel[0].toUpperCase() + cfg.defaultModel.slice(1) : cfg.defaultModel });
  const login = LOGIN[a.login] ?? LOGIN.desconocido;
  return (
    <Card className="lg:row-span-5 lg:grid lg:grid-rows-[subgrid]" data-testid={`agent-card-${a.id}`}>
      <CardHeader className="flex-row items-start gap-3">
        <AgentIcon agent={a.id} className="mt-0.5 size-6 shrink-0" />
        <div className="min-w-0 flex-1"><CardTitle className="truncate">{a.label}</CardTitle><CardDescription className="truncate">{a.installed ? a.version ?? t('agents.installed') : t('agents.notFoundHere')}</CardDescription></div>
        <Switch checked={cfg.enabled} onCheckedChange={(enabled) => save(a.id, { enabled })} aria-label={t('agents.enabled')} />
      </CardHeader>
      <CardContent className="flex flex-wrap gap-1.5">
        {a.installed ? <Badge variant="success">{t('agents.installed')}</Badge> : <Badge variant="destructive">{t('agents.notFound')}</Badge>}
        {a.installed ? <Badge variant={login[1]}>{login[0]}</Badge> : null}
        {!cfg.enabled ? <Badge variant="secondary">{t('agents.disabled')}</Badge> : null}
        {a.installed && KIND[a.kind] ? <Badge variant="outline" className="text-muted-foreground font-normal">{t(KIND[a.kind])}</Badge> : null}
      </CardContent>
      <CardContent className="flex flex-wrap gap-2">
        {!a.installed ? <Button size="sm" variant="outline" onClick={() => bridge.openExternal(INSTALL[a.id])}><ExternalLink />{t('agents.howInstall')}</Button> : null}
        {/* 2.7: the paths are not shown (they say too much on a shared screen): a button opens the program's folder. */}
        {a.where ? <Button size="sm" variant="ghost" onClick={() => act(bridge.openPath(dirOf(a.where)))} data-testid={`agent-open-${a.id}`}><FolderOpen />{t('agents.openFolder')}</Button> : null}
        <Button size="sm" variant="ghost" onClick={() => act(call('agents.check', { agent: a.id })).then(reload)}><RefreshCw />{t('agents.check')}</Button>
      </CardContent>
      <CardContent><Accounts a={a} reload={reload} /></CardContent>
      <CardContent>
        <Collapsible>
          <CollapsibleTrigger className="text-muted-foreground hover:text-foreground group flex cursor-pointer items-center gap-1 text-xs"><ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />{t('agents.modelsSettings')}</CollapsibleTrigger>
          {/* 2.7: everything is chosen, nothing typed: the agent's real models, its strengths from a list and its program
              in Windows' own dialog. Each change is saved at once. */}
          <CollapsibleContent className="mt-3 grid gap-3">
            <Field label={t('agents.defaultModel')} hint={t('agents.defaultModelHint')}>
              <Select className="w-full" value={defaultValue} options={modelOptions} disabled={modelOptions.length < 2} onValueChange={(m) => save(a.id, { defaultModel: m === AGENT_DEFAULT ? '' : m })} data-testid={`agent-default-model-${a.id}`} />
            </Field>
            <Field label={t('agents.strengths')} hint={t('agents.strengthsHint')}><StrengthsPicker value={cfg.strengths ?? ''} onChange={(strengths) => save(a.id, { strengths })} testid={`agent-strengths-${a.id}`} /></Field>
            <Field label={t('agents.path')} hint={t('agents.pathHint')}>
              <div className="flex min-w-0 items-center gap-2 rounded-lg border px-3 py-1.5">
                <span className="text-muted-foreground min-w-0 flex-1 truncate text-[13px]">{cfg.path ? t('agents.pathCustom') : t('agents.pathAuto')}</span>
                {cfg.path ? <Button size="xs" variant="ghost" onClick={() => save(a.id, { path: '' }).then(reload)}>{t('agents.auto')}</Button> : null}
                <Button size="xs" variant="outline" onClick={async () => { const f = await bridge.pickProgram?.(t('sys.dialog.pickProgram')); if (f) save(a.id, { path: f }).then(reload); }} data-testid={`agent-path-${a.id}`}><FolderOpen />{t('agents.pickProgram')}</Button>
              </div>
            </Field>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

export function AgentsView() {
  const t = useT();
  const locale = useLocale();
  const version = useStore((s) => s.version);
  const [agents, setAgents] = useState(null);
  const [usage, setUsage] = useState([]);
  const [system, setSystem] = useState(null);
  useEffect(() => { call('system.check').then(setSystem).catch(() => {}); }, []);
  const load = (refresh = false) => { call('agents.status', { refresh }).then(setAgents).catch(() => setAgents([])); };
  useEffect(() => load(), []);
  useEffect(() => { call('usage.get').then(setUsage).catch(() => {}); }, [version]);
  return (
    <>
      <PageHeader icon={<Bot className="text-primary size-5" />} title={t('agents.title')} meta={t('agents.meta')}>
        <Button size="sm" variant="outline" onClick={() => { setAgents(null); load(true); }}><RefreshCw />{t('agents.checkAll')}</Button>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-5 py-5">
        <div className="grid gap-4">
          {system?.platform === 'win32' ? (
            <Card>
              <CardHeader><CardTitle>{t('agents.installTitle')}</CardTitle><CardDescription>{t('agents.installDesc')}</CardDescription></CardHeader>
              <CardContent><Installer onChange={() => load()} /></CardContent>
            </Card>
          ) : null}
          {system && !system.git ? (
            <Card className="border-warning/50 flex-row items-center gap-3 px-5 py-3.5">
              <div className="min-w-0 flex-1"><div className="text-[14px] font-medium">{t('agents.noGit')}</div><div className="text-muted-foreground text-xs">{t('agents.noGitDesc')}</div></div>
              <Button size="sm" variant="outline" onClick={() => bridge.openExternal('https://git-scm.com/download/win')}><ExternalLink />{t('agents.getGit')}</Button>
            </Card>
          ) : null}
          {/* Two cards per row from 1024 px, three on very wide windows: each card needs room for its account rows. */}
          <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3 [&>*]:min-w-0">{agents ? agents.map((a) => <AgentCard key={a.id} a={a} reload={() => load(true)} />) : <Card className="items-center"><Spinner /></Card>}</div>
          <Card>
            <CardHeader><CardTitle>{t('agents.usageTitle')}</CardTitle><CardDescription>{t('agents.usageDesc', { pct: Math.round((usage[0]?.stopAt ?? 0.92) * 100), hours: usage[0]?.windowHours ?? 5 })}</CardDescription></CardHeader>
            <CardContent className="grid gap-4">
              {usage.map((u) => (
                <div key={u.account} className="grid gap-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-sm"><AgentIcon agent={u.agent} /><span className="min-w-28">{u.label}</span>
                    {u.real ? <span className="text-xs">{u.real.window ? t('agents.realQuotaWindow', { pct: Math.round(u.real.utilization * 100), window: windowLabel(u.real.window) }) : t('agents.realQuota', { pct: Math.round(u.real.utilization * 100) })}{u.real.resetAt ? ` · ${t('agents.resetsAt', { when: new Date(u.real.resetAt).toLocaleString(locale, { weekday: 'short', hour: '2-digit', minute: '2-digit' }) })}` : ''}</span> : null}
                    <span className="text-muted-foreground text-xs">{t('agents.tasksUsed', { used: u.used, max: u.max, heavy: u.heavy, maxHeavy: u.maxHeavy })}</span>
                    {u.cooldownUntil ? <Badge variant="destructive">{t('agents.cooldown', { time: new Date(u.cooldownUntil).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) })}</Badge> : null}</div>
                  <div className="bg-muted h-1.5 overflow-hidden rounded-full"><div className={cn('h-full rounded-full transition-all', (u.real?.utilization ?? 0) >= 0.85 ? 'bg-warning' : 'bg-primary')} style={{ width: `${Math.min(100, (u.real ? u.real.utilization : u.used / Math.max(1, u.max)) * 100)}%` }} /></div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

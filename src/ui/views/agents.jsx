// Agents: which CLIs are installed, their login, models and how much of each subscription window is used.
// The detail of the usage lives in the «Uso» tab next to this one (views/usage.jsx).
import { useEffect, useState } from 'react';
import { RefreshCw, LogIn, ChevronRight, ChevronDown, ExternalLink, UserPlus, Trash2, FolderOpen, ScanSearch, Copy, Download, SquareTerminal, BookOpen, KeyRound, Search, ListChecks } from 'lucide-react';
import { notifyError, notifyInfo, notifyOk, notifyWarn } from '@/lib/notify.js';
import { useCatalog } from '@/components/brain-picker.jsx';
import { ModelGuide } from '@/components/model-guide.jsx';
import { confirm, form } from '@/components/dialogs.jsx';
import { InstallProgress } from '@/components/installer.jsx';
import { PageHeader, PageBody } from '@/components/page.jsx';
import { AgentsUsageTabs } from '@/components/agents-tabs.jsx';
import { AgentIcon } from '@/components/agent-icon.jsx';
import { Button } from '@/components/ui/button.jsx';
import { IconButton, MoreButton, Note, ListCard, ListRow } from '@/components/ui/primitives.jsx';
import { Badge, Field, Input, Spinner, Textarea } from '@/components/ui/basic.jsx';
import { Switch, Collapsible, CollapsibleTrigger, CollapsibleContent, BubbleTip, Checkbox, Select, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuCheckboxItem, Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/overlay.jsx';
import { cn, baseName } from '@/lib/utils.js';
import { useStore, call, act, bridge, setState, getState } from '@/lib/store.js';
import { LOGIN, OFF_AGENTS } from '@/lib/labels.js';
import { unlockCore } from '@/lib/core-access.js';
import { t, useT, useLocale } from '@/lib/i18n.js';
import { quiet } from '@/lib/quiet.js';
import { Block, Panel, Setting, Stack, CardFoot } from './settings/rows.jsx';

const INSTALL = { claude: 'https://docs.claude.com/en/docs/claude-code/setup', codex: 'https://developers.openai.com/codex/cli', cursor: 'https://cursor.com/cli',
  gemini: 'https://github.com/google-gemini/gemini-cli', opencode: 'https://opencode.ai', qwen: 'https://github.com/QwenLM/qwen-code', copilot: 'https://github.com/github/copilot-cli', hermes: 'https://hermes-agent.nousresearch.com',
  grok: 'https://x.ai/cli', devin: 'https://cli.devin.ai', droid: 'https://factory.ai', omp: 'https://github.com/can1357/oh-my-pi', pi: 'https://pi.dev', antigravity: 'https://antigravity.google' };
// How each agent is connected (all of them live).
const KIND = { sdk: 'agents.kind.sdk', 'app-server': 'agents.kind.appServer', 'cli-stream': 'agents.kind.cliStream', acp: 'agents.kind.acp' };
const NATIVE = ['claude', 'codex', 'cursor'];
// What the installer (src/engine/host/installer.mjs) sets up besides the agents of the first block.
const TEAM_AGENTS = ['gemini', 'copilot', 'opencode', 'qwen', 'hermes'];

async function save(agent, patch) {
  const config = await act(call('config.save', { patch: { agents: { [agent]: patch } } }), t('agents.saved'));
  if (config) setState({ app: { ...getState().app, config } });
  return config;
}

// A time as the clock shows it, with the weekday when it is not today.
const whenOf = (ms, locale) => {
  const d = new Date(ms);
  return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : d.toLocaleString(locale, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
};

// «Solo Orb»: the sign-in of Claude Code and Codex runs hidden: Orb gets the link (and the code, when there is one),
// shows them in a dialog and opens the link in the browser; the dialog follows the 'agents:login' events until it ends.
// Cursor and the other agents still open their own console ({ console: true }).
let showLogin = () => {};
async function signIn(acc, label, extra = {}) {
  const r = await act(call('agents.login', { account: acc.id, ...extra }));
  if (!r) return;
  if (r.console) { notifyInfo(t('agents.followSteps')); return; }
  showLogin({ ...r, label });
  // Claude opens the browser itself on a PC; the others' link is opened here (the main process' shell, https only).
  if (!r.opened && r.url) bridge.openExternal(r.url).catch((e) => notifyError(e));
}

function LoginDialog({ reload, windows }) {
  const t = useT();
  const [login, setLogin] = useState(null);
  const [code, setCode] = useState('');
  useEffect(() => { showLogin = (l) => { setCode(''); setLogin(l); }; return () => { showLogin = () => {}; }; }, []);
  useEffect(() => bridge.on('agents:login', (p) => {
    setLogin((cur) => {
      if (!cur || cur.id !== p.id) return cur;
      if (p.state === 'hecho') { notifyOk(t('agents.loginDone', { label: cur.label })); reload(); return null; }
      if (p.state === 'error') { notifyError(p.message ?? t('agents.loginWaiting')); return null; }
      if (p.state === 'cancelado') return null;
      if (p.message) notifyWarn(p.message);
      return { ...cur, ...p, message: null };
    });
  }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const copy = (text) => navigator.clipboard?.writeText(text).then(() => notifyOk(t('agents.loginCopied'))).catch(() => notifyError(t('app.copyFailed')));
  const send = async () => { if (await act(call('agents.loginCode', { id: login.id, code: code.trim() }))) setCode(''); };
  const cancel = () => { if (login) call('agents.loginCancel', { id: login.id }).catch(quiet); setLogin(null); };
  return (
    <Dialog open={Boolean(login)} onOpenChange={(open) => { if (!open) cancel(); }}>
      {login ? (
        <DialogContent size="sm" data-testid="agent-login-card" aria-describedby={undefined} onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
          <DialogHeader><DialogTitle>{t('agents.loginTitle', { label: login.label })}</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-3">
            <p className="text-control">{login.opened ? t('agents.loginOpened') : t('agents.loginOpen')}</p>
            {login.code ? <p className="text-muted-foreground text-control">{t('agents.loginDevice')}</p> : null}
            {login.code ? (
              <div className="border-border bg-secondary flex items-center justify-between gap-2 rounded-ctl border px-3 py-2.5">
                <code className="font-mono text-body tracking-widest select-all" data-testid="agent-login-code">{login.code}</code>
                <Button size="sm" variant="outline" onClick={() => copy(login.code)}><Copy />{t('agents.loginCopyCode')}</Button>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="outline" onClick={() => act(bridge.openExternal(login.url))} data-testid="agent-login-open"><ExternalLink />{t('agents.loginOpenBrowser')}</Button>
              <Button size="sm" variant="outline" onClick={() => copy(login.url)}><Copy />{t('agents.loginCopy')}</Button>
            </div>
            {login.needsCode ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-faint-foreground text-caption">{t('agents.loginPasteHint')}</span>
                <div className="flex gap-1.5">
                  <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder={t('agents.loginPastePh')} aria-label={t('agents.loginPastePh')} onKeyDown={(e) => { if (e.key === 'Enter' && code.trim()) send(); }} data-testid="agent-login-paste" />
                  <Button size="sm" variant="outline" disabled={!code.trim()} onClick={send}>{t('agents.loginSend')}</Button>
                </div>
              </div>
            ) : null}
            <span className="text-faint-foreground inline-flex items-center gap-1.5 text-caption"><Spinner className="size-3" />{t('agents.loginWaiting')}</span>
          </div>
          <DialogFooter>
            {/* The old way, for a sign-in the hidden one cannot do: the agent's own console (Windows only). */}
            {windows ? <Button size="sm" variant="ghost" className="sm:mr-auto" onClick={() => { cancel(); act(call('agents.login', { account: login.account, console: true }), t('agents.followSteps')); }}><SquareTerminal />{t('agents.loginConsole')}</Button> : null}
            <Button variant="outline" onClick={cancel}>{t('agents.loginCancel')}</Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

// install or update Claude Code and Codex with one button (hidden, for this user only); 'agents:install' events.
const INSTALLABLE = ['claude', 'codex'];
function InstallButton({ a, reload }) {
  const t = useT();
  const [st, setSt] = useState(null);
  useEffect(() => { call('agents.installState', { agent: a.id }).then((s) => { if (s?.state === 'instalando') setSt(s); }).catch(quiet); }, [a.id]);
  useEffect(() => bridge.on('agents:install', (p) => {
    if (p.agent !== a.id) return;
    setSt(p);
    if (p.state === 'hecho') { notifyOk(p.version ? t('agents.installDone', { label: a.label, version: p.version }) : t('agents.installDoneNoVersion', { label: a.label })); reload(); }
    if (p.state === 'error') notifyError(p.message);
  }), [a.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!INSTALLABLE.includes(a.id)) return null;
  const busy = st?.state === 'instalando';
  return (
    <>
      <Button size="sm" disabled={busy} onClick={async () => { const r = await act(call('agents.install', { agent: a.id })); if (r) setSt(r); }} data-testid={`agent-install-${a.id}`}>
        {busy ? <Spinner className="size-3.5" /> : <Download />}{busy ? t('agents.installing') : a.installed ? t('agents.update') : t('agents.install')}
      </Button>
      {busy && st.line ? <span className="text-muted-foreground w-full truncate text-right text-micro">{st.line}</span> : null}
    </>
  );
}

// The subscriptions of one agent: each with its own login folder, so two Codex or three Claude accounts never mix.
// Returns the two ways of adding one; the rows themselves are drawn by the card.
function useAccountActions(a, reload) {
  const t = useT();
  const locale = useLocale();
  // only a name. Orb makes the account's folder and opens the agent's sign-in at once (in the browser), so the other
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
                <span className="text-muted-foreground min-w-0 flex-1 truncate text-control">{v.home ? baseName(v.home) : t('agents.folderPlaceholder')}</span>
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
    if (/[\\/]cuentas[\\/][^\\/]+$/.test(r.home ?? '') && r.home.endsWith(r.id)) signIn(r, r.label);
  };
  // «Buscar y añadir»: saved logins of this agent elsewhere on the PC become accounts (Orb only checks that the
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
    if (found.length === 1 && found[0].checked !== false) { // one that Codex could not check is shown to choose, not added by itself
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
              <span className="min-w-0 flex-1 truncate text-control font-medium">{f.name}</span>
              {planName(f.plan) ? <Badge variant="secondary" className="font-normal">{planName(f.plan)}</Badge> : null}
              <span className="text-muted-foreground shrink-0 text-xs">{t('agents.scanSavedAt', { when: when(f.savedAt) })}</span>
            </label>
          ))}
        </div>
      ),
      ok: t('agents.add'), onOk: (v) => addAll(found.filter((f) => v.picked.includes(f.dir)))
    });
    if (r) { notifyOk(t('agents.scanAddedMany', { n: r })); reload(); }
  };
  return { add, scan };
}

// One account: its name with the plan and the state of its login, and a menu with what can be done with it.
function AccountRow({ acc, plan, reload }) {
  const t = useT();
  const login = LOGIN[acc.login] ?? LOGIN.desconocido;
  return (
    <ListRow className={cn('border-border not-first:border-t', acc.enabled === false && 'opacity-60')} title={acc.label} meta={plan ? <span>{plan}</span> : null}
      trailing={(
        <span className="flex flex-none items-center gap-1.5">
          <Badge variant={acc.login === 'no' ? 'warning' : login[1]}>{login[0]}</Badge>
          <DropdownMenu modal={false}>
            <BubbleTip title={t('nav.more')}><DropdownMenuTrigger asChild><MoreButton small data-testid={`agent-account-more-${acc.id}`} /></DropdownMenuTrigger></BubbleTip>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onSelect={() => signIn(acc, acc.label)} data-testid={`agent-login-${acc.id}`}><LogIn />{t('agents.login')}</DropdownMenuItem>
              <DropdownMenuCheckboxItem checked={acc.enabled !== false} onCheckedChange={(enabled) => act(call('accounts.update', { id: acc.id, enabled })).then(reload)}>{t('agents.useAccount')}</DropdownMenuCheckboxItem>
              {acc.id !== acc.agent ? <DropdownMenuItem variant="destructive" onSelect={async () => { if (await confirm(t('agents.removeTitle'), t('agents.removeBody', { label: acc.label }), { ok: t('agents.remove'), danger: true })) act(call('accounts.remove', { id: acc.id }), t('agents.accountRemoved')).then(reload); }}><Trash2 />{t('agents.removeTitle')}</DropdownMenuItem> : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      )} />
  );
}

// what an agent is good at, picked from a list (the assistant reads it to share out the work). It is saved as the
// labels in words; a saved text is read back by the words in it, in Spanish or English.
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
        <button type="button" className="border-input hover:bg-accent/40 flex min-h-9 w-full cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-left text-control" data-testid={testid}>
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

// The API key of an agent that takes one: kept in the vault (after the master password), never shown again and never in the settings.
function AgentKeys({ a }) {
  const t = useT();
  const [saved, setSaved] = useState({});
  const load = () => call('agentKeys.state').then((s) => setSaved(s?.[a.id] ?? {})).catch(quiet);
  useEffect(() => { load(); }, [a.id]);
  const set = async (name) => {
    const unlock = await unlockCore('secrets');
    if (!unlock) return;
    const r = await form(t('agents.keyTitle', { name }), {
      description: t('agents.keyDesc'), initial: { value: '' },
      body: (v, setV) => <Input type="password" autoComplete="off" spellCheck={false} autoFocus value={v.value} onChange={(e) => setV({ value: e.target.value })} data-testid={`agent-key-input-${a.id}`} />,
      ok: t('settings.save'),
      onOk: (v) => call('agentKeys.save', { agent: a.id, name, value: v.value.trim(), unlock })
    });
    if (r) { notifyOk(t('agents.keySaved')); load(); }
  };
  return (
    <>
      {a.keys.map((name) => (
        <Setting key={name} label={name} hint={saved[name] ? t('agents.keyInVault') : t('agents.keyHint')}>
          {saved[name] ? <Badge variant="info">{t('agents.keyBadge')}</Badge> : null}
          <Button size="xs" variant="outline" onClick={() => set(name)} data-testid={`agent-key-${a.id}`}><KeyRound />{saved[name] ? t('agents.keyChange', { name }) : t('agents.keySet', { name })}</Button>
        </Setting>
      ))}
    </>
  );
}

// The window of the plan the agent reports for its active account (a thin bar), or that it has no data.
function WindowRow({ a, usage }) {
  const t = useT();
  const locale = useLocale();
  const u = usage.find((x) => x.agent === a.id && x.real) ?? usage.find((x) => x.agent === a.id);
  const real = u?.real;
  const five = !real?.window || /five_hour|^300min$|^5h$/.test(String(real.window));
  const pct = real ? Math.round(real.utilization * 100) : null;
  return (
    <Setting label={five ? t('agents.window5', { h: u?.windowHours ?? 5 }) : t('agents.windowUse')} hint={real ? t('agents.windowHint') : ''}>
      {real ? (
        <span className="flex items-center gap-2.5">
          <span className="text-muted-foreground text-caption">{pct} %{real.resetAt ? ` · ${t('agents.renews', { when: whenOf(real.resetAt, locale) })}` : ''}</span>
          <span className="bg-muted block h-1.5 w-[140px] overflow-hidden rounded-full" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t('agents.window5', { h: u?.windowHours ?? 5 })}><span className="bg-primary-text block h-full rounded-full" style={{ width: `${Math.min(100, Math.max(pct, 1))}%` }} /></span>
        </span>
      ) : <span className="text-muted-foreground text-caption">{t('agents.noUsageData')}</span>}
    </Setting>
  );
}

// One agent: a card with its state, accounts, models, the window of its plan and what can be done with it.
function AgentCard({ a, reload, usage, team }) {
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
  const { add, scan } = useAccountActions(a, reload);
  const planOf = (acc) => usage.find((u) => u.account === acc.id)?.plan ?? null;
  const shown = listed.slice(0, 3);
  const installViaTeam = team.available && TEAM_AGENTS.includes(a.id);
  const pickPath = async () => { const f = await bridge.pickProgram?.(t('sys.dialog.pickProgram')); if (f) save(a.id, { path: f }).then(reload); };
  const firstLogin = a.accounts.find((acc) => acc.enabled !== false) ?? a.accounts[0];
  return (
    <ListCard data-testid={`agent-card-${a.id}`}>
      <div className="agh flex items-center gap-3 p-3.5">
        <span className="bg-secondary grid size-8 flex-none place-items-center rounded-ctl"><AgentIcon agent={a.id} className="size-4" /></span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <b className="flex items-center gap-1.5 font-(family-name:--title) text-card-title font-semibold"><span className="truncate">{a.label}</span>{a.kind === 'acp' ? <Badge variant="info">ACP</Badge> : null}</b>
          <span className="text-muted-foreground truncate text-caption">{a.installed ? a.version ?? t('agents.installed') : NATIVE.includes(a.id) ? t('agents.notHere') : t('agents.notFoundHere')}</span>
        </div>
        <div className="flex flex-none items-center gap-1.5">
          {!a.installed ? <Badge variant={NATIVE.includes(a.id) ? 'destructive' : 'warning'}>{NATIVE.includes(a.id) ? t('agents.missing') : t('agents.notFound')}</Badge>
            : a.login === 'no' ? <Badge variant="warning">{login[0]}</Badge> : <Badge variant="success">{t('agents.installed')}</Badge>}
          {!cfg.enabled ? <Badge variant="secondary">{t('agents.disabled')}</Badge> : null}
          <Switch checked={cfg.enabled} onCheckedChange={(enabled) => save(a.id, { enabled })} aria-label={t('agents.enabled')} />
        </div>
      </div>
      {!cfg.enabled && OFF_AGENTS.includes(a.id) ? <Stack><div><Button size="xs" variant="soft" onClick={() => save(a.id, { enabled: true })} data-testid={`agent-enable-${a.id}`}>{t('agents.enable')}</Button></div></Stack> : null}
      {a.id === 'hermes' ? <Stack><p className="text-warning-ink text-caption" data-testid="agent-hermes-note">{t('agents.hermesNote')}</p></Stack> : null}
      {a.unverified ? <Stack><p className="text-warning-ink text-caption" data-testid={`agent-unverified-${a.id}`}>{t('agents.unverifiedNote')}</p></Stack> : null}
      {a.id === 'pi' || a.id === 'antigravity' ? <Stack><p className="text-warning-ink text-caption" data-testid={`agent-noguard-${a.id}`}>{t('agents.noGuardNote')}</p></Stack> : null}
      {a.installed ? a.accounts.map((acc) => <AccountRow key={acc.id} acc={acc} plan={planOf(acc)} reload={reload} />) : null}
      {a.installed && !a.multi ? <Stack className="py-2.5"><span className="text-faint-foreground text-caption">{t('agents.fixedSession', { label: a.label })}</span></Stack> : null}
      {a.keys?.length ? <AgentKeys a={a} /> : null}
      {a.installed ? (
        <Setting label={t('agents.models')} hint={listed.length ? t('agents.modelsHint') : ''}>
          {shown.length ? <span className="flex flex-wrap justify-end gap-1">{shown.map((m) => <Badge key={m.id} variant="secondary">{m.label}</Badge>)}{listed.length > shown.length ? <Badge variant="secondary">+{listed.length - shown.length}</Badge> : null}</span> : <span className="text-muted-foreground text-caption">{t('agents.modelsAfterLogin')}</span>}
        </Setting>
      ) : null}
      {a.installed ? <WindowRow a={a} usage={usage} /> : null}
      <Stack className="py-2.5">
        <Collapsible>
          <CollapsibleTrigger className="text-muted-foreground hover:text-foreground group flex cursor-pointer items-center gap-1 text-xs"><ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />{t('agents.modelsSettings')}</CollapsibleTrigger>
          {/* everything is chosen, nothing typed: the agent's real models, its strengths from a list and its program
              in Windows' own dialog. Each change is saved at once. */}
          <CollapsibleContent className="mt-3 grid gap-3">
            {a.installed && KIND[a.kind] ? <span className="text-muted-foreground text-caption">{t(KIND[a.kind])}</span> : null}
            <Field label={t('agents.defaultModel')} hint={t('agents.defaultModelHint')}>
              <Select className="w-full" value={defaultValue} options={modelOptions} disabled={modelOptions.length < 2} onValueChange={(m) => save(a.id, { defaultModel: m === AGENT_DEFAULT ? '' : m })} data-testid={`agent-default-model-${a.id}`} />
            </Field>
            <Field label={t('agents.strengths')} hint={t('agents.strengthsHint')}><StrengthsPicker value={cfg.strengths ?? ''} onChange={(strengths) => save(a.id, { strengths })} testid={`agent-strengths-${a.id}`} /></Field>
            <Field label={t('agents.path')} hint={t('agents.pathHint')}>
              <div className="flex min-w-0 items-center gap-2 rounded-lg border px-3 py-1.5">
                <span className="text-muted-foreground min-w-0 flex-1 truncate text-control">{cfg.path ? t('agents.pathCustom') : t('agents.pathAuto')}</span>
                {cfg.path ? <Button size="xs" variant="ghost" onClick={() => save(a.id, { path: '' }).then(reload)}>{t('agents.auto')}</Button> : null}
                <Button size="xs" variant="outline" onClick={pickPath} data-testid={`agent-path-${a.id}`}><FolderOpen />{t('agents.pickProgram')}</Button>
              </div>
            </Field>
          </CollapsibleContent>
        </Collapsible>
      </Stack>
      <CardFoot className="flex-wrap gap-2">
        {a.installed && a.multi ? <Button size="sm" variant="outline" onClick={add}><UserPlus />{t('agents.addAnother')}</Button> : null}
        {a.installed && a.multi ? <BubbleTip title={t('agents.scan')} text={t('agents.scanTip', { label: a.label })}><Button size="sm" variant="outline" onClick={scan} data-testid={`agent-scan-${a.id}`}><ScanSearch />{t('agents.scan')}</Button></BubbleTip> : null}
        {/* the paths are not shown (they say too much on a shared screen): a button opens the program's folder. */}
        {a.where ? <Button size="sm" variant="ghost" onClick={() => act(bridge.openPath(dirOf(a.where)))} data-testid={`agent-open-${a.id}`}><FolderOpen />{t('agents.openFolder')}</Button> : null}
        <Button size="sm" variant="outline" onClick={() => act(call('agents.check', { agent: a.id })).then(reload)}><RefreshCw />{t('agents.check')}</Button>
        {!a.installed ? <Button size="sm" variant="outline" onClick={pickPath}><Search />{t('agents.findIt')}</Button> : null}
        {a.installed && a.login === 'no' && firstLogin ? <Button size="sm" onClick={() => signIn(firstLogin, firstLogin.label)}><LogIn />{t('agents.login')}</Button> : null}
        <InstallButton a={a} reload={reload} />
        {!a.installed && installViaTeam ? <Button size="sm" disabled={team.running} onClick={() => team.install([a.id])}><Download />{t('agents.install')}</Button> : null}
        {!a.installed && !INSTALLABLE.includes(a.id) && !installViaTeam ? <Button size="sm" onClick={() => bridge.openExternal(INSTALL[a.id])}><ExternalLink />{t('agents.howInstall')}</Button> : null}
      </CardFoot>
    </ListCard>
  );
}

// «Prepara tu equipo»: what Orb needs on this PC, with one click to install what is missing (the official installers,
// installer.* in the engine; the agents that come by ACP are installed from their own card). Windows only.
function TeamBlock({ team, agents }) {
  const t = useT();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id); }, []);
  if (!team.available) return null;
  const items = team.items?.filter((i) => !TEAM_AGENTS.includes(i.id)) ?? [];
  const missing = items.filter((i) => !i.installed && !i.optional);
  const ago = Math.floor((now - (team.checkedAt ?? now)) / 60_000);
  const versionOf = (id) => agents?.find((x) => x.id === id)?.version ?? null;
  const stepOf = (id) => team.progress?.steps.find((s) => s.id === id);
  return (
    <Block title={t('agents.team.title')} count={team.items ? (missing.length ? t('agents.team.missing', { n: missing.length }) : null) : null} note={t('agents.team.note')} data-testid="agents-team">
      {!team.items ? <div className="text-muted-foreground flex items-center gap-2 text-control"><Spinner />{t('comp.installer.checking')}</div> : (
        <Panel className="mt-0">
          {items.map((i) => {
            const step = stepOf(i.id);
            const busy = step?.state === 'instalando';
            const version = i.version?.match(/\d+(?:\.\d+)+/)?.[0] ?? versionOf(i.id);
            return (
              <Setting key={i.id} label={i.label} hint={i.installed ? '' : i.why}>
                {i.installed || step?.state === 'hecho' ? <>{version ? <span className="text-muted-foreground text-control">{version}</span> : null}<Badge variant="success">{t('comp.installer.installed')}</Badge></>
                  : <>
                    {i.optional ? <span className="text-muted-foreground text-control">{t('agents.team.optional')}</span> : null}
                    {step?.state === 'error' ? <BubbleTip title={t('comp.installer.failed')} text={step.detail}><Badge variant="destructive" tabIndex={0}>{t('comp.installer.failed')}</Badge></BubbleTip>
                      : <Badge variant={i.optional ? 'secondary' : 'destructive'}>{i.optional ? t('agents.team.optional') : t('agents.team.lacks')}</Badge>}
                    <Button size="sm" variant={i.optional ? 'outline' : 'default'} disabled={team.running || busy} onClick={() => team.install([i.id])} data-testid={`team-install-${i.id}`}>{busy ? <Spinner className="size-3.5" /> : null}{busy ? t('comp.installer.installing') : t('agents.install')}</Button>
                  </>}
              </Setting>
            );
          })}
          <CardFoot className="justify-between">
            <span className="text-faint-foreground text-caption">{ago < 1 ? t('agents.team.checkedNow') : t('agents.team.checkedAgo', { n: ago })}</span>
            <span className="flex items-center gap-2">
              {missing.length > 1 ? <Button size="sm" disabled={team.running} onClick={() => team.install(missing.map((i) => i.id))} data-testid="team-install-all"><ListChecks />{team.running ? t('comp.installer.installingBtn') : t('agents.team.installMissing', { n: missing.length })}</Button> : null}
              <Button size="sm" variant="outline" onClick={team.reload} data-testid="team-recheck"><RefreshCw />{t('agents.team.recheck')}</Button>
            </span>
          </CardFoot>
        </Panel>
      )}
      {team.progress?.steps.length ? <InstallProgress progress={team.progress} /> : null}
      {team.progress?.running ? <p className="text-faint-foreground text-caption">{t('comp.installer.windowOpened')}</p> : null}
    </Block>
  );
}

// How «Hacer commit…» writes its message (engine/commit-message.mjs): the style the user picks here; never an AI signature.
function CommitStyleCard() {
  const t = useT();
  const cfg = useStore((s) => s.app.config.git) ?? {};
  const [style, setStyle] = useState(cfg.commitStyle ?? 'conventional');
  const [text, setText] = useState(cfg.commitInstructions ?? '');
  const options = ['conventional', 'repo', 'custom'].map((v) => ({ value: v, label: t(`agents.commit.${v}`) }));
  return (
    <Block title={t('agents.commit.title')} note={t('agents.commit.desc')} data-testid="commit-style">
      <Panel>
        <Stack>
          <Select value={style} onValueChange={setStyle} options={options} className="max-w-sm" title={t('agents.commit.title')} />
          {style === 'custom' ? <Field label={t('agents.commit.instructions')}><Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={2000} placeholder={t('agents.commit.ph')} /></Field> : null}
        </Stack>
        <CardFoot><Button size="sm" onClick={async () => { const c = await act(call('config.save', { patch: { git: { commitStyle: style, commitInstructions: text } } }), t('agents.saved')); if (c) setState({ app: { ...getState().app, config: c } }); }} data-testid="commit-style-save">{t('agents.commit.save')}</Button></CardFoot>
      </Panel>
    </Block>
  );
}

// Two columns of independent cards (a card's height does not stretch its neighbour); one column on a narrow window.
function CardColumns({ list, render }) {
  return (
    <div className="grid items-start gap-4 min-[900px]:grid-cols-2 [&>*]:min-w-0">
      {[0, 1].map((col) => <div key={col} className="flex flex-col gap-4">{list.filter((_, i) => i % 2 === col).map(render)}</div>)}
    </div>
  );
}

export function AgentsView() {
  const t = useT();
  const version = useStore((s) => s.version);
  const [agents, setAgents] = useState(null);
  const [usage, setUsage] = useState([]);
  const [system, setSystem] = useState(null);
  const [items, setItems] = useState(null);
  const [checkedAt, setCheckedAt] = useState(null);
  const [progress, setProgress] = useState(null);
  useEffect(() => { call('system.check').then(setSystem).catch(quiet); }, []);
  const load = (refresh = false) => { call('agents.status', { refresh }).then(setAgents).catch(() => setAgents([])); };
  useEffect(() => load(), []);
  useEffect(() => { call('usage.get').then(setUsage).catch(quiet); }, [version]);
  const windows = system?.platform === 'win32';
  const loadTeam = async () => { const r = await call('installer.check').catch(() => []); setItems(r); setCheckedAt(Date.now()); };
  useEffect(() => {
    if (!windows) return undefined;
    loadTeam();
    call('installer.progress').then((p) => p.steps.length && setProgress(p)).catch(quiet);
    return bridge.on('installer:progress', (p) => { setProgress(p); if (p.finished) { loadTeam(); load(true); } });
  }, [windows]); // eslint-disable-line react-hooks/exhaustive-deps
  const team = {
    available: windows, items, checkedAt, progress, running: Boolean(progress?.running), reload: loadTeam,
    install: async (ids) => { const p = await act(call('installer.start', { ids })); if (p) setProgress(p); }
  };
  const native = agents?.filter((a) => NATIVE.includes(a.id)) ?? [];
  const more = agents?.filter((a) => !NATIVE.includes(a.id)) ?? [];
  const lacking = items?.filter((i) => !i.installed && !i.optional && !TEAM_AGENTS.includes(i.id)).length ?? 0;
  const metaParts = [agents ? t('agents.metaCounts', { native: native.length, more: more.length }) : t('agents.meta'), lacking ? t(lacking === 1 ? 'agents.metaLacksOne' : 'agents.metaLacks', { n: lacking }) : null].filter(Boolean);
  const recheck = () => { setAgents(null); load(true); };
  const guide = () => form(t('guide.open'), { wide: true, body: () => <ModelGuide auto={getState().app?.config?.budget?.autoModel !== false} />, ok: t('comp.dialogs.ok') });
  const reload = () => load(true);
  const card = (a) => <AgentCard key={a.id} a={a} reload={reload} usage={usage} team={team} />;
  return (
    <>
      <PageHeader title={t('agents.title')} meta={metaParts.join(' · ')}>
        <BubbleTip title={t('guide.open')} text={t('agents.tipGuide')}><IconButton label={t('guide.open')} onClick={guide} data-testid="agents-guide"><BookOpen /></IconButton></BubbleTip>
        <BubbleTip title={t('agents.tipUpdatesTitle')} text={t('agents.tipUpdates')}><IconButton label={t('agents.checkAll')} onClick={recheck} data-testid="agents-check-all"><RefreshCw /></IconButton></BubbleTip>
        <DropdownMenu modal={false}>
          <BubbleTip title={t('nav.more')}><DropdownMenuTrigger asChild><MoreButton data-testid="agents-more" /></DropdownMenuTrigger></BubbleTip>
          <DropdownMenuContent align="end" className="w-48"><DropdownMenuItem onSelect={recheck} data-testid="agents-refresh"><RefreshCw />{t('agents.refresh')}</DropdownMenuItem></DropdownMenuContent>
        </DropdownMenu>
      </PageHeader>
      <PageBody className="pt-5 pb-10 md:pb-28">
        <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-4">
          <AgentsUsageTabs current="agents" />
          <LoginDialog reload={reload} windows={windows} />
          <TeamBlock team={team} agents={agents} />
          {system && !system.git ? (
            <Note tone="warning" className="items-center">
              <div className="flex items-center gap-3"><div className="min-w-0 flex-1"><div className="text-body font-medium">{t('agents.noGit')}</div><div className="text-muted-foreground text-caption">{t('agents.noGitDesc')}</div></div>
                <Button size="sm" variant="outline" onClick={() => bridge.openExternal('https://git-scm.com/download/win')}><ExternalLink />{t('agents.getGit')}</Button></div>
            </Note>
          ) : null}
          <Block title={t('agents.nativeTitle')} note={t('agents.nativeNote')}>
            {agents ? <CardColumns list={native} render={card} /> : <ListCard className="flex items-center justify-center py-6"><Spinner /></ListCard>}
          </Block>
          {more.length ? (
            <Block title={t('agents.moreTitle')} count={more.length} note={t('agents.moreNote')}>
              <CardColumns list={more} render={card} />
            </Block>
          ) : null}
          {/* what Orb leaves out of a project's agent settings (claude.mjs, cursor.mjs, guard.mjs). */}
          <Block title={t('agents.projectSettingsTitle')} note={t('agents.projectSettingsDesc')} />
          <CommitStyleCard />
        </div>
      </PageBody>
    </>
  );
}

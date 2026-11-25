// Agents: which CLIs are installed, their login, models and how much of each subscription window is used.
// The detail of the usage lives in the «Uso» tab next to this one (views/usage.jsx).
import { useEffect, useRef, useState } from 'react';
import { RefreshCw, LogIn, ChevronRight, ChevronDown, ExternalLink, Plus, Trash2, FolderOpen, ScanSearch, Copy, Download, SquareTerminal, BookOpen, KeyRound, Search, LogOut, Pencil, Check } from 'lucide-react';
import { notifyError, notifyInfo, notifyOk, notifyWarn } from '@/lib/notify.js';
import { useCatalog, AccountTag } from '@/components/brain-picker.jsx';
import { ACCOUNT_COLORS, TAG_RE, defaultTag } from '../../shared/account-marks.mjs';
import { ModelGuide } from '@/components/model-guide.jsx';
import { confirm, form } from '@/components/dialogs.jsx';
import { PageHeader, PageBody } from '@/components/page.jsx';
import { AgentsUsageTabs } from '@/components/agents-tabs.jsx';
import { AgentLogo } from '@/components/agent-icon.jsx';
import { ToolsBlock, TEAM_AGENTS } from './agents-tools.jsx';
import { Button } from '@/components/ui/button.jsx';
import { IconButton, MoreButton, Note, ListCard, ListRow } from '@/components/ui/primitives.jsx';
import { Badge, Field, Input, Spinner } from '@/components/ui/basic.jsx';
import { Collapsible, CollapsibleTrigger, CollapsibleContent, BubbleTip, Checkbox, Select, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuCheckboxItem, Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/overlay.jsx';
import { cn, baseName } from '@/lib/utils.js';
import { useStore, call, act, bridge, setState, getState } from '@/lib/store.js';
import { LOGIN, OFF_AGENTS } from '@/lib/labels.js';
import { unlockCore } from '@/lib/core-access.js';
import { t, useT, useLocale } from '@/lib/i18n.js';
import { quiet } from '@/lib/quiet.js';
import { Block, Setting, Fld } from './settings/rows.jsx';

const INSTALL = { claude: 'https://docs.claude.com/en/docs/claude-code/setup', codex: 'https://developers.openai.com/codex/cli', cursor: 'https://cursor.com/cli',
  gemini: 'https://github.com/google-gemini/gemini-cli', opencode: 'https://opencode.ai', qwen: 'https://github.com/QwenLM/qwen-code', copilot: 'https://github.com/github/copilot-cli', hermes: 'https://hermes-agent.nousresearch.com',
  grok: 'https://x.ai/cli', devin: 'https://cli.devin.ai', droid: 'https://factory.ai', omp: 'https://github.com/can1357/oh-my-pi', pi: 'https://pi.dev', antigravity: 'https://antigravity.google' };
// Agents that start turned off and were asked for from their ficha: turned on only when their install finishes well.
const enableAfterInstall = new Set();

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
// What the update dialog says: the exact version only when the installer installs that version (npm); Claude's own installer
// takes the latest one it publishes, so the dialog says what Orb runs and which version was last published. The command
// shown is the one of this platform, and none when there is none.
const updateBody = (t, a, upd) => t(upd.exact ? (upd.command ? 'agents.updateConfirmBody' : 'agents.updateConfirmBodyNoCmd') : (upd.command ? 'agents.updateConfirmBodyRun' : 'agents.updateConfirmBodyRunNoCmd'), { label: a.label, latest: upd.latest, cmd: upd.command ?? '' });
// «Reinstalar» (repair): the same install call as the button, after its own confirmation.
const reinstall = async (t, a) => {
  if (!(await confirm(t('agents.reinstallTitle', { label: a.label }), t('agents.reinstallBody', { label: a.label }), { ok: t('agents.reinstall'), tone: 'primary' }))) return;
  await act(call('agents.install', { agent: a.id }));
};
function InstallButton({ a }) {
  const t = useT();
  const [st, setSt] = useState(null);
  useEffect(() => { call('agents.installState', { agent: a.id }).then((s) => { if (s?.state === 'instalando') setSt(s); }).catch(quiet); }, [a.id]);
  // The notice and the reload of a finished install belong to the page (AgentsView): one listener, however many buttons.
  useEffect(() => bridge.on('agents:install', (p) => { if (p.agent === a.id) setSt(p); }), [a.id]);
  if (!INSTALLABLE.includes(a.id)) return null;
  const busy = st?.state === 'instalando';
  const upd = a.installed ? a.update : null;
  // «Actualizar» only when a check found a newer version; an installed agent with nothing newer has no button (its «⋯» keeps «Reinstalar»).
  if (a.installed && !upd?.available && !busy) return null;
  const run = async () => {
    // an update is one click with its confirmation: it says which version and which installer
    if (upd?.available && !(await confirm(t('agents.updateConfirmTitle', { label: a.label }), updateBody(t, a, upd), { ok: t('agents.update'), tone: 'primary' }))) return;
    const r = await act(call('agents.install', { agent: a.id })); if (r) setSt(r);
  };
  return (
    <>
      <Button size="sm" disabled={busy} onClick={run} data-testid={`agent-install-${a.id}`}>
        {busy ? <Spinner className="size-3.5" /> : <Download />}{busy ? t('agents.installing') : a.installed ? (upd.exact ? t('agents.updateTo', { version: upd.latest }) : t('agents.update')) : t('agents.install')}
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

// «Cerrar sesión»: Orb deletes the login of an account it made itself (the user types the name to confirm); for any other
// account (the CLI's own login, a folder the user picked) it only says how to do it with the agent's own tool.
async function signOut(acc, reload) {
  if (acc.logout !== 'orb') {
    const tool = acc.agent === 'codex' ? 'Codex' : 'Claude Code';
    await confirm(t('agents.logoutToolTitle'), t('agents.logoutToolBody', { tool, how: t(`agents.logoutHow.${acc.agent}`) }), { ok: t('comp.dialogs.ok'), cancel: null, tone: 'primary' });
    return;
  }
  const done = await form(t('agents.logoutTitle', { label: acc.label }), {
    description: `${t('agents.logoutBody', { label: acc.label })}${getState().app?.config?.backup?.accounts === true ? ` ${t('agents.logoutBackups')}` : ''}`, initial: { name: '' },
    body: (v, set) => <Field label={t('agents.logoutField')}><Input autoFocus value={v.name} onChange={(e) => set({ name: e.target.value })} placeholder={acc.label} data-testid={`agent-logout-name-${acc.id}`} /></Field>,
    ok: t('agents.logout'), okDanger: true, okDisabled: (v) => v.name.trim() !== acc.label,
    onOk: (v) => call('accounts.logout', { id: acc.id, confirm: v.name.trim() })
  });
  if (done) { notifyOk(t('agents.logoutDone', { label: acc.label })); reload(); }
}

// One account: its name with the plan and the state of its login, and a menu with what can be done with it.
// What Orb knows about whose login a folder holds: checked against the one it learned, not matching, or not checked yet.
function identityOf(acc, t) {
  if (acc.viaKey) return [t('acct.viaKey'), 'info'];
  if (acc.identity === 'ok') return [acc.hint ? t('acct.checkedHint', { hint: acc.hint }) : t('acct.checked'), 'success'];
  if (acc.identity === 'mismatch' || acc.identity === 'noMail') return [t('acct.mismatch'), 'warning'];
  return [t('acct.unchecked'), 'secondary'];
}

// The used part of the account's window as a thin bar with its number, from what the agent reports (nothing when it says none).
function AccountUsage({ u, label }) {
  const t = useT();
  const locale = useLocale();
  const real = u?.real;
  if (!real) return <span className="text-faint-foreground w-[150px] text-right text-caption" data-testid="account-usage-none">{t('agents.noUsageData')}</span>;
  const pct = Math.round(real.utilization * 100);
  return (
    <span className="flex w-[150px] items-center justify-end gap-2" data-testid="account-usage" title={real.resetAt ? t('agents.renews', { when: whenOf(real.resetAt, locale) }) : undefined}>
      <span className="text-muted-foreground text-caption tabular-nums">{pct} %</span>
      <span className="bg-muted block h-1.5 w-[84px] overflow-hidden rounded-full" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}><span className={cn('block h-full rounded-full', pct >= 90 ? 'bg-warning' : 'bg-primary-text')} style={{ width: `${Math.min(100, Math.max(pct > 0 ? 3 : 0, pct))}%` }} /></span>
    </span>
  );
}

// Name, tag and colour of an account. Empty tag: the one Orb makes from the name.
function editAccount(acc, t, reload) {
  return form(t('acct.editTitle'), {
    initial: { label: acc.label, tag: acc.tag ?? '', color: acc.color ?? ACCOUNT_COLORS[0] },
    body: (v, set) => (<>
      <Field label={t('agents.accountName')}><Input value={v.label} maxLength={60} onChange={(e) => set({ label: e.target.value })} data-testid="account-edit-name" /></Field>
      <Field label={t('acct.tag')} hint={t('acct.tagHint')}><Input value={v.tag} maxLength={4} placeholder={defaultTag(v.label, acc.id)} onChange={(e) => set({ tag: e.target.value.toUpperCase() })} data-testid="account-edit-tag" /></Field>
      <Field label={t('acct.color')}>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('acct.color')}>
          {ACCOUNT_COLORS.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={v.color === c} onClick={() => set({ color: c })} className={cn('cursor-pointer rounded-md p-0.5 outline-none focus-visible:outline-2 focus-visible:outline-ring', v.color === c && 'ring-ring ring-2')} data-testid={`account-color-${c}`}>
              <AccountTag text={v.tag.trim() || defaultTag(v.label, acc.id)} color={c} />
            </button>
          ))}
        </div>
      </Field>
    </>),
    ok: t('settings.save'),
    onOk: async (v) => {
      const tag = v.tag.trim();
      if (tag && !TAG_RE.test(tag)) { notifyWarn(t('acct.tagBad')); return false; }
      await call('accounts.update', { id: acc.id, label: v.label.trim() || acc.label, tag, color: v.color });
      reload(); return true;
    }
  });
}

// «Es correcta, recordar esta»: shows the login found in the folder before taking it as the account's own.
async function rememberAccount(acc, t, reload) {
  const found = await act(call('accounts.identityFound', { id: acc.id }));
  const hint = found?.hint ?? acc.foundHint;
  if (!hint) { notifyWarn(t('acct.noFound')); return; }
  if (!(await confirm(t('acct.rememberTitle', { label: acc.label }), t('acct.rememberBody', { label: acc.label, hint }), { ok: t('acct.remember') }))) return;
  if (await act(call('accounts.rememberIdentity', { id: acc.id }), t('acct.remembered'))) reload();
}

function AccountRow({ acc, plan, reload, agentOn = true, usage = null, multi = false }) {
  const t = useT();
  const [idText, idTone] = identityOf(acc, t);
  const identityFlag = acc.identity === 'mismatch' || acc.identity === 'noMail';
  const login = LOGIN[acc.login] ?? LOGIN.desconocido;
  // The state as the mock-up's row says it: signed out, paused (not used by Orb) or active (signed in and in use).
  // With its agent turned off no account is in use, so a signed-in one only says that it is signed in.
  const state = acc.login === 'no' ? [t('agents.accountNoLogin'), 'warning'] : acc.enabled === false ? [t('agents.accountPaused'), 'secondary'] : acc.login === 'si' ? (agentOn ? [t('agents.accountActive'), 'success'] : [t('login.si'), 'secondary']) : login;
  return (
    <ListRow className={cn('border-border not-first:border-t', acc.enabled === false && 'opacity-60')} data-testid={`agent-account-${acc.id}`}
      title={multi ? <span className="inline-flex items-center gap-1.5"><AccountTag acc={acc} />{acc.label}</span> : acc.label}
      meta={<span className="inline-flex min-w-0 items-center gap-1.5">{plan ? <span>{plan}</span> : null}<span className={cn(idTone === 'warning' && 'text-warning-ink', idTone === 'success' && 'text-success')} data-testid={`agent-account-identity-${acc.id}`} data-identity={acc.viaKey ? 'viaKey' : acc.identity ?? 'unchecked'}>{plan ? '· ' : ''}{idText}</span>{acc.sameAs?.length ? <span className="text-warning-ink" data-testid={`agent-account-same-${acc.id}`}>· {t('acct.sameAs')}</span> : null}</span>}
      trailing={(
        <span className="flex flex-none items-center gap-2.5">
          {multi ? <AccountUsage u={usage} label={acc.label} /> : null}
          <Badge variant={state[1]} data-testid={`agent-account-state-${acc.id}`}>{state[0]}</Badge>
          <DropdownMenu modal={false}>
            <BubbleTip title={t('nav.more')}><DropdownMenuTrigger asChild><MoreButton small data-testid={`agent-account-more-${acc.id}`} /></DropdownMenuTrigger></BubbleTip>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onSelect={() => signIn(acc, acc.label)} data-testid={`agent-login-${acc.id}`}><LogIn />{t('agents.login')}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => editAccount(acc, t, reload)} data-testid={`agent-edit-${acc.id}`}><Pencil />{t('acct.edit')}</DropdownMenuItem>
              {identityFlag ? <DropdownMenuItem onSelect={() => rememberAccount(acc, t, reload)} data-testid={`agent-remember-${acc.id}`}><Check />{t('acct.remember')}</DropdownMenuItem> : null}
              <DropdownMenuCheckboxItem checked={acc.enabled !== false} onCheckedChange={(enabled) => act(call('accounts.update', { id: acc.id, enabled })).then(reload)}>{t('agents.useAccount')}</DropdownMenuCheckboxItem>
              {acc.logout ? <DropdownMenuItem onSelect={() => signOut(acc, reload)} data-testid={`agent-logout-${acc.id}`}><LogOut />{t('agents.logout')}</DropdownMenuItem> : null}
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

// The key's dialog: typed once and kept in the vault. The password or the phone's approval comes after it is typed: the phone
// approves exactly this call. True when it was saved.
async function askAgentKey(a, name, t) {
  const r = await form(t('agents.keyTitle', { name }), {
    description: t('agents.keyDesc'), initial: { value: '' },
    body: (v, setV) => <Input type="password" autoComplete="off" spellCheck={false} autoFocus value={v.value} onChange={(e) => setV({ value: e.target.value })} data-testid={`agent-key-input-${a.id}`} />,
    ok: t('settings.save'),
    onOk: async (v) => {
      const params = { agent: a.id, name, value: v.value.trim() };
      const unlock = await unlockCore('secrets', { request: { method: 'agentKeys.save', params } });
      if (!unlock) return false;
      return call('agentKeys.save', { ...params, unlock });
    }
  });
  if (r) notifyOk(t('agents.keySaved'));
  return Boolean(r);
}
// The API key of an agent that takes one: kept in the vault (after the master password), never shown again and never in the settings.
function AgentKeys({ a }) {
  const t = useT();
  const [saved, setSaved] = useState({});
  const load = () => call('agentKeys.state').then((s) => setSaved(s?.[a.id] ?? {})).catch(quiet);
  useEffect(() => { load(); }, [a.id]);
  const set = async (name) => { if (await askAgentKey(a, name, t)) load(); };
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

// What the agent spent today (usage.history of one day, from the ledger). The agents that give a cost show it; one that
// used something without saying its cost says so; no number is made up. Not drawn for an agent with nothing to say, unless it
// is paid by key (OpenCode, OpenRouter…), where the spend is the point.
function SpendRow({ a, today }) {
  const t = useT();
  const locale = useLocale();
  const mine = today?.agents?.find((x) => x.agent === a.id);
  const usd = mine?.usd ?? 0; const turns = mine?.turns ?? 0;
  if (!usd && !turns && !a.keys?.length) return null;
  return (
    <Setting label={t('agents.spendToday')} hint={usd ? t('agents.spendTodayHint', { turns }) : ''} data-testid={`agent-spend-${a.id}`}>
      {usd ? <span className="text-control tabular-nums">{new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(usd)}</span>
        : <span className="text-muted-foreground text-caption">{turns ? t('agents.spendNoCost') : t('agents.spendNone')}</span>}
    </Setting>
  );
}

// What Orb cannot vouch for in an agent, as the short tag it wears and the full text it is told with once (when it is
// installed or turned on). The first one is the tag; every one is in the text.
function warningsOf(a) {
  const out = [];
  if (a.id === 'pi' || a.id === 'antigravity') out.push({ id: 'noGuard', note: 'agents.noGuardNote' });
  if (a.id === 'hermes') out.push({ id: 'askLess', note: 'agents.hermesNote' });
  if (a.unverified) out.push({ id: 'beta', note: 'agents.unverifiedNote' });
  return out;
}
function AgentTag({ a }) {
  const t = useT();
  const w = warningsOf(a)[0];
  if (!w) return null;
  return (
    <BubbleTip title={t(`agents.tag.${w.id}`)} text={t(`agents.tagTip.${w.id}`)}>
      <Badge variant={w.id === 'beta' ? 'secondary' : 'warning'} tabIndex={0} data-testid={`agent-tag-${a.id}`}>{t(`agents.tag.${w.id}`)}</Badge>
    </BubbleTip>
  );
}
// The confirmation that shows the whole warning; true when there is none or the user accepts it.
async function acceptWarnings(a, ok, title = 'agents.installOf') {
  const w = warningsOf(a);
  if (!w.length) return true;
  return confirm(t(title, { label: a.label }), w.map((x) => t(x.note)).join(' '), { ok, tone: 'primary' });
}

// The limit windows an account reports (5 hours, week), as {kind, label, pct, resetAt}; the plain «real» reading when there are none.
const FIVE = /five_hour|^300min$|^5h$/;
const WEEK = /^seven_day$|^10080min$/;
function limitsOf(u) {
  const ws = (u?.windows ?? []).filter((w) => w.utilization != null);
  if (ws.length) return ws.map((w) => ({ key: String(w.window), kind: WEEK.test(String(w.window)) ? 'week' : FIVE.test(String(w.window)) ? 'five' : 'other', pct: Math.round(w.utilization * 100), resetAt: w.resetAt ?? null, hours: u.windowHours ?? 5 }));
  return u?.real ? [{ key: 'real', kind: !u.real.window || FIVE.test(String(u.real.window)) ? 'five' : 'other', pct: Math.round(u.real.utilization * 100), resetAt: u.real.resetAt ?? null, hours: u.windowHours ?? 5 }] : [];
}

// «Tus agentes»: one compact row per installed agent (logo, name, account and plan, what is left of its limit, a status dot);
// its detail opens under it: accounts, version, models, spend.
function AgentRow({ a, reload, usage, team, today }) {
  const t = useT();
  const cfg = useStore((s) => s.app.config.agents[a.id]);
  const [open, setOpen] = useState(false);
  // The models the agent itself says it has (the catalog), its own default first, and the saved one even if not listed.
  const catalog = useCatalog();
  const listed = catalog?.find((x) => x.id === a.id)?.models.filter((m) => m.id) ?? [];
  const modelOptions = [{ value: AGENT_DEFAULT, label: t('agents.defaultOfAgent') }, ...listed.map((m) => ({ value: m.id, label: m.label }))];
  // A saved alias (sonnet, opus…) shows as the model it stands for (Sonnet 5.5), not as a second entry.
  const alias = /^(sonnet|opus|haiku)$/.test(cfg.defaultModel ?? '') ? listed.find((m) => m.id.includes(cfg.defaultModel))?.id : null;
  const defaultValue = alias ?? (cfg.defaultModel || AGENT_DEFAULT);
  if (cfg.defaultModel && !alias && !modelOptions.some((o) => o.value === cfg.defaultModel)) modelOptions.push({ value: cfg.defaultModel, label: /^[a-z]+$/.test(cfg.defaultModel) ? cfg.defaultModel[0].toUpperCase() + cfg.defaultModel.slice(1) : cfg.defaultModel });
  const { add, scan } = useAccountActions(a, reload);
  const planOf = (acc) => usage.find((u) => u.account === acc.id)?.plan ?? null;
  const shown = listed.slice(0, 3);
  const installViaTeam = team.available && TEAM_AGENTS.includes(a.id);
  const pickPath = async () => { const f = await bridge.pickProgram?.(t('sys.dialog.pickProgram')); if (f) save(a.id, { path: f }).then(reload); };
  const firstLogin = a.accounts.find((acc) => acc.enabled !== false) ?? a.accounts[0];
  // The account in use: the first one that is on and signed in.
  const active = a.accounts.find((acc) => acc.enabled !== false && acc.login === 'si') ?? firstLogin;
  const plan = active ? planOf(active) : null;
  const shownUsage = usage.find((x) => x.account === active?.id && (x.real || x.windows?.length)) ?? usage.find((x) => x.agent === a.id && (x.real || x.windows?.length));
  const limits = limitsOf(shownUsage);
  // the row's bar is the tightest limit, the one that stops the agent first
  const left = limits.length ? Math.max(0, 100 - Math.max(...limits.map((l) => l.pct))) : null;
  const locale = useLocale();
  const status = !cfg.enabled ? 'off' : a.login === 'no' ? 'login' : 'ok';
  const upd = a.update;
  const own = a.version?.match(/\d+(?:\.\d+)+/)?.[0];
  const versionHint = upd && own && upd.available != null ? (upd.available === true ? t('agents.newVersion', { latest: upd.latest }) : t('agents.upToDate')) : '';
  const turnOn = async () => { if (!cfg.enabled && !(await acceptWarnings(a, t('agents.enable'), 'agents.enableOf'))) return; save(a.id, { enabled: !cfg.enabled }); };
  return (
    <Collapsible open={open} onOpenChange={setOpen} data-testid={`agent-card-${a.id}`} className="border-border not-first:border-t">
      <div className="flex items-center gap-2 pr-3.5">
      <CollapsibleTrigger className="hover:bg-accent/40 focus-visible:outline-ring flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-3 pl-3.5 text-left outline-none focus-visible:outline-2" data-testid={`agent-row-${a.id}`}>
        <span className="bg-secondary grid size-8 flex-none place-items-center rounded-ctl"><AgentLogo agent={a.id} label={a.label} className="size-4" /></span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <b className="flex items-center gap-1.5 font-(family-name:--title) text-card-title font-semibold"><span className="truncate">{a.label}</span></b>
          <span className="text-muted-foreground truncate text-caption" data-testid={`agent-meta-${a.id}`}>{!cfg.enabled ? t('agents.disabled') : [active?.label, plan].filter(Boolean).join(' · ') || (a.login === 'no' ? t('agents.accountNoLogin') : t('agents.installed'))}</span>
        </span>
        {left != null ? (
          <span className="flex w-[150px] flex-none items-center justify-end gap-2" data-testid={`agent-left-${a.id}`}>
            <span className="text-muted-foreground text-caption tabular-nums">{t('agents.pctLeft', { pct: left })}</span>
            <span className="bg-muted block h-1.5 w-[64px] overflow-hidden rounded-full" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={left} aria-label={t('agents.pctLeft', { pct: left })}><span className={cn('block h-full rounded-full', left <= 10 ? 'bg-warning' : 'bg-primary-text')} style={{ width: `${Math.min(100, Math.max(left > 0 ? 3 : 0, left))}%` }} /></span>
          </span>
        ) : null}
        <ChevronDown className={cn('text-muted-foreground size-4 flex-none transition-transform', open && 'rotate-180')} />
      </CollapsibleTrigger>
        <AgentTag a={a} />
        <BubbleTip title={t(`agents.dot.${status}`)}><span className={cn('size-2 flex-none rounded-full', status === 'ok' ? 'bg-success' : status === 'login' ? 'bg-warning' : 'bg-muted-foreground/40')} role="img" aria-label={t(`agents.dot.${status}`)} data-testid={`agent-dot-${a.id}`} data-status={status} /></BubbleTip>
      </div>
      <CollapsibleContent className="border-border @container border-t" data-testid={`agent-detail-${a.id}`}>
        {!cfg.enabled ? (
          <Setting label={t('agents.disabled')} hint={warningsOf(a).length ? t(`agents.tag.${warningsOf(a)[0].id}`) : ''} data-testid={`agent-off-${a.id}`}>
            <Button size="sm" onClick={turnOn} data-testid={`agent-enable-${a.id}`}>{t('agents.enable')}</Button>
          </Setting>
        ) : null}
        {a.accounts.map((acc) => <AccountRow key={acc.id} acc={acc} plan={planOf(acc)} reload={reload} agentOn={!!cfg.enabled} usage={usage.find((u) => u.account === acc.id) ?? null} multi={a.accounts.length > 1} />)}
        {a.multi ? (
          <Setting label={t('agents.addAnother')} hint={a.accounts.filter((acc) => acc.enabled !== false).length === 1 ? t('agents.oneAccount') : ''} data-testid={`agent-one-account-${a.id}`}>
            {a.login === 'no' && firstLogin ? <Button size="sm" onClick={() => signIn(firstLogin, firstLogin.label)}><LogIn />{t('agents.login')}</Button> : null}
            <Button size="sm" variant="outline" onClick={add} data-testid={`agent-add-account-${a.id}`}><Plus />{t('agents.addAnother')}</Button>
          </Setting>
        ) : (
          <Setting label={t('agents.fixedSessionTitle')} hint={t('agents.fixedSession', { label: a.label })}>
            {a.login === 'no' && firstLogin ? <Button size="sm" onClick={() => signIn(firstLogin, firstLogin.label)}><LogIn />{t('agents.login')}</Button> : null}
          </Setting>
        )}
        {a.accounts.length < 2 ? limits.map((l) => (
          <Setting key={l.key} label={l.kind === 'week' ? t('usage.winWeek') : l.kind === 'five' ? t('usage.win5', { h: l.hours }) : t('agents.windowUse')} hint={l.resetAt ? t('agents.renews', { when: whenOf(l.resetAt, locale) }) : ''} data-testid={`agent-limit-${a.id}-${l.kind}`}>
            <span className="flex items-center gap-2.5">
              <span className="text-muted-foreground text-caption tabular-nums">{t('agents.pctLeft', { pct: Math.max(0, 100 - l.pct) })}</span>
              <span className="bg-muted block h-1.5 w-[140px] overflow-hidden rounded-full" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={l.pct}><span className={cn('block h-full rounded-full', l.pct >= 90 ? 'bg-warning' : 'bg-primary-text')} style={{ width: `${Math.min(100, Math.max(l.pct > 0 ? 3 : 0, l.pct))}%` }} /></span>
            </span>
          </Setting>
        )) : null}
        <Setting label={own ? t('agents.versionOf', { version: own }) : t('agents.version')} hint={versionHint} data-testid={`agent-version-${a.id}`}>
          {/* a new version of an agent Orb cannot update by itself, or on a PC where its installer is not at hand: the command, no button */}
          {upd?.available && !INSTALLABLE.includes(a.id) && !installViaTeam && upd.command ? <span className="text-muted-foreground text-caption" data-testid={`agent-update-cmd-${a.id}`}>{t('agents.updateManual', { latest: upd.latest, cmd: upd.command })}</span> : null}
          <InstallButton a={a} />
          {upd?.available && installViaTeam ? <Button size="sm" disabled={team.running} onClick={async () => { if (await confirm(t('agents.updateConfirmTitle', { label: a.label }), updateBody(t, a, upd), { ok: t('agents.update'), tone: 'primary' })) team.install([a.id]); }} data-testid={`agent-update-${a.id}`}><Download />{t('agents.update')}</Button> : null}
          <DropdownMenu modal={false}>
            <BubbleTip title={t('nav.more')}><DropdownMenuTrigger asChild><MoreButton small data-testid={`agent-more-${a.id}`} /></DropdownMenuTrigger></BubbleTip>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onSelect={turnOn} data-testid={`agent-toggle-${a.id}`}>{cfg.enabled ? t('agents.turnOff') : t('agents.enable')}</DropdownMenuItem>
              {a.multi ? <DropdownMenuItem onSelect={scan} data-testid={`agent-scan-${a.id}`}><ScanSearch />{t('agents.scan')}</DropdownMenuItem> : null}
              {a.where ? <DropdownMenuItem onSelect={() => act(bridge.openPath(dirOf(a.where)))} data-testid={`agent-open-${a.id}`}><FolderOpen />{t('agents.openFolder')}</DropdownMenuItem> : null}
              <DropdownMenuItem onSelect={pickPath} data-testid={`agent-path-${a.id}`}>{t('agents.pickProgram')}</DropdownMenuItem>
              {cfg.path ? <DropdownMenuItem onSelect={() => save(a.id, { path: '' }).then(reload)} data-testid={`agent-path-auto-${a.id}`}>{t('agents.pathAutoItem')}</DropdownMenuItem> : null}
              <DropdownMenuItem onSelect={() => act(call('agents.check', { agent: a.id })).then(reload)} data-testid={`agent-check-${a.id}`}><RefreshCw />{t('agents.check')}</DropdownMenuItem>
              {INSTALLABLE.includes(a.id) ? <DropdownMenuItem onSelect={() => reinstall(t, a)} data-testid={`agent-reinstall-${a.id}`}>{t('agents.reinstall')}</DropdownMenuItem> : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </Setting>
        {a.keys?.length ? <AgentKeys a={a} /> : null}
        <Setting label={t('agents.models')} hint={listed.length ? t('agents.modelsHint') : t('agents.modelsAfterLogin')}>
          {shown.length ? <span className="flex flex-wrap justify-end gap-1">{shown.map((m) => <Badge key={m.id} variant="secondary">{m.label}</Badge>)}{listed.length > shown.length ? <Badge variant="secondary">+{listed.length - shown.length}</Badge> : null}</span> : null}
        </Setting>
        <Setting label={t('agents.defaultModel')} hint={t('agents.defaultModelHint')}>
          <Select className="w-52" value={defaultValue} options={modelOptions} disabled={modelOptions.length < 2} onValueChange={(m) => save(a.id, { defaultModel: m === AGENT_DEFAULT ? '' : m })} data-testid={`agent-default-model-${a.id}`} />
        </Setting>
        <Fld label={t('agents.strengths')} hint={t('agents.strengthsHint')}><StrengthsPicker value={cfg.strengths ?? ''} onChange={(strengths) => save(a.id, { strengths })} testid={`agent-strengths-${a.id}`} /></Fld>
        <SpendRow a={a} today={today} />
      </CollapsibleContent>
    </Collapsible>
  );
}

// «Añadir agentes»: the agents that are not installed, as small fichas: logo, name, one line and one button (Instalar, or
// Cómo instalarlo when Orb has no installer for it). The warning is a tag; it is read whole once, before installing.
const BLURB = ['claude', 'codex', 'cursor', 'gemini', 'copilot', 'opencode', 'qwen', 'hermes', 'grok', 'devin', 'droid', 'omp', 'pi', 'antigravity'];
function AgentFicha({ a, reload, team }) {
  const t = useT();
  const installViaTeam = team.available && TEAM_AGENTS.includes(a.id);
  const direct = INSTALLABLE.includes(a.id);
  const pickPath = async () => { const f = await bridge.pickProgram?.(t('sys.dialog.pickProgram')); if (f) save(a.id, { path: f }).then(reload); };
  // The warning is accepted once here. An agent Orb installs is turned on when its install ends well (AgentsView); one the user
  // installs by hand is turned on later from its «⋯», with the same confirmation.
  const ready = async (ok) => acceptWarnings(a, ok);
  return (
    <div className="bg-card border-border flex min-w-0 flex-col gap-3 rounded-card border p-3.5" data-testid={`agent-ficha-${a.id}`}>
      <div className="flex items-start gap-3">
        <span className="bg-secondary grid size-8 flex-none place-items-center rounded-ctl"><AgentLogo agent={a.id} label={a.label} className="size-4" /></span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <b className="flex flex-wrap items-center gap-x-1.5 font-(family-name:--title) text-card-title font-semibold"><span>{a.label}</span><AgentTag a={a} /></b>
          <span className="text-muted-foreground text-caption">{BLURB.includes(a.id) ? t(`agents.blurb.${a.id}`) : ''}</span>
        </div>
        <DropdownMenu modal={false}>
          <BubbleTip title={t('nav.more')}><DropdownMenuTrigger asChild><MoreButton small data-testid={`agent-more-${a.id}`} /></DropdownMenuTrigger></BubbleTip>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onSelect={pickPath} data-testid={`agent-find-${a.id}`}><Search />{t('agents.findIt')}</DropdownMenuItem>
            {a.keys?.map((name) => <DropdownMenuItem key={name} onSelect={() => askAgentKey(a, name, t)} data-testid={`agent-key-${a.id}`}><KeyRound />{a.keys.length > 1 ? t('agents.useKeyNamed', { name }) : t('agents.useKey')}</DropdownMenuItem>)}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex justify-end">
        {direct ? <InstallButton a={a} />
          : installViaTeam ? <Button size="sm" disabled={team.running} onClick={async () => { if (await ready(t('agents.install'))) { if (OFF_AGENTS.includes(a.id)) enableAfterInstall.add(a.id); team.install([a.id]); } }} data-testid={`agent-install-${a.id}`}><Download />{t('agents.install')}</Button>
            : <Button size="sm" variant="outline" onClick={async () => { if (await ready(t('agents.howInstall'))) bridge.openExternal(INSTALL[a.id]); }} data-testid={`agent-howto-${a.id}`}><ExternalLink />{t('agents.howInstall')}</Button>}
      </div>
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
  const [dev, setDev] = useState(null);
  const [today, setToday] = useState(null);
  useEffect(() => { call('system.check').then(setSystem).catch(quiet); }, []);
  const load = (refresh = false) => { call('agents.status', { refresh }).then(setAgents).catch(() => setAgents([])); };
  useEffect(() => load(), []);
  useEffect(() => { call('usage.get').then(setUsage).catch(quiet); call('usage.history', { days: 1 }).then(setToday).catch(quiet); }, [version]);
  const windows = system?.platform === 'win32';
  const loadTeam = async () => { const [r, d] = await Promise.all([call('installer.check').catch(() => []), call('installer.devTools').catch(() => null)]); setItems(r); setDev(d); setCheckedAt(Date.now()); };
  useEffect(() => {
    if (!windows) return undefined;
    loadTeam();
    call('installer.progress').then((p) => p.steps.length && setProgress(p)).catch(quiet);
    return bridge.on('installer:progress', (p) => {
      setProgress(p);
      if (!p.finished) return;
      for (const id of enableAfterInstall) if (p.steps.find((x) => x.id === id)?.state === 'hecho') save(id, { enabled: true });
      enableAfterInstall.clear();
      loadTeam(); load(true);
    });
  }, [windows]); // eslint-disable-line react-hooks/exhaustive-deps
  const team = {
    available: windows, items, dev, checkedAt, progress, running: Boolean(progress?.running), reload: loadTeam,
    install: async (ids) => { const p = await act(call('installer.start', { ids })); if (p) setProgress(p); }
  };
  const mine = agents?.filter((x) => x.installed) ?? [];
  const available = agents?.filter((x) => !x.installed) ?? [];
  const meta = agents ? t('agents.metaCounts', { n: mine.length, m: available.length }) : t('agents.meta');
  const recheck = () => { setAgents(null); load(true); };
  // «Buscar actualizaciones»: the only thing here that asks the internet (the public version of each agent's package);
  // it updates nothing, it only lets each card say «hay X». Explicit: never on opening the page.
  const [searching, setSearching] = useState(false);
  const searchUpdates = async () => {
    setSearching(true);
    try {
      const r = await act(call('agents.checkUpdates'));
      load(false);
      if (!r) return;
      const news = r.agents.filter((x) => x.available).length;
      if (r.failed?.length) notifyWarn(t('agents.updatesFailed', { list: r.failed.join(', ') }));
      else if (news) notifyInfo(t('agents.updatesFound', { n: news }));
      else notifyOk(t('agents.updatesNone'));
    } finally { setSearching(false); }
  };
  const guide = () => form(t('guide.open'), { wide: true, body: () => <ModelGuide auto={getState().app?.config?.budget?.autoModel !== false} />, ok: t('comp.dialogs.ok') });
  const reload = () => load(true);
  const agentsRef = useRef(agents);
  agentsRef.current = agents;
  useEffect(() => bridge.on('agents:install', (p) => {
    const label = agentsRef.current?.find((x) => x.id === p.agent)?.label ?? p.agent;
    if (p.state === 'hecho') { notifyOk(p.version ? t('agents.installDone', { label, version: p.version }) : t('agents.installDoneNoVersion', { label })); reload(); }
    if (p.state === 'error') notifyError(p.message);
  }), []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <PageHeader title={t('agents.title')} meta={meta}>
        <BubbleTip title={t('guide.open')} text={t('agents.tipGuide')}><IconButton label={t('guide.open')} onClick={guide} data-testid="agents-guide"><BookOpen /></IconButton></BubbleTip>
        <BubbleTip title={t('agents.tipUpdatesTitle')} text={t('agents.tipUpdates')}><IconButton label={t('agents.tipUpdatesTitle')} onClick={searchUpdates} disabled={searching} data-testid="agents-check-all"><RefreshCw className={searching ? 'animate-spin' : undefined} /></IconButton></BubbleTip>
        <DropdownMenu modal={false}>
          <BubbleTip title={t('nav.more')}><DropdownMenuTrigger asChild><MoreButton data-testid="agents-more" /></DropdownMenuTrigger></BubbleTip>
          <DropdownMenuContent align="end" className="w-48"><DropdownMenuItem onSelect={recheck} data-testid="agents-refresh"><RefreshCw />{t('agents.checkAll')}</DropdownMenuItem></DropdownMenuContent>
        </DropdownMenu>
      </PageHeader>
      <PageBody className="pt-5 pb-10 md:pb-28">
        <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-4">
          <AgentsUsageTabs current="agents" />
          <LoginDialog reload={reload} windows={windows} />
          <ToolsBlock team={team} agents={agents} renderUpdate={(a) => <InstallButton a={a} />} />
          {system && !windows && !system.git ? (
            <Note tone="warning" className="items-center">
              <div className="flex items-center gap-3"><div className="min-w-0 flex-1"><div className="text-body font-medium">{t('agents.noGit')}</div><div className="text-muted-foreground text-caption">{t('agents.noGitDesc')}</div></div>
                <Button size="sm" variant="outline" onClick={() => bridge.openExternal('https://git-scm.com/download/win')}><ExternalLink />{t('agents.getGit')}</Button></div>
            </Note>
          ) : null}
          <Block title={t('agents.mineTitle')} count={agents ? mine.length : null} data-testid="agents-mine">
            {!agents ? <ListCard className="flex items-center justify-center py-6"><Spinner /></ListCard>
              : mine.length ? <ListCard>{mine.map((a) => <AgentRow key={a.id} a={a} reload={reload} usage={usage} team={team} today={today} />)}</ListCard>
                : <p className="text-muted-foreground text-control">{t('agents.mineEmpty')}</p>}
          </Block>
          {available.length ? (
            <Block title={t('agents.addTitle')} count={available.length} note={t('agents.addNote')} data-testid="agents-add">
              <div className="grid items-start gap-3 min-[700px]:grid-cols-2 min-[1000px]:grid-cols-3 [&>*]:min-w-0">
                {available.map((a) => <AgentFicha key={a.id} a={a} reload={reload} team={team} />)}
              </div>
            </Block>
          ) : null}
        </div>
      </PageBody>
    </>
  );
}

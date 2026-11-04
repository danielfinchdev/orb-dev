// 3.7 (WS4): Orb Server in the app. docs/SERVER.md, docs/BOTS.md › «One home per bot», src/engine/hub.mjs.
// - Magic Link › Orb Server: «Añadir Orb Server» (one command to paste in the server's terminal, its one-line summary,
//   «Hacerlo a mano», the pairing live) and, once linked, the Server with its state, «Configurar», «Ver navegador del
//   Server» and «Desenlazar» (bring the bots back / leave them there / cancel).
// - The guide after pairing (a stepper): the Server's own Claude / ChatGPT sign-in (windowless, from here), «¿Dónde
//   quieres que se ejecuten tus bots?» (all to the Server, recommended / pick / leave them here, with progress and a
//   report), who is who when there are other users, and the optional password vault and browser logins.
// - Under the Server card (still Magic Link): its state (version, memory, engines, update), Optimus, its browser and «Contraseñas» (the vault:
//   a Bitwarden-compatible account made for Orb; secrets are typed once and never shown again).
// - «Ver navegador del Server»: the live view (components/browser-live.jsx), a dialog on the PC, the whole screen on a phone.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Server, Copy, Check, LoaderCircle, TerminalSquare, ExternalLink, ChevronDown, Unplug, Settings2, Compass, Bot, Users, KeyRound, CircleCheck, Circle, ArrowRight, ArrowLeft, TriangleAlert, Cpu, RefreshCw, Download, Gauge, ShieldCheck, Trash2, LogIn, Ellipsis, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Badge, Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter, Field, Input, Spinner } from '@/components/ui/basic.jsx';
import { Dialog, DialogContent, DialogTitle, DialogDescription, Select, Switch, Checkbox, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, BubbleTip } from '@/components/ui/overlay.jsx';
import { PageHeader } from '@/components/page.jsx';
import { BrowserLive } from '@/components/browser-live.jsx';
import { AgentIcon } from '@/components/agent-icon.jsx';
import { PersonDot } from '@/components/person-menu.jsx';
import { choose } from '@/components/dialogs.jsx';
import { useStore, call, act, bridge, setState, loadCentro, phoneLayout, openSettings } from '@/lib/store.js';
import { useServer, useHomes, loadServer, loadServerGuide, loadHomes, serverHome, serverCall, serverListen, hasCap, openBrowserLive, closeBrowserLive, homesChanged, onServer } from '@/lib/server.js';
import { movableHere, planMove, moveReport, mappingRows, guideSteps, firstOpenStep, tn } from '@/lib/homes.js';
import { countdown } from '@/lib/bots.js';
import { moveBot, offerMerge } from './bots/home.jsx';
import { useBots, BotFace } from './bots/common.jsx';
import { AUTHOR } from '../../core/product.mjs';
import { cn, ago, errorText } from '@/lib/utils.js';
import { useT, t as tNow } from '@/lib/i18n.js';
import { toast } from 'sonner';

const DOCS = `https://github.com/${AUTHOR.repo}/blob/main/docs/SERVER.md`;
const agentName = (a) => (a === 'codex' ? 'ChatGPT' : a === 'claude' ? 'Claude' : a);
const Dot = ({ on }) => { const t = useT(); return <span className={cn('size-2 shrink-0 rounded-full', on ? 'bg-success' : 'bg-muted-foreground/40')} role="img" aria-label={on ? t('link.online') : t('link.offline')} />; };

function CopyButton({ text, label, testid }) {
  const t = useT();
  const [done, setDone] = useState(false);
  useEffect(() => { if (!done) return undefined; const id = setTimeout(() => setDone(false), 1500); return () => clearTimeout(id); }, [done]);
  if (!navigator.clipboard) return null;
  return <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(text).then(() => setDone(true)).catch(() => {})} data-testid={testid}>{done ? <Check className="text-success" /> : <Copy />}{done ? t('link.copied') : label ?? t('link.copy')}</Button>;
}
function CommandBox({ command, testid = 'server-command' }) {
  return <pre className="bg-muted/70 max-h-40 overflow-auto rounded-lg border px-3 py-2.5 font-mono text-[12px] leading-relaxed break-all whitespace-pre-wrap select-all" data-testid={testid}>{command}</pre>;
}

// ---------------------------------------------------------------- Magic Link › Orb Server
// A command was handed out on this screen: when the Server comes back paired, the guide opens (whichever part of the app
// learns it first: this card's own check, or link:peers in main.jsx).
let pairing = false;
function AddServerCard() {
  const t = useT();
  const [code, setCode] = useState(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [manual, setManual] = useState(false);
  const [short, setShort] = useState({ code: '', address: '' });
  const [linking, setLinking] = useState(false);
  useEffect(() => { if (!code) return undefined; const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, [code]);
  // While the command is out: is the Server there yet? (link.server.status every 2 s; link:peers says it sooner)
  useEffect(() => {
    if (!code) return undefined;
    let alive = true;
    const check = async () => { const s = await loadServer(); if (alive && s?.linked) setCode(null); };
    const id = setInterval(check, 2000);
    const off = bridge.on('*', (event) => { if (event === 'link:peers' || event === 'link:status') check(); });
    return () => { alive = false; clearInterval(id); off(); };
  }, [code]); // eslint-disable-line react-hooks/exhaustive-deps
  const make = async () => { setBusy(true); const r = await act(call('link.server.code', {})); setBusy(false); if (r) { pairing = true; setCode(r); setNow(Date.now()); } };
  const cancel = () => { pairing = false; call('link.server.cancelCode').catch(() => {}); setCode(null); setManual(false); };
  const connect = async () => {
    setLinking(true);
    const r = await act(call('link.connect', { code: short.code.trim().toUpperCase(), address: /^https?:\/\//i.test(short.address.trim()) ? short.address.trim() : `http://${short.address.trim()}` }));
    setLinking(false);
    if (r) { loadCentro(); await loadServer(); }
  };
  const expired = code && now >= code.expiresAt;
  return (
    <Card data-testid="server-add" className={code ? 'border-primary/50' : undefined}>
      <CardHeader className="flex-row items-start gap-3"><Server className="text-primary mt-0.5 size-5 shrink-0" /><div><CardTitle>{t('server.addTitle')}</CardTitle><CardDescription>{t('server.addHint')}</CardDescription></div></CardHeader>
      <CardContent className="grid gap-3">
        {!code ? (
          <div><Button onClick={make} disabled={busy} aria-busy={busy} data-testid="server-add-go">{busy ? <LoaderCircle className="animate-spin" /> : <TerminalSquare />}{t('server.addButton')}</Button></div>
        ) : expired ? (
          <div className="flex flex-wrap items-center gap-2"><span className="text-muted-foreground text-sm">{t('server.codeExpired')}</span><Button size="sm" onClick={make} disabled={busy}>{t('link.again')}</Button></div>
        ) : (
          <div className="animate-in fade-in-0 grid gap-3 duration-200" data-testid="server-code">
            <p className="text-sm font-medium">{t('server.pasteHere')}</p>
            <CommandBox command={code.command} />
            <div className="flex flex-wrap items-center gap-2">
              <CopyButton text={code.command} label={t('server.copyCommand')} testid="server-copy" />
              <span className="text-muted-foreground text-xs">{t('server.commandDoes')}</span>
            </div>
            {code.ready === false ? <p className="text-warning flex items-start gap-1.5 text-xs" role="alert"><TriangleAlert className="mt-0.5 size-3.5 shrink-0" />{t('server.notReady')}</p> : null}
            <div className="bg-muted/40 flex items-center gap-2 rounded-lg px-3 py-2 text-[13px]" role="status" data-testid="server-waiting">
              <Spinner className="size-3.5" /><span className="min-w-0 flex-1">{t('server.waiting')}</span>
              <span className="text-muted-foreground text-xs tabular-nums">{t('server.expiresIn', { time: countdown(code.expiresAt, now) })}</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Button size="xs" variant="ghost" aria-expanded={manual} onClick={() => setManual(!manual)} data-testid="server-manual"><ChevronDown className={cn('transition-transform duration-150', manual && 'rotate-180')} />{t('server.manual')}</Button>
              <Button size="xs" variant="ghost" onClick={() => bridge.openExternal(DOCS).catch(() => {})}><ExternalLink />{t('server.docs')}</Button>
              <Button size="xs" variant="ghost" className="ml-auto" onClick={cancel}><X />{t('link.close')}</Button>
            </div>
            {manual ? (
              <div className="animate-in fade-in-0 grid gap-3 rounded-xl border p-3 duration-150" data-testid="server-steps">
                <ol className="grid list-decimal gap-2 pl-5 text-[13px]">
                  {(code.steps ?? []).map((s, i) => <li key={i} className="grid gap-1.5"><span>{t(s.key)}</span>{s.cmd ? <CommandBox command={s.cmd} testid={`server-step-${i + 1}`} /> : null}</li>)}
                </ol>
                <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr_auto] sm:items-end">
                  <Field label={t('server.shortCode')}><Input value={short.code} onChange={(e) => setShort({ ...short, code: e.target.value })} placeholder="ABCD-EFGH" autoCapitalize="characters" autoCorrect="off" spellCheck={false} data-testid="server-short-code" /></Field>
                  <Field label={t('link.address')}><Input value={short.address} onChange={(e) => setShort({ ...short, address: e.target.value })} placeholder="192.168.1.20:3131" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} /></Field>
                  <Button size="sm" variant="outline" onClick={connect} disabled={linking || !short.code.trim() || !short.address.trim()}>{linking ? <LoaderCircle className="animate-spin" /> : null}{t('link.connect')}</Button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// The linked Orb Server: its name and state, what needs updating, and what can be done with it.
function ServerCard({ server }) {
  const t = useT();
  const p = server.peer ?? {};
  const live = hasCap(server, 'browser.live.v1');
  const moved = (server.handoffs ?? []).filter((h) => h.status === 'done').length;
  return (
    <Card data-testid="server-card">
      <CardHeader className="flex-row items-center gap-3">
        <div className="bg-primary/12 text-primary grid size-10 shrink-0 place-items-center rounded-xl"><Server className="size-5" /></div>
        <div className="min-w-0 flex-1">
          <CardTitle className="flex min-w-0 items-center gap-2"><span className="truncate" data-testid="server-name">{p.name}</span><Dot on={p.online} /></CardTitle>
          <CardDescription className="truncate">{[p.online ? t('link.onNow') : p.lastSeen ? t('link.seen', { when: ago(p.lastSeen) }) : t('link.offline'), p.version ? t('server.version', { v: p.version }) : null, moved ? tn(t, 'server.devicesMoved', moved) : null].filter(Boolean).join(' · ')}</CardDescription>
        </div>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild><Button size="icon-sm" variant="ghost" aria-label={t('server.more')} data-testid="server-more"><Ellipsis /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem variant="destructive" onSelect={() => askUnlinkServer({ id: p.id, name: p.name })} data-testid="server-unlink"><Unplug />{t('link.unlink')}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>
      {server.skew ? (
        <CardContent className="grid gap-2">
          <p className="text-warning flex items-start gap-1.5 text-[13px]" role="alert" data-testid="server-skew"><TriangleAlert className="mt-0.5 size-4 shrink-0" />{server.skew.message}</p>
          {server.skew.command ? <><CommandBox command={server.skew.command} testid="server-upgrade" /><div><CopyButton text={server.skew.command} label={t('server.copyCommand')} /></div></> : null}
        </CardContent>
      ) : null}
      <CardFooter className="flex-wrap">
        <Button size="sm" onClick={() => setState({ serverGuideOpen: { step: null } })} data-testid="server-guide-open"><Sparkles />{t('server.setup')}</Button>
        {live ? <Button size="sm" variant="outline" disabled={!p.online} onClick={() => openBrowserLive()} data-testid="server-browser-open"><Compass />{t('browserLive.open')}</Button> : null}
      </CardFooter>
    </Card>
  );
}

// Ajustes › Magic Link › Orb Server (the PC, or a browser marked «Puede administrar» with the PC's layout).
export function ServerLinkSection() {
  const t = useT();
  const server = useServer();
  useEffect(() => {
    if (!server?.linked || !pairing) return;
    pairing = false;
    toast.success(t('server.paired', { name: server.peer?.name ?? 'Orb Server' }));
    loadServerGuide(); setState({ serverGuideOpen: { step: null, first: true } });
  }, [server?.linked]); // eslint-disable-line react-hooks/exhaustive-deps
  if (bridge.mobile || server === undefined) return null;
  return server?.linked ? <><ServerCard server={server} /><ServerSettingsCards inline /></> : <AddServerCard />;
}

// «Desenlazar»: the bots that run there come back first (default), stay there (here a frozen copy with «Restaurar aquí»),
// or nothing happens.
export async function askUnlinkServer(peer) {
  const t = tNow;
  const pick = await choose(t('server.unlinkTitle', { name: peer.name }), t('server.unlinkBody'), [
    { value: 'bring', label: t('server.unlinkBring'), hint: t('server.unlinkBringHint') },
    { value: 'leave', label: t('server.unlinkLeave'), hint: t('server.unlinkLeaveHint') }
  ], { testid: 'server-unlink-dialog' });
  if (!pick) return false;
  const id = toast.loading(pick === 'bring' ? t('server.unlinkBringing') : t('server.unlinking'));
  let ok = false;
  try { const r = await call('bots.unlink', { peer: peer.id, mode: pick }); ok = r?.ok !== false; if (!ok) toast.error(t('server.unlinkFailed', { name: (r?.report ?? []).find((x) => !x.ok)?.name ?? '' })); }
  catch (e) {
    // An Orb without the bots' homes: the link alone.
    try { await call('link.disconnect', { id: peer.id }); ok = true; } catch { toast.error(errorText(e)); }
  }
  toast.dismiss(id);
  if (ok) toast.success(t('server.unlinked', { name: peer.name }));
  loadCentro(); loadServer(); homesChanged();
  return ok;
}

// ---------------------------------------------------------------- the guide after pairing
const STEP_ICON = { agents: KeyRound, bots: Bot, persons: Users, vault: ShieldCheck, browser: Compass };
export function ServerGuideHost() {
  const open = useStore((s) => s.serverGuideOpen);
  if (!open || bridge.mobile) return null;
  return <ServerGuide open={open} onClose={() => setState({ serverGuideOpen: null })} />;
}
function ServerGuide({ open, onClose }) {
  const t = useT();
  const guide = useStore((s) => s.serverGuide);
  const me = useStore((s) => s.me);
  const server = useStore((s) => s.server);
  useEffect(() => { loadServerGuide(); }, []);
  const steps = useMemo(() => guideSteps(guide, { personsCount: me?.personsCount ?? 1 }), [guide, me?.personsCount]);
  const [at, setAt] = useState(null);
  const [done, setDone] = useState(() => new Set()); // steps finished here (the guide's own answer comes later)
  const finish = (id) => setDone((d) => new Set(d).add(id));
  useEffect(() => { if (at == null && steps.length) setAt(open.step ? Math.max(0, steps.findIndex((s) => s.id === open.step)) : firstOpenStep(steps)); }, [steps.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const i = at ?? 0;
  const step = steps[i];
  const last = i >= steps.length - 1;
  const body = !guide ? <div className="grid place-items-center py-16"><Spinner /></div>
    : step?.id === 'agents' ? <AgentsStep step={step} focus={open.agent} />
      : step?.id === 'bots' ? <BotsStep step={step} onDone={() => finish('bots')} />
        : step?.id === 'persons' ? <PersonsStep onDone={() => finish('persons')} />
          : step?.id === 'vault' ? <VaultStep onClose={onClose} />
            : step?.id === 'browser' ? <BrowserStep onClose={onClose} /> : null;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent data-sheet="full" className="flex max-h-[92vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl" data-testid="server-guide">
        <div className="grid gap-1 border-b px-6 pt-5 pb-4">
          <DialogTitle>{open.first ? t('server.guideFirst', { name: server?.peer?.name ?? 'Orb Server' }) : t('server.guideTitle')}</DialogTitle>
          <DialogDescription>{t('server.guideHint')}</DialogDescription>
          <ol className="mt-3 flex flex-wrap gap-1.5" aria-label={t('server.guideSteps')}>
            {steps.map((s, n) => {
              const Icon = STEP_ICON[s.id] ?? Circle;
              return (
                <li key={s.id}>
                  <button type="button" onClick={() => setAt(n)} aria-current={n === i ? 'step' : undefined} data-testid={`guide-step-${s.id}`}
                    className={cn('press flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12.5px] transition-colors', n === i ? 'border-primary bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-accent/60')}>
                    {s.done || done.has(s.id) ? <CircleCheck className="text-success size-3.5" /> : <Icon className="size-3.5" />}{t(`server.step.${s.id}`)}
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5" key={step?.id}>{body}</div>
        <div className="flex items-center gap-2 border-t px-6 py-3">
          {i > 0 ? <Button variant="ghost" onClick={() => setAt(i - 1)}><ArrowLeft />{t('server.back')}</Button> : null}
          <span className="flex-1" />
          {last ? <Button onClick={onClose} data-testid="guide-done">{t('server.finish')}</Button>
            : <Button variant={step?.done || done.has(step?.id) ? 'default' : 'outline'} onClick={() => setAt(i + 1)} data-testid="guide-next">{step?.done || done.has(step?.id) || step?.optional ? t('server.next') : t('server.skip')}<ArrowRight /></Button>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// «Conectar tu Claude / ChatGPT al Server»: the Server's own sign-in, started here; its link opens in this PC's browser.
function AgentsStep({ step, focus }) {
  const t = useT();
  const agents = step.agents ?? [];
  return (
    <div className="grid gap-4" data-testid="guide-agents">
      <div className="grid gap-1"><h3 className="text-[16px] font-medium">{t('server.agentsTitle')}</h3><p className="text-muted-foreground text-[13px]">{t('server.agentsHint')}</p></div>
      {!agents.length ? <p className="text-muted-foreground text-sm">{t('server.agentsNone')}</p> : agents.map((a) => <ServerLogin key={a.agent} a={a} autoStart={focus === a.agent} />)}
    </div>
  );
}
function ServerLogin({ a, autoStart }) {
  const t = useT();
  const [login, setLogin] = useState(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const started = useRef(false);
  const start = async () => {
    setBusy(true);
    const r = await act(call('link.server.login', { agent: a.agent, mode: a.agent === 'claude' ? 'web' : 'device' }));
    setBusy(false);
    if (!r) return;
    setLogin(r);
    if (r.url) bridge.openExternal(r.url).catch(() => {});
  };
  useEffect(() => { if (autoStart && !a.signedIn && !started.current) { started.current = true; start(); } }, [autoStart]); // eslint-disable-line react-hooks/exhaustive-deps
  // Its state, from the Server (its own events stay there).
  useEffect(() => {
    if (!login?.id) return undefined;
    const id = setInterval(async () => {
      let s; try { s = await call('link.server.loginState', { id: login.id }); } catch { return; }
      if (s?.state === 'hecho') { setLogin(null); toast.success(t('agents.loginDone', { label: agentName(a.agent) })); loadServerGuide(); }
      else if (s?.state === 'error' || s?.state === 'cancelado') { setLogin(null); if (s.message) toast.error(s.message); }
      else if (s) setLogin((cur) => (cur ? { ...cur, ...s } : cur));
    }, 2000);
    return () => clearInterval(id);
  }, [login?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const send = async () => { if (await act(call('link.server.loginCode', { id: login.id, code: code.trim() }))) setCode(''); };
  const cancel = () => { call('link.server.loginCancel', { id: login.id }).catch(() => {}); setLogin(null); };
  return (
    <div className={cn('grid gap-3 rounded-xl border p-3.5', login && 'border-primary/50')} data-testid={`server-login-${a.agent}`}>
      <div className="flex items-center gap-3">
        <AgentIcon agent={a.agent} className="size-6 shrink-0" />
        <div className="min-w-0 flex-1"><div className="text-[14px] font-medium">{agentName(a.agent)}</div><div className="text-muted-foreground text-xs">{a.signedIn ? t('server.signedIn') : a.installed === false ? t('server.engineLater') : t('server.notSignedIn')}</div></div>
        {a.signedIn ? <Badge variant="success"><Check />{t('server.connected')}</Badge>
          : login ? <Button size="xs" variant="ghost" onClick={cancel}>{t('agents.loginCancel')}</Button>
            : <Button size="sm" onClick={start} disabled={busy} data-testid={`server-login-start-${a.agent}`}>{busy ? <LoaderCircle className="animate-spin" /> : <LogIn />}{t('agents.login')}</Button>}
      </div>
      {login ? (
        <div className="grid gap-2.5 pl-9 text-[13px]">
          <p className="text-muted-foreground">{login.code ? t('agents.loginDevice') : t('server.loginOpened')}</p>
          {login.code ? <div className="flex items-center gap-2"><span className="bg-muted rounded-lg px-3 py-1.5 font-mono text-lg tracking-widest select-all" data-testid="server-login-code">{login.code}</span><CopyButton text={login.code} label={t('agents.loginCopyCode')} /></div> : null}
          <div className="flex flex-wrap items-center gap-2">
            {login.url ? <Button size="xs" variant="outline" onClick={() => bridge.openExternal(login.url).catch(() => {})}><ExternalLink />{t('agents.loginOpenBrowser')}</Button> : null}
            <span className="text-muted-foreground flex items-center gap-1.5 text-xs"><Spinner className="size-3" />{t('agents.loginWaiting')}</span>
          </div>
          {login.needsCode ? (
            <Field label={t('agents.loginPasteHint')}>
              <div className="flex gap-2"><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder={t('agents.loginPastePh')} autoCapitalize="none" autoCorrect="off" spellCheck={false} onKeyDown={(e) => { if (e.key === 'Enter' && code.trim()) send(); }} data-testid="server-login-paste" /><Button size="sm" variant="outline" disabled={!code.trim()} onClick={send}>{t('agents.loginSend')}</Button></div>
            </Field>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// «¿Dónde quieres que se ejecuten tus bots?»: all to the Server (recommended), pick which, or leave them here. Each bot is
// moved in turn (two-phase copy, checked, then its home changes; this PC keeps a copy); then what to do next.
export function BotsStep({ step, onDone }) {
  const t = useT();
  const { bots } = useBots();
  const homes = useHomes();
  const me = useStore((s) => s.me?.person?.id ?? null);
  const here = useMemo(() => movableHere(bots, me), [bots, me]);
  const target = serverHome(homes);
  const [choice, setChoice] = useState('all');
  const [picked, setPicked] = useState(() => new Set());
  const [run, setRun] = useState(null); // { ids, results: Map, current, done }
  const ids = planMove(here, choice, [...picked]);
  const go = async () => {
    if (!target) { toast.error(t('server.offlineNow')); return; }
    if (choice === 'none') { setRun({ ids: [], results: new Map(), done: true, left: true }); onDone?.(); return; }
    const state = { ids, results: new Map(), current: null, done: false };
    setRun({ ...state });
    for (const id of ids) {
      const bot = here.find((b) => b.id === id); if (!bot) continue;
      state.current = id; setRun({ ...state, results: new Map(state.results) });
      const r = await moveBot(bot, { key: target.key, name: target.name, server: true, here: false }, { quiet: true });
      state.results.set(id, { id, name: bot.name, ...(r ?? { ok: false, failed: 'cancelled' }) });
    }
    state.current = null; state.done = true;
    setRun({ ...state, results: new Map(state.results) });
    onDone?.();
    loadServerGuide(); loadHomes();
  };
  if (run?.done) return <MoveReport run={run} target={target} />;
  if (run) {
    const total = run.ids.length; const done = run.results.size;
    return (
      <div className="grid gap-4" data-testid="guide-bots-progress">
        <div className="grid gap-1"><h3 className="text-[16px] font-medium">{tn(t, 'server.movingTitle', total)}</h3><p className="text-muted-foreground text-[13px]">{t('server.movingHint')}</p></div>
        <div className="bg-muted h-1.5 overflow-hidden rounded-full" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}><div className="bg-primary h-full rounded-full transition-[width] duration-300" style={{ width: `${total ? (done / total) * 100 : 0}%` }} /></div>
        <div className="grid gap-1">
          {run.ids.map((id) => { const b = here.find((x) => x.id === id) ?? { id, name: '' }; const r = run.results.get(id); return (
            <div key={id} className="flex items-center gap-3 rounded-lg px-2 py-1.5" data-testid={`move-row-${b.name}`}>
              <BotFace bot={b} size={28} still /><span className="min-w-0 flex-1 truncate text-[14px]">{b.name}</span>
              {r ? (r.ok ? <CircleCheck className="text-success size-4" aria-label={t('server.moved')} /> : <TriangleAlert className="text-warning size-4" aria-label={t('server.notMoved')} />) : run.current === id ? <Spinner className="size-4" /> : <Circle className="text-muted-foreground/50 size-4" />}
            </div>
          ); })}
        </div>
      </div>
    );
  }
  if (!here.length) return (
    <div className="grid gap-2" data-testid="guide-bots">
      <h3 className="text-[16px] font-medium">{t('server.botsTitle')}</h3>
      <p className="text-muted-foreground text-[13px]">{step?.done && bots.some((b) => b.homeKind === 'server') ? t('server.botsAllThere') : t('server.botsNone')}</p>
    </div>
  );
  const option = (value, label, hint, extra = null) => (
    <label className={cn('press flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition-colors', choice === value ? 'border-primary bg-primary/5' : 'hover:bg-accent/50')} data-testid={`bots-choice-${value}`}>
      <input type="radio" name="bots-choice" className="accent-primary mt-1 size-4 shrink-0" checked={choice === value} onChange={() => setChoice(value)} />
      <span className="min-w-0 flex-1"><span className="flex items-center gap-2 text-[14px] font-medium">{label}{extra}</span><span className="text-muted-foreground block text-[12.5px]">{hint}</span></span>
    </label>
  );
  return (
    <div className="grid gap-4" data-testid="guide-bots">
      <div className="grid gap-1"><h3 className="text-[16px] font-medium">{tn(t, 'server.botsAsk', here.length)}</h3><p className="text-muted-foreground text-[13px]">{t('server.botsHint')}</p></div>
      <div className="grid gap-2" role="radiogroup" aria-label={t('server.botsTitle')}>
        {option('all', t('server.botsAll'), t('server.botsAllHint'), <Badge variant="info">{t('server.recommended')}</Badge>)}
        {option('pick', t('server.botsPick'), t('server.botsPickHint'))}
        {choice === 'pick' ? (
          <div className="animate-in fade-in-0 grid gap-0.5 rounded-xl border p-2 duration-150" data-testid="bots-pick-list">
            {here.map((b) => (
              <label key={b.id} className="hover:bg-accent/50 flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-2 py-1">
                <Checkbox checked={picked.has(b.id)} onCheckedChange={(v) => setPicked((s) => { const n = new Set(s); if (v) n.add(b.id); else n.delete(b.id); return n; })} data-testid={`bots-pick-${b.name}`} />
                <BotFace bot={b} size={26} still /><span className="min-w-0 flex-1 truncate text-[14px]">{b.name}</span>
              </label>
            ))}
          </div>
        ) : null}
        {option('none', t('server.botsNone2'), t('server.botsNoneHint'))}
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={go} disabled={choice === 'pick' && !ids.length} data-testid="bots-move-go">{choice === 'none' ? t('server.botsKeep') : tn(t, 'server.botsMove', ids.length)}</Button>
        {!target?.online && choice !== 'none' ? <span className="text-warning text-xs">{t('server.offlineNow')}</span> : null}
      </div>
    </div>
  );
}
function MoveReport({ run, target }) {
  const t = useT();
  const rep = moveReport([...run.results.values()]);
  if (run.left) return <div className="grid gap-2" data-testid="guide-bots-report"><h3 className="text-[16px] font-medium">{t('server.botsLeft')}</h3><p className="text-muted-foreground text-[13px]">{t('server.botsNoneHint')}</p></div>;
  return (
    <div className="grid gap-4" data-testid="guide-bots-report">
      <div className="flex items-start gap-3">
        <CircleCheck className={cn('mt-0.5 size-5 shrink-0', rep.failed.length ? 'text-warning' : 'text-success')} />
        <div className="grid gap-1"><h3 className="text-[16px] font-medium">{tn(t, 'server.reportMoved', rep.ok.length, { name: target?.name ?? 'Orb Server' })}</h3><p className="text-muted-foreground text-[13px]">{t('server.reportCopy')}</p></div>
      </div>
      {rep.failed.length ? <ReportBlock icon={TriangleAlert} tone="warn" title={t('server.reportFailed')} items={rep.failed.map((f) => f.name)} /> : null}
      {rep.sites.length ? <ReportBlock icon={Compass} title={t('server.reportSites')} items={rep.sites} action={<Button size="xs" variant="outline" onClick={() => openBrowserLive()}><Compass />{t('browserLive.open')}</Button>} /> : null}
      {rep.missing.length || rep.ha ? <ReportBlock icon={TriangleAlert} title={t('server.reportMissing')} items={[...rep.missing, ...(rep.ha ? ['Home Assistant'] : [])]} note={t('server.reportMissingHint')} /> : null}
      {rep.sameName.map((s) => (
        <div key={s.uid} className="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2.5 text-[13px]" data-testid="report-same-name">
          <span className="min-w-0 flex-1">{t('server.reportSame', { name: s.name })}</span>
          <Button size="xs" variant="outline" onClick={() => offerMerge({ id: s.id, name: s.name }, { uid: s.other, name: s.otherName })}>{t('home.sameMerge')}</Button>
        </div>
      ))}
    </div>
  );
}
function ReportBlock({ icon: Icon, title, items, note, action, tone }) {
  return (
    <div className={cn('grid gap-2 rounded-xl border px-3.5 py-3', tone === 'warn' && 'border-warning/40 bg-warning/5')}>
      <div className="flex items-center gap-2 text-[13.5px] font-medium"><Icon className="text-muted-foreground size-4" /><span className="flex-1">{title}</span>{action}</div>
      <div className="flex flex-wrap gap-1.5">{items.map((x) => <span key={x} className="bg-muted rounded-full px-2.5 py-0.5 text-[12.5px]">{x}</span>)}</div>
      {note ? <p className="text-muted-foreground text-[12px]">{note}</p> : null}
    </div>
  );
}

// Who is who: each user of this app other than the admin is someone on the Server (chosen by the admin; never by name).
function PersonsStep({ onDone }) {
  const t = useT();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const load = () => call('link.server.persons').then((d) => { setData(d); setError(''); }).catch((e) => setError(errorText(e)));
  useEffect(() => { load(); }, []);
  const rows = mappingRows(data);
  useEffect(() => { if (data && rows.every((r) => r.mappedTo)) onDone?.(); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async (row, value) => {
    const r = value === '__none' ? await act(call('link.server.unmap', { local: row.id })) : value === '__new' ? await act(call('link.server.map', { local: row.id, createThere: true }), t('server.mapCreated', { name: row.name })) : await act(call('link.server.map', { local: row.id, remote: value }), t('server.mapSaved', { name: row.name }));
    if (r) load();
  };
  return (
    <div className="grid gap-4" data-testid="guide-persons">
      <div className="grid gap-1"><h3 className="text-[16px] font-medium">{t('server.personsTitle')}</h3><p className="text-muted-foreground text-[13px]">{t('server.personsHint')}</p></div>
      {error ? <p className="text-destructive text-sm" role="alert">{error}</p> : !data ? <Spinner /> : !rows.length ? <p className="text-muted-foreground text-sm">{t('server.personsNone')}</p> : (
        <div className="bg-card divide-y rounded-xl border">
          {rows.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-3 px-3.5 py-2.5" data-testid={`map-row-${r.name}`}>
              <PersonDot name={r.name} /><span className="min-w-0 flex-1 truncate text-[14px] font-medium">{r.name}</span>
              <Select className="w-full sm:w-60" value={r.mappedTo ?? '__none'} onValueChange={(v) => save(r, v)} title={t('server.personsTitle')} data-testid={`map-select-${r.name}`}
                options={[...r.choices.map((c) => ({ value: c.value, label: t('server.mapSame', { name: c.label }) })), { value: '__new', label: t('server.mapNew') }, { value: '__none', label: t('server.mapNone') }]} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
function VaultStep({ onClose }) {
  const t = useT();
  return (
    <div className="grid gap-3" data-testid="guide-vault">
      <h3 className="text-[16px] font-medium">{t('server.vaultTitle')}</h3>
      <p className="text-muted-foreground text-[13px]">{t('server.vaultHint')}</p>
      <div><Button variant="outline" onClick={() => { onClose(); openSettings('servidor:contrasenas'); }}><KeyRound />{t('server.vaultOpen')}</Button></div>
    </div>
  );
}
function BrowserStep() {
  const t = useT();
  return (
    <div className="grid gap-3" data-testid="guide-browser">
      <h3 className="text-[16px] font-medium">{t('server.browserTitle')}</h3>
      <p className="text-muted-foreground text-[13px]">{t('server.browserHint')}</p>
      <div><Button variant="outline" onClick={() => openBrowserLive()}><Compass />{t('browserLive.open')}</Button></div>
    </div>
  );
}

// ---------------------------------------------------------------- the Server's state and vault (Magic Link › Orb Server)
function useServerStatus() {
  const [st, setSt] = useState(null);
  const [error, setError] = useState('');
  const load = () => serverCall('server.status', {}).then((s) => { setSt(s); setError(''); }).catch((e) => setError(errorText(e)));
  useEffect(() => { load(); const id = setInterval(load, 30_000); return () => clearInterval(id); }, []);
  return { st, error, load };
}
const mb = (bytes) => Math.round((Number(bytes) || 0) / 1048576);
function StatusCard() {
  const t = useT();
  const { st, error, load } = useServerStatus();
  const [busy, setBusy] = useState(null);
  const update = st?.update ?? null;
  const available = update?.available ?? null; // { version, name, sha256, size } or null
  const check = async () => { setBusy('check'); await act(serverCall('server.update.check', {})); setBusy(null); load(); };
  const apply = async () => { setBusy('apply'); if (await act(serverCall('server.update.apply', {}), t('server.updating'))) load(); setBusy(null); };
  const install = async (id) => { setBusy(id); await act(serverCall('server.engines.install', { id }), t('server.engineInstalled', { name: agentName(id) })); setBusy(null); load(); };
  return (
    <Card data-testid="server-status">
      <CardHeader className="flex-row items-start gap-3"><Server className="text-primary mt-0.5 size-5 shrink-0" /><div className="min-w-0 flex-1"><CardTitle>{t('server.statusTitle')}</CardTitle><CardDescription>{st ? t('server.statusLine', { v: st.version, uptime: uptime(st.uptime, t) }) : error || t('server.loading')}</CardDescription></div>
        <BubbleTip title={t('server.refresh')}><Button size="icon-sm" variant="ghost" aria-label={t('server.refresh')} onClick={load}><RefreshCw /></Button></BubbleTip>
      </CardHeader>
      {st ? (
        <CardContent className="grid gap-4">
          <div className="grid gap-2 sm:grid-cols-3">
            <Stat icon={Gauge} label={t('server.memory')} value={t('server.mb', { n: mb(st.memory?.rss) })} />
            <Stat icon={Cpu} label={t('server.system')} value={`${st.platform === 'linux' ? 'Linux' : st.platform} · ${st.arch}`} />
            <Stat icon={ShieldCheck} label={t('server.admin')} value={st.admin?.sudo ? t('server.adminOn') : t('server.adminOff')} />
          </div>
          <div className="grid gap-1.5">
            <div className="text-muted-foreground text-[12px] font-medium">{t('server.engines')}</div>
            <div className="bg-card divide-y rounded-xl border">
              {(st.engines ?? []).map((e) => (
                <div key={e.id} className="flex items-center gap-3 px-3.5 py-2" data-testid={`server-engine-${e.id}`}>
                  {['claude', 'codex'].includes(e.id) ? <AgentIcon agent={e.id} className="size-4" /> : <Compass className="text-muted-foreground size-4" />}
                  <span className="min-w-0 flex-1 truncate text-[13.5px]">{e.label ?? agentName(e.id)}</span>
                  {e.installed ? <span className="text-muted-foreground text-xs tabular-nums">{e.version ? `v${e.version}` : t('server.installed')}</span>
                    : <Button size="xs" variant="outline" disabled={Boolean(busy)} onClick={() => install(e.id)}>{busy === e.id ? <Spinner className="size-3" /> : <Download />}{t('server.install')}</Button>}
                </div>
              ))}
              {!(st.engines ?? []).length ? <p className="text-muted-foreground px-3.5 py-2 text-[13px]">{t('server.enginesNone')}</p> : null}
            </div>
            <p className="text-muted-foreground text-[12px]">{t('server.enginesHint')}</p>
          </div>
        </CardContent>
      ) : null}
      {st ? (
        <CardFooter className="flex-wrap">
          {available ? <><Badge variant="info" data-testid="server-update-available">{t('server.updateAvailable', { v: available.version })}</Badge><Button size="sm" onClick={apply} disabled={Boolean(busy)} data-testid="server-update-apply">{busy === 'apply' || update?.applying ? <Spinner className="size-3.5" /> : <Download />}{t('server.updateApply')}</Button></>
            : <><span className="text-muted-foreground text-xs">{t('server.upToDate')}</span><Button size="sm" variant="ghost" onClick={check} disabled={Boolean(busy)}>{busy === 'check' ? <Spinner className="size-3.5" /> : <RefreshCw />}{t('server.updateCheck')}</Button></>}
        </CardFooter>
      ) : null}
    </Card>
  );
}
const uptime = (s, t) => { const n = Number(s) || 0; return n >= 86400 ? tn(t, 'server.days', Math.floor(n / 86400)) : n >= 3600 ? tn(t, 'server.hours', Math.floor(n / 3600)) : tn(t, 'server.minutes', Math.max(1, Math.floor(n / 60))); };
function Stat({ icon: Icon, label, value }) {
  return <div className="bg-muted/40 grid gap-0.5 rounded-xl px-3 py-2"><span className="text-muted-foreground flex items-center gap-1.5 text-[12px]"><Icon className="size-3.5" />{label}</span><span className="text-[14px] font-medium tabular-nums">{value}</span></div>;
}
// Optimus (Open Control Edge): made once on its own; this turns that off (the same setting as Avanzado › Herramientas).
function OptimusCard() {
  const t = useT();
  const c = useStore((s) => s.app?.config);
  if (!c || onServer()) return null;
  const save = async (optimus) => { const config = await act(call('config.save', { patch: { oce: { optimus } } }), optimus ? t('settings.oceOptimusOn') : t('settings.oceOptimusOff')); if (config) setState((s) => ({ app: s.app ? { ...s.app, config } : s.app })); };
  return (
    <Card data-testid="server-optimus">
      <CardContent>
        <label className="flex cursor-pointer items-center justify-between gap-4"><div><div className="text-sm">{t('settings.oceOptimus')}</div><div className="text-muted-foreground text-xs">{t('settings.oceOptimusHint')}</div></div>
          <Switch checked={c.oce?.optimus !== false} onCheckedChange={save} data-testid="server-oce-optimus" /></label>
      </CardContent>
    </Card>
  );
}
function BrowserCard() {
  const t = useT();
  const server = useStore((s) => s.server);
  if (!hasCap(server, 'browser.live.v1')) return null;
  return (
    <Card data-testid="server-browser">
      <CardHeader className="flex-row items-start gap-3"><Compass className="text-primary mt-0.5 size-5 shrink-0" /><div><CardTitle>{t('server.browserTitle')}</CardTitle><CardDescription>{t('server.browserHint')}</CardDescription></div></CardHeader>
      <CardFooter><Button size="sm" variant="outline" onClick={() => openBrowserLive()} data-testid="server-browser-live"><Compass />{t('browserLive.open')}</Button></CardFooter>
    </Card>
  );
}

// «Contraseñas»: a Bitwarden or Vaultwarden account made only for Orb, with only what is shared with it. The API key and
// the master password are typed once (never shown again, never in a log); then its state, «Probar», «Olvidar».
export function VaultCard() {
  const t = useT();
  const [st, setSt] = useState(null);
  const [f, setF] = useState({ server: '', clientId: '', clientSecret: '', password: '', collection: 'Orb' });
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const load = () => serverCall('vault.status', {}).then(setSt).catch((e) => setSt({ error: errorText(e) }));
  useEffect(() => { load(); }, []);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const connect = async (e) => {
    e.preventDefault(); setBusy('setup'); setError('');
    try { const r = await serverCall('vault.setup', { ...f, server: f.server.trim(), clientId: f.clientId.trim(), clientSecret: f.clientSecret.trim(), collection: f.collection.trim() || 'Orb' }); setSt({ allowed: true, available: true, configured: true, ...r }); toast.success(t('vault.connectedOk')); }
    catch (err) { setError(errorText(err)); }
    finally { setF((x) => ({ ...x, clientSecret: '', password: '' })); setBusy(null); }
  };
  const test = async () => { setBusy('test'); const r = await act(serverCall('vault.test', {}), t('vault.testOk')); setBusy(null); if (r) load(); };
  const forget = async () => {
    const pick = await choose(t('vault.forget'), t('vault.forgetConfirm'), [{ value: 'yes', label: t('vault.forgetOk'), variant: 'destructive' }]);
    if (pick !== 'yes') return;
    setBusy('forget'); await act(serverCall('vault.forget', {}), t('vault.forgotten')); setBusy(null); load();
  };
  const cloud = /bitwarden\.(com|eu)/i.test(f.server) || st?.cloud;
  const head = <CardHeader className="flex-row items-start gap-3"><KeyRound className="text-primary mt-0.5 size-5 shrink-0" /><div><CardTitle>{t('vault.title')}</CardTitle><CardDescription>{t('vault.intro')}</CardDescription></div></CardHeader>;
  if (!st) return <Card data-testid="vault-card">{head}<CardContent><Spinner /></CardContent></Card>;
  if (st.error && st.configured === undefined) return <Card data-testid="vault-card">{head}<CardContent><p className="text-muted-foreground text-sm">{st.error}</p></CardContent></Card>;
  if (st.allowed === false) return <Card data-testid="vault-card">{head}<CardContent><p className="text-muted-foreground text-sm">{t('msg.vault.notAllowed')}</p></CardContent></Card>;
  if (st.available === false) return <Card data-testid="vault-card">{head}<CardContent><p className="text-muted-foreground text-sm">{t('msg.vault.err.vault_off')}</p></CardContent></Card>;
  if (st.configured) return (
    <Card data-testid="vault-card">
      {head}
      <CardContent className="grid gap-3">
        <div className="flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5" data-testid="vault-state">
          {st.error ? <TriangleAlert className="text-warning mt-0.5 size-4 shrink-0" /> : <CircleCheck className="text-success mt-0.5 size-4 shrink-0" />}
          <div className="min-w-0 text-[13.5px]">
            <div className="font-medium">{t('vault.connected', { server: st.server ?? '', n: st.items ?? 0, collection: st.collection ?? 'Orb' })}</div>
            <div className="text-muted-foreground text-[12px]">{st.error ? t(`msg.vault.err.${st.error}`) : st.syncedAt ? t('vault.lastSync', { when: ago(st.syncedAt) }) : t('vault.notSynced')}</div>
          </div>
        </div>
        <SitesList sites={st.approvals ?? st.sites ?? []} />
        <p className="text-muted-foreground text-[12px]">{st.cloud ? t('vault.note.cloud') : t('vault.note.local')} {t('vault.cards')}</p>
      </CardContent>
      <CardFooter className="flex-wrap">
        <Button size="sm" variant="outline" onClick={test} disabled={Boolean(busy)} data-testid="vault-test">{busy === 'test' ? <Spinner className="size-3.5" /> : <RefreshCw />}{t('vault.test')}</Button>
        <Button size="sm" variant="danger" onClick={forget} disabled={Boolean(busy)} data-testid="vault-forget"><Trash2 />{t('vault.forget')}</Button>
      </CardFooter>
    </Card>
  );
  return (
    <Card data-testid="vault-card">
      {head}
      <form onSubmit={connect} className="contents" autoComplete="off">
        <CardContent className="grid gap-4">
          <p className="bg-muted/40 rounded-xl px-3.5 py-2.5 text-[13px]">{t('vault.howTo')}</p>
          <Field label={t('vault.server')} hint={t('vault.serverHint')}><Input value={f.server} onChange={set('server')} placeholder="https://vault.casa.lan" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} data-testid="vault-server" /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('vault.clientId')}><Input value={f.clientId} onChange={set('clientId')} placeholder="user.xxxxxxxx-…" autoCapitalize="none" autoCorrect="off" spellCheck={false} data-testid="vault-client-id" /></Field>
            <Field label={t('vault.clientSecret')}><Input type="password" value={f.clientSecret} onChange={set('clientSecret')} autoComplete="new-password" data-testid="vault-client-secret" /></Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('vault.password')}><Input type="password" value={f.password} onChange={set('password')} autoComplete="new-password" data-testid="vault-password" /></Field>
            <Field label={t('vault.collection')}><Input value={f.collection} onChange={set('collection')} maxLength={100} data-testid="vault-collection" /></Field>
          </div>
          {error ? <p className="text-destructive text-sm" role="alert" data-testid="vault-error">{error}</p> : null}
          <ul className="text-muted-foreground grid list-disc gap-1 pl-5 text-[12px]" data-testid="vault-notes">
            <li>{cloud ? t('vault.note.cloud') : t('vault.note.local')}</li>
            {cloud ? <li>{t('vault.note.freeOrg')}</li> : null}
            <li>{t('vault.note.serverKey')}</li>
            <li>{t('vault.note.blast')}</li>
            {st.argon2 === false ? <li>{t('vault.note.argon2')}</li> : null}
          </ul>
        </CardContent>
        <CardFooter><Button type="submit" size="sm" disabled={busy === 'setup' || !f.server.trim() || !f.clientId.trim() || !f.clientSecret || !f.password} data-testid="vault-connect">{busy === 'setup' ? <Spinner className="size-3.5 border-white/40 border-t-white" /> : <ShieldCheck />}{t('vault.connect')}</Button></CardFooter>
      </form>
    </Card>
  );
}
// The sites where a bot may already sign in with the vault (approved once on its card; the next times only a notice).
function SitesList({ sites }) {
  const t = useT();
  return (
    <div className="grid gap-1.5" data-testid="vault-sites">
      <div className="text-muted-foreground text-[12px] font-medium">{t('vault.sites')}</div>
      {sites.length ? (
        <div className="bg-card divide-y rounded-xl border">{sites.map((s) => <div key={`${s.host}:${s.at ?? ''}`} className="flex items-center gap-3 px-3.5 py-2 text-[13.5px]"><Compass className="text-muted-foreground size-4" /><span className="min-w-0 flex-1 truncate">{s.host}</span>{s.at ? <span className="text-muted-foreground text-xs">{ago(s.at)}</span> : null}</div>)}</div>
      ) : <p className="text-muted-foreground text-[12.5px]">{t('vault.sitesNone')}</p>}
    </div>
  );
}

// Its state, Optimus, its browser (the phone; on the PC the Server card has the button) and «Contraseñas» (the Server's vault):
// under the Server card in Ajustes › Magic Link › Orb Server (inline), or the phone's own screen.
export function ServerSettingsCards({ inline = false }) {
  const t = useT();
  const server = useServer();
  if (server === undefined) return <Spinner />;
  if (!server?.linked) return <Card><CardContent className="text-muted-foreground text-sm">{t('server.notLinkedHint')}</CardContent></Card>;
  const vault = hasCap(server, 'vault.v1') || server.direct;
  return (
    <>
      <StatusCard />
      {inline ? <OptimusCard /> : <BrowserCard />}
      {vault ? <div id="settings-contrasenas" className="grid scroll-mt-4 [&>*]:min-w-0" data-testid="settings-group-contrasenas"><VaultCard /></div> : null}
    </>
  );
}
// The phone's own screen («Orb Server» in ☰) when it is linked to the Server.
export function ServerView() {
  const t = useT();
  return (
    <>
      <PageHeader icon={<Server className="text-primary size-5" />} title={t('server.title')} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5"><div className="mx-auto grid max-w-xl gap-4"><ServerSettingsCards /></div></div>
    </>
  );
}

// ---------------------------------------------------------------- «Ver navegador del Server»
export function BrowserLiveHost() {
  const t = useT();
  const live = useStore((s) => s.browserLive);
  if (!live) return null;
  const phone = phoneLayout();
  const view = <BrowserLive key={live.at} url={live.url} onClose={closeBrowserLive} call={(m, p) => serverCall(m, p)} listen={serverListen} className={cn('min-h-0 flex-1', phone ? 'pt-[env(safe-area-inset-top)]' : 'rounded-2xl')} />;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) closeBrowserLive(); }}>
      <DialogContent data-sheet="full" showClose={false} aria-describedby={undefined} className={phone ? 'flex h-full flex-col gap-0 p-0' : 'flex h-[min(860px,90vh)] w-[min(1100px,94vw)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none'} data-testid="browser-live-dialog">
        <DialogTitle className="sr-only">{t('browserLive.title')}</DialogTitle>
        {view}
      </DialogContent>
    </Dialog>
  );
}

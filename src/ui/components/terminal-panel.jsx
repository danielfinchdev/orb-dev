// the user's terminal docked under a chat, in that chat's folder (src/engine/host/user-terminal.mjs). One tab
// per terminal open in this folder; a line typed (or pasted from a command of the chat) runs only when the user presses
// Enter. «Abrir fuera» opens the usual terminal of Ctrl+J in the same folder. This PC's window only.
import { useEffect, useRef, useState } from 'react';
import { Plus, X, SquareArrowOutUpRight, SquareTerminal, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Tip } from '@/components/ui/overlay.jsx';
import { call, act, bridge } from '@/lib/store.js';
import { stripAnsi } from '@/lib/terminal-paste.js';
import { notifyInfo } from '@/lib/notify.js';
import { useT } from '@/lib/i18n.js';
import { cn } from '@/lib/utils.js';
import { quiet } from '@/lib/quiet.js';

const KEEP = 200 * 1024;
// The most tabs the docked variant shows: the engine's own limit (user-terminal.mjs › MAX_TERMINALS).
const MAX_TABS = 4;
const READONLY = 'readonly';

// The shells God mode's docks opened and have not managed to close yet. Closing is refused while Orb is locked, so the
// ids stay here (they are not forgotten) and are closed after the password; a dock that mounts again takes its own back.
const dockOwned = new Set();
const claimed = new Set(); // the ones a mounted dock shows
let watching = false;
async function sweep() {
  let all; try { all = await call('terminal.list'); } catch { return; }
  const alive = new Set((all ?? []).map((x) => x.id));
  for (const id of [...dockOwned]) {
    if (!alive.has(id)) { dockOwned.delete(id); continue; }
    if (!claimed.has(id)) call('terminal.close', { id }).then(() => dockOwned.delete(id)).catch(quiet);
  }
}
function track(id) {
  dockOwned.add(id); claimed.add(id);
  if (!watching) { watching = true; bridge.on('master:unlocked', sweep); }
}

// dock: God mode's panel (full width under the viewer, tabs in its header). The terminals are the same ones, opened
// with the same calls; what it adds is only layout, tab names, a read-only tab (`readonly`: { label, content }) and
// `launch` ({ n, name, command }): a new tab with the command in its input line, which still waits for the user's Enter.
// The terminals this panel opened are closed with it: no process outlives the tabs that show it.
export function TerminalPanel({ dir, draft, onDraftTaken, onClose, dock = false, readonly = null, launch = null }) {
  const t = useT();
  const [terms, setTerms] = useState([]); // { id, cwd, running, out }
  const [active, setActive] = useState(null);
  const [lines, setLines] = useState({}); // the input line is per tab: id -> text
  const [cmds, setCmds] = useState({}); // id -> the command of the action that filled that tab's line
  const [history, setHistory] = useState([]); const [back, setBack] = useState(-1);
  const [names, setNames] = useState({}); // id -> the action's name, for a tab opened from an action
  const [folded, setFolded] = useState(false);
  const [ready, setReady] = useState(!dock);
  const out = useRef(null); const input = useRef(null);
  const line = lines[active] ?? '';
  const setLine = (v, id = active) => setLines((p) => ({ ...p, [id]: v }));
  const pending = useRef(null); const opened = useRef(new Set()); const gone = useRef(false); const launched = useRef(0);
  const mine = (x) => x.cwd.toLowerCase() === String(dir).toLowerCase();
  const openNew = async (name) => {
    const r = await act(call('terminal.open', { dir }));
    if (!r) return r;
    if (gone.current) { call('terminal.close', { id: r.id }).catch(quiet); return r; }
    opened.current.add(r.id); track(r.id);
    if (name) setNames((p) => ({ ...p, [r.id]: name }));
    setTerms((p) => [...p, r]); setActive(r.id);
    return r;
  };
  useEffect(() => {
    if (!dock) return undefined;
    gone.current = false;
    return () => {
      gone.current = true;
      for (const id of opened.current) { claimed.delete(id); call('terminal.close', { id }).then(() => dockOwned.delete(id)).catch(quiet); }
      opened.current.clear();
    };
  }, [dock]);
  useEffect(() => {
    let alive = true;
    setReady(!dock);
    call('terminal.list').then(async (all) => {
      if (!alive) return;
      const here = (all ?? []).filter(mine);
      // a shell this dock opened before and could not close (Orb was locked) comes back as one of its own tabs
      if (dock) for (const x of here) if (dockOwned.has(x.id)) { opened.current.add(x.id); claimed.add(x.id); }
      if (here.length) { setTerms(here); setActive(here.at(-1).id); } else if (!(launch && launched.current !== launch.n)) await openNew();
      if (alive) setReady(true);
    }).catch(quiet);
    const offData = bridge.on('terminal:data', ({ id, data }) => setTerms((p) => p.map((x) => (x.id === id ? { ...x, out: (x.out + data).slice(-KEEP) } : x))));
    const offExit = bridge.on('terminal:exit', ({ id }) => setTerms((p) => p.map((x) => (x.id === id ? { ...x, running: false } : x))));
    // Orb's lock screen: the output goes from the window (the engine keeps it and sends nothing) and comes back after the
    // password.
    const offLock = bridge.on('master:locked', (e) => { if (e?.screen) setTerms((p) => p.map((x) => ({ ...x, out: '' }))); });
    const offUnlock = bridge.on('master:unlocked', () => call('terminal.list').then((all) => { if (alive) setTerms((p) => p.map((x) => ({ ...x, ...((all ?? []).find((y) => y.id === x.id) ?? {}) }))); }).catch(quiet));
    return () => { alive = false; offData(); offExit(); offLock(); offUnlock(); };
  }, [dir]); // eslint-disable-line react-hooks/exhaustive-deps
  // A command pasted from the chat: into the input line, never run.
  useEffect(() => {
    if (!draft) return;
    const target = active === READONLY || active == null ? terms.at(-1)?.id ?? null : active;
    if (target != null) setLine(draft, target); else pending.current = draft;
    onDraftTaken?.(); setFolded(false);
    if (target !== active) setActive(target);
    input.current?.focus();
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps
  const term = terms.find((x) => x.id === active) ?? null;
  // A command that arrived before any tab existed goes into the first one.
  useEffect(() => { if (pending.current != null && term) { setLine(pending.current, term.id); pending.current = null; } }, [term?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // An action chosen by the user: its own tab, with the command in the input line (shown, never run until Enter).
  useEffect(() => {
    if (!dock || !ready || !launch || launched.current === launch.n) return;
    launched.current = launch.n; setFolded(false);
    if (terms.length >= MAX_TABS) { notifyInfo(t('msg.terminal.tooMany')); return; }
    openNew(launch.name).then((r) => { if (r) { setLine(launch.command, r.id); setCmds((p) => ({ ...p, [r.id]: launch })); setBack(-1); setTimeout(() => input.current?.focus(), 0); } });
  }, [launch?.n, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  // Opened from the chat's ⋯ (its menu hands the focus back to ⋯ as it closes): the keys go to the terminal once its shell
  // is ready, so the user can type straight away.
  const focused = useRef(false);
  useEffect(() => { if (term?.running && !focused.current) { focused.current = true; input.current?.focus(); } }, [term?.running]);
  useEffect(() => { const el = out.current; if (el) el.scrollTop = el.scrollHeight; }, [term?.out]);
  const send = async () => {
    if (!term) return;
    const text = line;
    setTerms((p) => p.map((x) => (x.id === term.id ? { ...x, out: `${x.out}> ${text}\n` } : x)));
    setLine('', term.id); setCmds((p) => ({ ...p, [term.id]: undefined })); setBack(-1); if (text.trim()) setHistory((h) => [...h.filter((x) => x !== text), text].slice(-50));
    await act(call('terminal.write', { id: term.id, text }));
  };
  const close = async (id) => {
    await act(call('terminal.close', { id }));
    opened.current.delete(id); claimed.delete(id); dockOwned.delete(id);
    const rest = terms.filter((x) => x.id !== id);
    setTerms(rest); setActive(rest.at(-1)?.id ?? null);
    if (!rest.length) onClose();
  };
  const key = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); send(); return; }
    if (e.key === 'ArrowUp' && history.length) { e.preventDefault(); const i = back < 0 ? history.length - 1 : Math.max(0, back - 1); setBack(i); setLine(history[i]); }
    if (e.key === 'ArrowDown' && back >= 0) { e.preventDefault(); const i = back + 1; if (i >= history.length) { setBack(-1); setLine(''); } else { setBack(i); setLine(history[i]); } }
  };
  if (dock) {
    const win = !window.orb?.platform || window.orb.platform === 'win32';
    let plain = 0;
    const labelOf = (x) => { if (names[x.id]) return names[x.id]; plain += 1; return win ? (plain > 1 ? `PowerShell ${plain}` : 'PowerShell') : t('terminal.tab', { n: plain }); };
    const mark = (x, label) => (x.running ? label : `${label} · ${t('terminal.ended')}`);
    const tab = (id, label, testid) => (
      <button key={id} type="button" role="tab" aria-selected={active === id} onClick={() => { setActive(id); setFolded(false); }} data-testid={testid}
        className={cn('ptab hover:text-foreground focus-visible:outline-ring inline-flex h-(--ctl-sm) max-w-52 min-w-0 cursor-pointer items-center rounded-[calc(var(--r-ctl)-2px)] px-2 text-control outline-none focus-visible:outline-2', active === id ? 'bg-accent text-foreground' : 'text-muted-foreground')}>
        <span className="truncate">{label}</span>
      </button>
    );
    return (
      <div className={cn('border-border bg-secondary flex shrink-0 flex-col border-t', folded ? '' : 'h-42')} data-testid="terminal-panel" data-dock="true">
        <div className={cn('flex items-center gap-0.5 px-2 py-1', folded ? '' : 'border-border border-b')}>
          <SquareTerminal className="text-muted-foreground mx-1 size-4 shrink-0" />
          <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]" role="tablist" aria-label={t('terminal.tabs')} data-testid="terminal-tabs">
            {terms.map((x) => tab(x.id, mark(x, labelOf(x)), `terminal-tab-${x.id}`))}
            {readonly ? tab(READONLY, readonly.label, 'terminal-tab-task') : null}
          </div>
          <span className="grow" />
          <Tip label={t('terminal.new')}><Button variant="ghost" size="icon-xs" aria-label={t('terminal.new')} disabled={terms.length >= MAX_TABS} onClick={() => { setFolded(false); openNew(); }} data-testid="terminal-new"><Plus /></Button></Tip>
          <Tip label={t('terminal.close')}><Button variant="ghost" size="icon-xs" aria-label={t('terminal.close')} disabled={!term} onClick={() => term && close(term.id)} data-testid="terminal-close"><X /></Button></Tip>
          <Tip label={t(folded ? 'terminal.show' : 'terminal.hide')}><Button variant="ghost" size="icon-xs" aria-label={t(folded ? 'terminal.show' : 'terminal.hide')} aria-expanded={!folded} onClick={() => setFolded(!folded)} data-testid="terminal-fold">{folded ? <ChevronUp /> : <ChevronDown />}</Button></Tip>
        </div>
        {folded ? null : active === READONLY && readonly ? (
          <div className="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-xs leading-[1.6] whitespace-pre-wrap select-text" data-testid="terminal-task-output">{readonly.content}</div>
        ) : (<>
          <pre ref={out} className="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-xs leading-[1.6] whitespace-pre-wrap select-text" data-testid="terminal-output">{stripAnsi(term?.out ?? '')}</pre>
          {term && cmds[term.id] && line === cmds[term.id].command ? (
            <div className="border-border border-t px-3 py-1 font-mono text-xs break-all whitespace-pre-wrap select-text" data-testid="terminal-action-command">
              {cmds[term.id].command}
              {cmds[term.id].preview ? <span className="text-muted-foreground block">{t('terminal.previewWindow')}</span> : null}
            </div>
          ) : null}
          <div className="border-border flex items-center gap-2 border-t px-3 py-1 font-mono text-xs">
            <span className="text-muted-foreground">&gt;</span>
            <input ref={input} value={line} title={line} onChange={(e) => setLine(e.target.value)} onKeyDown={key} disabled={!term?.running} spellCheck={false} autoComplete="off"
              className="min-w-0 flex-1 bg-transparent outline-none" placeholder={t('terminal.placeholder')} aria-label={t('terminal.input')} data-testid="terminal-input" />
          </div>
        </>)}
      </div>
    );
  }
  return (
    <div className="mx-auto w-full max-w-3xl shrink-0 px-5 pb-2" data-testid="terminal-panel">
      <div className="bg-card overflow-hidden rounded-xl border">
        <div className="flex items-center gap-1 border-b px-2 py-1">
          <SquareTerminal className="text-muted-foreground mx-1 size-4 shrink-0" />
          {terms.map((x, i) => (
            <span key={x.id} className={cn('flex items-center gap-1 rounded-md px-2 py-0.5 text-xs', x.id === active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60')}>
              <button type="button" className="cursor-pointer" onClick={() => setActive(x.id)}>{t('terminal.tab', { n: i + 1 })}{x.running ? '' : ` · ${t('terminal.ended')}`}</button>
              <button type="button" className="cursor-pointer opacity-60 hover:opacity-100" aria-label={t('terminal.close')} onClick={() => close(x.id)}><X className="size-3" /></button>
            </span>
          ))}
          <Tip label={t('terminal.new')}><Button variant="ghost" size="icon-sm" aria-label={t('terminal.new')} onClick={openNew}><Plus /></Button></Tip>
          <span className="ml-auto" />
          <Tip label={t('terminal.outside')}><Button variant="ghost" size="icon-sm" aria-label={t('terminal.outside')} onClick={() => act(call('app.openTerminal', { dir }))}><SquareArrowOutUpRight /></Button></Tip>
          <Tip label={t('terminal.hide')}><Button variant="ghost" size="icon-sm" aria-label={t('terminal.hide')} onClick={onClose}><X /></Button></Tip>
        </div>
        <pre ref={out} className="h-56 overflow-auto px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap select-text" data-testid="terminal-output">{stripAnsi(term?.out ?? '')}</pre>
        <div className="flex items-center gap-2 border-t px-3 py-1.5 font-mono text-xs">
          <span className="text-muted-foreground">&gt;</span>
          <input ref={input} value={line} onChange={(e) => setLine(e.target.value)} onKeyDown={key} disabled={!term?.running} spellCheck={false} autoComplete="off"
            className="min-w-0 flex-1 bg-transparent outline-none" placeholder={t('terminal.placeholder')} aria-label={t('terminal.input')} data-testid="terminal-input" />
        </div>
      </div>
    </div>
  );
}

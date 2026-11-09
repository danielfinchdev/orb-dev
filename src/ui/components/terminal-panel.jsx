// 3.8.2 (T3 3.2): the user's terminal docked under a chat, in that chat's folder (src/engine/user-terminal.mjs). One tab
// per terminal open in this folder; a line typed (or pasted from a command of the chat) runs only when the user presses
// Enter. «Abrir fuera» opens the usual terminal of Ctrl+J in the same folder. This PC's window only.
import { useEffect, useRef, useState } from 'react';
import { Plus, X, SquareArrowOutUpRight, SquareTerminal } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Tip } from '@/components/ui/overlay.jsx';
import { call, act, bridge } from '@/lib/store.js';
import { stripAnsi } from '@/lib/terminal-paste.js';
import { useT } from '@/lib/i18n.js';
import { cn } from '@/lib/utils.js';

const KEEP = 200 * 1024;

export function TerminalPanel({ dir, draft, onDraftTaken, onClose }) {
  const t = useT();
  const [terms, setTerms] = useState([]); // { id, cwd, running, out }
  const [active, setActive] = useState(null);
  const [line, setLine] = useState('');
  const [history, setHistory] = useState([]); const [back, setBack] = useState(-1);
  const out = useRef(null); const input = useRef(null);
  const mine = (x) => x.cwd.toLowerCase() === String(dir).toLowerCase();
  const openNew = async () => { const r = await act(call('terminal.open', { dir })); if (r) { setTerms((p) => [...p, r]); setActive(r.id); } return r; };
  useEffect(() => {
    let alive = true;
    call('terminal.list').then(async (all) => {
      if (!alive) return;
      const here = (all ?? []).filter(mine);
      if (here.length) { setTerms(here); setActive(here.at(-1).id); } else await openNew();
    }).catch(() => {});
    const offData = bridge.on('terminal:data', ({ id, data }) => setTerms((p) => p.map((x) => (x.id === id ? { ...x, out: (x.out + data).slice(-KEEP) } : x))));
    const offExit = bridge.on('terminal:exit', ({ id }) => setTerms((p) => p.map((x) => (x.id === id ? { ...x, running: false } : x))));
    // Orb's lock screen: the output goes from the window (the engine keeps it and sends nothing) and comes back after the
    // password.
    const offLock = bridge.on('master:locked', (e) => { if (e?.screen) setTerms((p) => p.map((x) => ({ ...x, out: '' }))); });
    const offUnlock = bridge.on('master:unlocked', () => call('terminal.list').then((all) => { if (alive) setTerms((p) => p.map((x) => ({ ...x, ...((all ?? []).find((y) => y.id === x.id) ?? {}) }))); }).catch(() => {}));
    return () => { alive = false; offData(); offExit(); offLock(); offUnlock(); };
  }, [dir]); // eslint-disable-line react-hooks/exhaustive-deps
  // A command pasted from the chat: into the input line, never run.
  useEffect(() => { if (draft) { setLine(draft); onDraftTaken?.(); input.current?.focus(); } }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps
  const term = terms.find((x) => x.id === active) ?? null;
  useEffect(() => { const el = out.current; if (el) el.scrollTop = el.scrollHeight; }, [term?.out]);
  const send = async () => {
    if (!term) return;
    const text = line;
    setTerms((p) => p.map((x) => (x.id === term.id ? { ...x, out: `${x.out}> ${text}\n` } : x)));
    setLine(''); setBack(-1); if (text.trim()) setHistory((h) => [...h.filter((x) => x !== text), text].slice(-50));
    await act(call('terminal.write', { id: term.id, text }));
  };
  const close = async (id) => {
    await act(call('terminal.close', { id }));
    const rest = terms.filter((x) => x.id !== id);
    setTerms(rest); setActive(rest.at(-1)?.id ?? null);
    if (!rest.length) onClose();
  };
  const key = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); send(); return; }
    if (e.key === 'ArrowUp' && history.length) { e.preventDefault(); const i = back < 0 ? history.length - 1 : Math.max(0, back - 1); setBack(i); setLine(history[i]); }
    if (e.key === 'ArrowDown' && back >= 0) { e.preventDefault(); const i = back + 1; if (i >= history.length) { setBack(-1); setLine(''); } else { setBack(i); setLine(history[i]); } }
  };
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

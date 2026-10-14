// 2.7: two pieces of the assistant's chat. LiveActivity: what the assistant is doing right now («Leyendo claude.mjs ·
// 1 min 3 s»), with the steps of the turn when unfolded. QuestionCard: a question with options (orb_ask) answered with a
// click, the number keys or own words, or skipped.
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Check, X } from 'lucide-react';
import { Button } from './ui/button.jsx';
import { Spinner } from './ui/basic.jsx';
import { call, act } from '@/lib/store.js';
import { cn } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';

// What a tool does, by its name (Claude, Codex, Cursor and the ACP agents name them differently).
const KIND = [
  [/^(read|read_file|view|cat|open_file)$/i, 'read'], [/^(grep|glob|search|find|ls|list_dir|codebase_search|file_search)/i, 'search'],
  [/^(bash|shell|exec|command|run|terminal|powershell)/i, 'run'], [/^(edit|write|multiedit|notebookedit|apply_patch|create_file|str_replace)/i, 'edit'],
  [/^(webfetch|websearch|fetch|web_search|browse)/i, 'web'], [/^orb_create_task$/, 'task'], [/^orb_(board|list_tasks|get_task|wait_tasks)$/, 'board'],
  [/^orb_read_log$/, 'readLog'], [/^orb_write_log$/, 'writeLog'], [/^orb_ask$/, 'ask'], [/^orb_(set_project|create_project|add_project)$/, 'project'],
  [/^orb_schedule$/, 'schedule'], [/^orb_browser_/, 'browser'], [/^orb_(send_message|read_messages)$/, 'messages'], [/^(todowrite|todo)/i, 'plan'], [/^(task|agent|delegate)/i, 'delegate'],
  // 3.2.1: the agent looking up its own tools, and Opti Bot's
  [/^tool_?search$/i, 'tools'], [/^opti_propose$/, 'propose'], [/^opti_/, 'pc']
];
const WITH_TARGET = new Set(['read', 'search', 'run', 'edit', 'web']);
// «mcp__orb__orb_ask», «orb:orb_ask», «orb-orb_ask» → «orb_ask» (how each agent names the tools of a server).
export const bareTool = (name) => String(name ?? '').replace(/^mcp__[^_]+(?:_[^_]+)*?__/, '').replace(/^(orb|opti)[:-](?=(orb|opti)_)/, '');
const kindOf = (name) => KIND.find(([re]) => re.test(name))?.[1] ?? 'other';
export function stepText(t, step) {
  const name = bareTool(step.name);
  const kind = kindOf(name);
  if (WITH_TARGET.has(kind)) return step.target ? t(`chat.act.${kind}`, { target: step.target }) : t(`chat.act.${kind}Any`);
  if (kind !== 'other') return t(`chat.act.${kind}`);
  // An unknown tool: its name only when it reads as a word (never «mcp__…» or «server_tool_name»).
  return /^[A-Za-z][A-Za-z ]{1,30}$/.test(name) ? t('chat.act.other', { name }) : t('chat.act.otherAny');
}
const elapsed = (t, ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return t('chat.act.sec', { s });
  if (s < 3600) return t('chat.act.min', { m: Math.floor(s / 60), s: s % 60 });
  return t('chat.act.hour', { h: Math.floor(s / 3600), m: Math.floor((s % 3600) / 60) });
};

export function LiveActivity({ chat }) {
  const t = useT();
  const [now, setNow] = useState(Date.now());
  const [open, setOpen] = useState(false);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  const steps = Array.isArray(chat.tools) ? chat.tools.filter((s) => s && typeof s === 'object') : [];
  const last = steps.at(-1);
  const label = last ? stepText(t, last) : chat.partial ? t('chat.act.writing') : t('chat.thinking');
  return (
    <div className="text-muted-foreground mt-1 grid gap-1 text-[13px]" data-testid="chat-activity">
      <button type="button" className="hover:text-foreground flex min-w-0 cursor-pointer items-center gap-2 text-left" onClick={() => setOpen(!open)} aria-expanded={open} disabled={!steps.length}>
        <Spinner className="size-3.5 shrink-0" />
        <span className="text-foreground/85 min-w-0 truncate">{label}</span>
        {chat.since ? <span className="shrink-0 tabular-nums opacity-80">{elapsed(t, now - chat.since)}</span> : null}
        {chat.queued ? <span className="shrink-0">· {t('chat.queued', { n: chat.queued })}</span> : null}
        {steps.length ? <ChevronRight className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')} /> : null}
      </button>
      {open ? (
        <ol className="border-border/70 ml-1.5 grid gap-0.5 border-l pl-3 text-[12.5px]" data-testid="chat-activity-steps">
          {steps.map((s, i) => <li key={`${s.at}-${i}`} className="flex min-w-0 gap-2"><span className="min-w-0 flex-1 truncate">{stepText(t, s)}</span>{chat.since ? <span className="shrink-0 tabular-nums opacity-70">{elapsed(t, s.at - chat.since)}</span> : null}</li>)}
        </ol>
      ) : null}
    </div>
  );
}

export function QuestionCard({ m }) {
  const t = useT();
  const q = m.meta;
  const [picked, setPicked] = useState([]);
  const [other, setOther] = useState('');
  const [folded, setFolded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(q.status !== 'pending' ? { status: q.status, answer: q.answer } : null);
  const box = useRef(null); const otherRef = useRef(null);
  useEffect(() => { if (q.status !== 'pending') setDone({ status: q.status, answer: q.answer }); }, [q.status, q.answer]);
  const choose = (label) => setPicked((p) => (q.multi ? (p.includes(label) ? p.filter((x) => x !== label) : [...p, label]) : p[0] === label ? [] : [label]));
  const ready = picked.length > 0 || other.trim().length > 0;
  const send = async (skip = false) => {
    if (busy || (!skip && !ready)) return;
    setBusy(true);
    const r = await act(call('chat.answer', { id: m.id, choices: picked, other: other.trim(), skip }));
    setBusy(false);
    if (r !== undefined) setDone({ status: skip ? 'skipped' : 'answered', answer: [...picked, ...(other.trim() ? [other.trim()] : [])].join(' · ') });
  };
  // 1…4 pick an option, the next number writes your own, Ctrl+Enter sends (in the text box too).
  const keys = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); send(); return; }
    if (e.target.tagName === 'TEXTAREA' || e.ctrlKey || e.altKey || e.metaKey) return;
    const n = Number(e.key);
    if (n >= 1 && n <= q.options.length) { e.preventDefault(); choose(q.options[n - 1].label); }
    else if (n === q.options.length + 1) { e.preventDefault(); otherRef.current?.focus(); }
  };
  if (done) return (
    <div className="chat-glass mx-auto w-full max-w-[92%]" data-testid="question-card">
      <div className="flex items-start gap-2 text-[13.5px]">
        <span className="min-w-0 flex-1"><span className="font-medium">{q.question}</span>
          <span className="text-muted-foreground mt-1 flex items-center gap-1.5 text-[13px]">{done.status === 'skipped' ? <><X className="size-3.5" />{t('chat.q.skipped')}</> : <><Check className="text-success size-3.5" />{done.answer}</>}</span>
        </span>
      </div>
    </div>
  );
  return (
    <div ref={box} tabIndex={-1} onKeyDown={keys} className="chat-glass question-card mx-auto w-full max-w-[92%] outline-none" data-testid="question-card">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {q.header ? <div className="text-primary mb-0.5 text-[11px] font-semibold tracking-wide uppercase">{q.header}</div> : null}
          <div className="text-[14.5px] leading-snug font-semibold">{q.question}</div>
        </div>
        <Button size="icon-xs" variant="ghost" onClick={() => setFolded(!folded)} aria-label={folded ? t('chat.q.unfold') : t('chat.q.fold')} aria-expanded={!folded}><ChevronDown className={cn('transition-transform', folded && '-rotate-90')} /></Button>
        <Button size="icon-xs" variant="ghost" onClick={() => send(true)} aria-label={t('chat.q.skip')} disabled={busy}><X /></Button>
      </div>
      {folded ? null : (<>
        <div className="mt-3 grid gap-1.5" role={q.multi ? 'group' : 'radiogroup'} aria-label={q.question}>
          {q.options.map((o, i) => {
            const on = picked.includes(o.label);
            return (
              <button key={o.label} type="button" role={q.multi ? 'checkbox' : 'radio'} aria-checked={on} onClick={() => choose(o.label)} data-testid={`question-option-${i + 1}`}
                className={cn('question-option flex w-full cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors', on ? 'border-primary bg-primary/8 ring-primary/25 ring-2' : 'bg-card/50 hover:bg-accent/50')}>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-medium">{o.label}</span>
                  {o.description ? <span className="text-muted-foreground mt-0.5 block text-[12.5px] leading-snug">{o.description}</span> : null}
                </span>
                <kbd className={cn('mt-0.5 grid size-6 shrink-0 place-items-center rounded-md border text-[11px] font-semibold', on ? 'border-primary text-primary' : 'text-muted-foreground')}>{i + 1}</kbd>
              </button>
            );
          })}
          <div className={cn('question-option grid gap-2 rounded-xl border px-3.5 py-2.5', other.trim() ? 'border-primary ring-primary/25 ring-2' : 'bg-card/50')}>
            <div className="flex items-center gap-3"><span className="min-w-0 flex-1 text-[13.5px] font-medium">{t('chat.q.other')}</span><kbd className="text-muted-foreground grid size-6 shrink-0 place-items-center rounded-md border text-[11px] font-semibold">{q.options.length + 1}</kbd></div>
            <textarea ref={otherRef} rows={1} value={other} onChange={(e) => setOther(e.target.value)} maxLength={2000} placeholder={t('chat.q.otherPh')} data-testid="question-other"
              className="border-input bg-background/70 placeholder:text-muted-foreground focus-visible:ring-ring/40 min-h-9 w-full resize-y rounded-lg border px-3 py-1.5 text-[13.5px] outline-none focus-visible:ring-2" />
          </div>
        </div>
        <div className="mt-3 flex items-center justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => send(true)} disabled={busy} data-testid="question-skip">{t('chat.q.skip')}</Button>
          <Button size="sm" onClick={() => send()} disabled={!ready || busy} data-testid="question-send">{t('chat.q.send')}<kbd className="ml-1 rounded border border-current/30 px-1 text-[10px] opacity-80">Ctrl ↵</kbd></Button>
        </div>
      </>)}
    </div>
  );
}

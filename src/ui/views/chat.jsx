// The star view: a conversation with the assistant. 3.6 (DESIGN-SYSTEM §2.2): above the text, the project picker and the
// contextual action slot («Compactar» when the context is filling up, «Iniciar test» on the day's first new chat); under
// it, the brain (agent and model), the reasoning (brain button) and, for a new conversation, the orchestrator (icon and a
// small switch: on = with the assistant, who coordinates the agents; off = directly with the agent chosen).
// 3.2: each conversation is its own (route.id), several at once.
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, Square, Pause, Play, Gamepad2, Check, CheckCheck, PencilLine, ShieldAlert, X, ExternalLink, AtSign, ChevronLeft, ChevronRight, PenTool, History, FlaskConical, Folder, Mic, Shrink, ListChecks, Ellipsis, Info, BellOff, MessageSquare } from 'lucide-react';
import { Robot } from '@/components/robot.jsx';
import { Markdown } from '@/components/markdown.jsx';
import { ExtensionRequestCard } from './extensions.jsx';
import { ProjectPicker } from '@/components/project-actions.jsx';
import { useLiveTasks, liveOf, ProgressBar, elapsed } from '@/components/live-tasks.jsx';
import { AgentIcon } from '@/components/agent-icon.jsx';
import { ChatBar, BackToList } from '@/components/chat-bar.jsx';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/overlay.jsx';
import { useOrbInbox, useOrbActions } from '@/views/orb/inbox.jsx';
import { NotificationBell } from '@/components/notification-center.jsx';
import { confirm, form } from '@/components/dialogs.jsx';
import { ProjectIcon } from '@/components/project-icon.jsx';
import { Input, Spinner } from '@/components/ui/basic.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Badge } from '@/components/ui/basic.jsx';
import { Switch, Tip, BubbleTip, Popover, PopoverTrigger, PopoverContent } from '@/components/ui/overlay.jsx';
import { bridge, useStore, call, act, setState, getState, go, openGames, fullPc, initTestOfTheDay, dismissTest, runTest, chatOf, refresh, refreshSoon, navTicket, stillHere, openOrbInfo, closeOrbInfo, loadOrbInboxSoon, phoneLayout } from '@/lib/store.js';
import { notify } from '@/lib/notify.js';
import { approveTask, rejectTask } from '@/components/task-approval.jsx';
import { pickGreeting, pickSubtitle, suggestionsFor } from '@/lib/greeting.js';
import { LiveActivity, QuestionCard } from '@/components/chat-live.jsx';
import { ContextMeter } from './session.jsx';
import { OrchestratorIcon } from '@/components/orchestrator-icon.jsx';
import { BrainPicker, ReasoningMenu, UsageBubble, useCatalog, useUsageBubble } from '@/components/brain-picker.jsx';
import { ContextSlot } from '@/components/context-slot.jsx';
import { cn } from '@/lib/utils.js';
import { DECISION, AGENT, STATUS } from '@/lib/labels.js';
import { useT, useLocale, t as tNow } from '@/lib/i18n.js';


export function useAutoScroll(deps) {
  const ref = useRef(null);
  const stick = useRef(true);
  useEffect(() => { const el = ref.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  const onScroll = () => { const el = ref.current; if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140; };
  return { ref, onScroll };
}

// "@" picker: while typing @word, a list of tasks, conversations and logs to attach as context (token @tarea:12…).
function useMentions(value, onChange, ta) {
  const [options, setOptions] = useState(null);
  const [index, setIndex] = useState(0);
  const caret = ta.current?.selectionStart ?? value.length;
  const match = /(^|\s)@([\wÀ-ɏ-]*)$/.exec(value.slice(0, caret));
  const query = match ? match[2].toLowerCase() : null;
  useEffect(() => { if (query !== null && !options) call('mentions.options').then(setOptions).catch(() => setOptions([])); }, [query !== null]); // eslint-disable-line react-hooks/exhaustive-deps
  const fold = (x) => String(x ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const list = query === null ? [] : (options ?? []).filter((o) => fold(`${o.label} ${o.hint ?? ''}`).includes(fold(query))).slice(0, 8);
  useEffect(() => setIndex(0), [query]);
  const pick = (o) => {
    const before = value.slice(0, caret).replace(/@[\wÀ-ɏ-]*$/, `${o.token} `);
    onChange(before + value.slice(caret));
    requestAnimationFrame(() => { const el = ta.current; if (el) { el.focus(); el.selectionStart = el.selectionEnd = before.length; } });
  };
  const onKey = (e) => {
    if (!list.length) return false;
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => (i + 1) % list.length); return true; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => (i - 1 + list.length) % list.length); return true; }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(list[index]); return true; }
    if (e.key === 'Escape') { e.preventDefault(); onChange(value.slice(0, caret).replace(/@[\wÀ-ɏ-]*$/, '') + value.slice(caret)); return true; }
    return false;
  };
  return { list, index, pick, onKey };
}

// mentions: false hides the «@» picker. 3.6 (M2): the microphone also dictates in a computer's browser that has speech
// recognition (not in the PC app, whose engine has none).
const WebSpeech = typeof window !== 'undefined' && !/Electron/i.test(navigator.userAgent) ? (window.SpeechRecognition || window.webkitSpeechRecognition || null) : null;
function webDictate(lang) {
  return new Promise((resolve, reject) => {
    const r = new WebSpeech(); r.lang = lang === 'en' ? 'en-US' : 'es-ES'; r.interimResults = false; r.maxAlternatives = 1;
    r.onresult = (e) => resolve(e.results?.[0]?.[0]?.transcript ?? '');
    r.onerror = (e) => reject(new Error(e.error === 'not-allowed' ? tNow('chats.dictateDenied') : tNow('chats.dictateOff')));
    r.onend = () => resolve('');
    r.start();
  });
}
export function Composer({ value, onChange, onSend, onStop, busy, placeholder, top, bottom, notice, disabled, onPaste, onDrop, testid, canSend, mentions = true }) {
  const t = useT();
  const ta = useRef(null);
  useEffect(() => { const el = ta.current; if (!el) return; el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 260)}px`; }, [value]);
  const [dropping, setDropping] = useState(false);
  const m = useMentions(value, onChange, ta);
  const dictateWith = bridge.dictate ? (lang) => bridge.dictate(lang) : WebSpeech ? webDictate : null;
  // 3.5, the Android app: dictate with the phone's own speech recognition (what is said is added to the text).
  const [hearing, setHearing] = useState(false);
  const dictate = async () => {
    setHearing(true);
    try { const said = await act(dictateWith(getState().app?.config?.language ?? 'es')); if (said) onChange(value.trim() ? `${value.trimEnd()} ${said}` : said); }
    finally { setHearing(false); }
  };
  return (
    <div className="composer-dock shrink-0 px-5 pb-5">
      <div data-slot="composer" className={cn('bg-card relative mx-auto max-w-3xl rounded-2xl border shadow-sm transition-shadow focus-within:shadow-md focus-within:ring-[3px] focus-within:ring-ring/25', dropping && 'ring-primary ring-2')}
        onDragOver={onDrop ? (e) => { e.preventDefault(); setDropping(true); } : undefined} onDragLeave={() => setDropping(false)} onDrop={onDrop ? (e) => { e.preventDefault(); setDropping(false); onDrop(e); } : undefined}>
        {mentions && m.list.length ? null : notice}
        {mentions && m.list.length ? (
          <div className="bg-popover text-popover-foreground absolute right-3 bottom-full left-3 z-20 mb-2 overflow-hidden rounded-xl border shadow-lg" data-testid="mention-list">
            <div className="text-muted-foreground border-b px-3 py-1.5 text-[11px]">{t('chat.mentionHeader')}</div>
            {m.list.map((o, i) => (
              <button key={o.token} onMouseDown={(e) => { e.preventDefault(); m.pick(o); }} className={cn('flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-[13px]', i === m.index ? 'bg-accent' : 'hover:bg-accent/60')}>
                {o.icon ?? <AtSign className="text-muted-foreground size-3.5 shrink-0" />}<span className="min-w-0 flex-1 truncate">{o.label}</span><span className="text-muted-foreground shrink-0 text-[11px]">{o.hint}</span>
              </button>
            ))}
          </div>
        ) : null}
        {top ? <div className="flex min-w-0 items-center gap-2 px-3 pt-3" data-testid="composer-top">{top}</div> : null}
        <textarea ref={ta} data-testid={testid} value={value} disabled={disabled} rows={2} placeholder={placeholder} onPaste={onPaste}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (mentions && m.onKey(e)) return; if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); onSend({ alt: e.ctrlKey || e.metaKey }); } }}
          className="placeholder:text-muted-foreground block w-full resize-none bg-transparent px-4 pt-3 pb-1 text-[14.5px] leading-relaxed outline-none" />
        <div className="flex items-center gap-2 px-3 pb-3">
          <div className="flex min-w-0 flex-1 items-center gap-1.5" data-testid="composer-bottom">{bottom}</div>
          {dictateWith ? <Tip label={t('chat.dictate')}><Button size="icon-sm" variant="ghost" className="rounded-full" onClick={dictate} disabled={disabled || hearing} aria-label={t('chat.dictate')} data-testid="dictate"><Mic className={hearing ? 'text-primary animate-pulse' : undefined} /></Button></Tip> : null}
          {busy && onStop ? <Tip label={t('chat.stop')}><Button size="icon-sm" variant="secondary" onClick={onStop} aria-label={t('chat.stop')}><Square className="size-3.5 fill-current" /></Button></Tip> : null}
          <Button size="icon-sm" className="rounded-full" onClick={() => onSend({ alt: false })} disabled={disabled || !(canSend ?? value.trim())} aria-label={t('chat.send')} data-testid="send"><ArrowUp /></Button>
        </div>
      </div>
    </div>
  );
}

// 2.6: the system's date and time on the left of the chat's top bar (app.css .bar-clock, in the theme's title type).
// 2.7: a different greeting each time the chat opens (lib/greeting.js); the last one is remembered so it does not repeat.
function useGreeting() {
  const [g] = useState(() => {
    const { app, tasks, projects } = getState();
    let last = {}; try { last = JSON.parse(localStorage.getItem('orb.greet') || '{}'); } catch { /* none */ }
    const pick = pickGreeting({ tasks, project: app.activeProject?.name ?? null, first: !tasks.length && !projects.length, serious: app.config.ui?.skin === 'profesional', last: last.key });
    const sub = pickSubtitle({ last: last.sub });
    try { localStorage.setItem('orb.greet', JSON.stringify({ key: pick.key, sub })); } catch { /* storage unavailable */ }
    return { ...pick, sub };
  });
  return g;
}

// 2.7: with the pointer on it, the seconds too; a click opens the month's calendar in a bubble (MonthCalendar).
export function BarClock() {
  const t = useT();
  const locale = useLocale();
  const [now, setNow] = useState(() => new Date());
  const [hover, setHover] = useState(false);
  const [open, setOpen] = useState(false);
  const seconds = hover || open;
  useEffect(() => { const id = setInterval(() => setNow(new Date()), seconds ? 1000 : 15_000); setNow(new Date()); return () => clearInterval(id); }, [seconds]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="bar-clock" data-testid="bar-clock" aria-label={t('chat.calendarOpen')} onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)} onFocus={() => setHover(true)} onBlur={() => setHover(false)}>
          <span className="bar-clock-time">{now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}) })}</span>
          <span className="bar-clock-date">{now.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="orb-cal" data-testid="bar-calendar"><MonthCalendar today={now} /></PopoverContent>
    </Popover>
  );
}
// A month at a glance: the days of the week from the language's first day (Monday in Spanish), today marked, arrows to
// move between months and a button back to today.
function MonthCalendar({ today }) {
  const t = useT();
  const locale = useLocale();
  const [shown, setShown] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const first = (() => { try { const w = new Intl.Locale(locale).getWeekInfo?.() ?? new Intl.Locale(locale).weekInfo; return (w?.firstDay ?? 1) % 7; } catch { return 1; } })();
  const year = shown.getFullYear(); const month = shown.getMonth();
  const lead = (new Date(year, month, 1).getDay() - first + 7) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const names = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 7 + ((first + i) % 7)).toLocaleDateString(locale, { weekday: 'narrow' })); // 7 Jan 2024 was a Sunday
  const isToday = (d) => d && year === today.getFullYear() && month === today.getMonth() && d === today.getDate();
  const thisMonth = year === today.getFullYear() && month === today.getMonth();
  const move = (n) => setShown(new Date(year, month + n, 1));
  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-1">
        <span className="orb-cal-title flex-1 truncate px-1 text-[14px] font-semibold" aria-live="polite" data-testid="bar-calendar-title">{shown.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}</span>
        <button type="button" className="orb-cal-nav" onClick={() => move(-1)} aria-label={t('chat.calendarPrev')}><ChevronLeft className="size-4" /></button>
        <button type="button" className="orb-cal-nav" onClick={() => move(1)} aria-label={t('chat.calendarNext')} data-testid="bar-calendar-next"><ChevronRight className="size-4" /></button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center" role="grid" aria-label={shown.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}>
        {names.map((n, i) => <span key={`h${i}`} className="orb-cal-head" role="columnheader">{n}</span>)}
        {cells.map((d, i) => <span key={i} role="gridcell" aria-current={isToday(d) ? 'date' : undefined} className={cn('orb-cal-day', !d && 'invisible', isToday(d) && 'is-today', (first + i) % 7 === 0 || (first + i) % 7 === 6 ? 'is-weekend' : '')}>{d ?? ''}</span>)}
      </div>
      {thisMonth ? null : <button type="button" className="orb-cal-today" onClick={() => setShown(new Date(today.getFullYear(), today.getMonth(), 1))}>{t('chat.calendarToday')}</button>}
    </div>
  );
}
// The time a message was written, small at its bottom right (the day too when it is not today).
function MsgTime({ at }) {
  const locale = useLocale();
  if (!at) return null;
  const d = new Date(at); if (Number.isNaN(d.getTime())) return null;
  const today = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  return <time className="msg-time" dateTime={d.toISOString()}>{today ? time : `${d.toLocaleDateString(locale, { day: 'numeric', month: 'short' })} ${time}`}</time>;
}

// A list fetched again keeps the lines that did not change as they were, so that their memoised Message is not drawn
// again (the engine's events refresh the list several times a second while the assistant answers).
export function keepSame(prev, next) {
  if (!prev.length) return next;
  const old = new Map(prev.map((m) => [m.id, m]));
  let same = prev.length === next.length;
  const out = next.map((m, i) => {
    const o = old.get(m.id);
    const keep = o && o.body === m.body && o.at === m.at && o.role === m.role && JSON.stringify(o.meta ?? null) === JSON.stringify(m.meta ?? null);
    if (!keep || prev[i] !== o) same = false;
    return keep ? o : m;
  });
  return same ? prev : out;
}

// Memoised: the list (up to 120 lines) is not drawn again while the assistant streams its answer.
const Message = memo(function Message({ m, name, onChanges }) {
  const t = useT();
  if (m.meta?.kind === 'question') return <QuestionCard m={m} />;
  // 2.7: for a big request, the assistant's advice to define it on the Pizarra, with the way there.
  if (m.meta?.kind === 'board') return (
    <div className="flex gap-3">
      <Robot size={32} still className="mt-0.5" />
      <div className="chat-glass min-w-0 flex-1" data-testid="board-suggestion">
        <div className="text-muted-foreground mb-1 text-xs">{name}</div>
        <Markdown>{m.body}</Markdown>
        <div className="chat-actions mt-2.5"><Button size="sm" onClick={() => go('board')} data-testid="open-board"><PenTool />{t('chat.openBoard')}</Button></div>
        <div className="text-muted-foreground flow-root"><MsgTime at={m.at} /></div>
      </div>
    </div>
  );
  if (m.role === 'usuario') return <div className="bg-bubble text-bubble-foreground ml-auto max-w-[80%] rounded-2xl rounded-br-md px-4 py-2.5 whitespace-pre-wrap break-words">{m.body}<MsgTime at={m.at} /></div>;
  if (m.role === 'orb') {
    const report = m.meta?.kind === 'report' && m.meta.tasks?.length ? m.meta : null;
    return (
      <div className="flex gap-3">
        <Robot size={32} still className="mt-0.5" />
        <div className="chat-glass min-w-0 flex-1">
          <div className="text-muted-foreground mb-1 text-xs">{name}</div>
          <Markdown>{m.body}</Markdown>
          {report ? (
            <div className="chat-actions mt-2.5 flex flex-wrap items-center gap-2" data-testid="report-actions">
              {report.accepted ? <Badge variant="success"><Check />{t('chat.accepted', { ids: report.tasks.map((id) => `#${id}`).join(', ') })}</Badge> : (<>
                <Button size="xs" className="px-2.5" onClick={() => act(call('chat.accept', { id: m.id }), t('chat.acceptDone'))}><Check />OK</Button>
                <Button size="xs" className="px-2.5" variant="outline" onClick={() => onChanges(report.tasks)}><PencilLine />{t('chat.requestChanges')}</Button>
                <span className="text-muted-foreground text-xs">{t('chat.tasksList', { ids: report.tasks.map((id) => `#${id}`).join(', ') })}</span>
              </>)}
            </div>
          ) : null}
          <div className="text-muted-foreground flow-root"><MsgTime at={m.at} /></div>
        </div>
      </div>
    );
  }
  if (m.meta?.kind === 'approval' || m.meta?.kind === 'task-approval') return <ChatApproval m={m} />;
  // 3.8.1: an agent made a skill or an MCP server and asks for it to be turned on.
  if (m.meta?.kind === 'extension' && m.meta.extension) return <ExtensionRequestCard m={m} />;
  if (m.meta?.kind === 'attention' && m.meta.task) return <TaskApprovalLine m={m} />;
  // 2.6: the assistant's suggestion to play while the agents work, with the button that opens the games.
  if (m.meta?.kind === 'games') return (
    <div className="chat-actions bg-muted/70 text-muted-foreground mx-auto flex max-w-[88%] flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded-xl px-3.5 py-2 text-center text-[13px]">
      <span>{m.body}</span>
      {!fullPc() ? null : <Button size="xs" variant="soft" onClick={openGames} data-testid="chat-play"><Gamepad2 />{t('chat.playButton')}</Button>}
    </div>
  );
  // 3.1: a finished task says it in one line; what the agent reported (technical) unfolds on request.
  if (m.meta?.kind === 'task-end' && m.meta.result) return (
    <div className="bg-muted/70 text-muted-foreground mx-auto max-w-[88%] rounded-xl px-3.5 py-2 text-center text-[13px]">
      <div className="whitespace-pre-wrap">{m.body}</div>
      <Details label={t('chat.seeResult')} className="text-left"><div className="mt-1.5 max-h-60 overflow-auto text-xs whitespace-pre-wrap break-words">{m.meta.result}</div></Details>
    </div>
  );
  return <div className="bg-muted/70 text-muted-foreground mx-auto max-w-[88%] rounded-xl px-3.5 py-2 text-center text-[13px] whitespace-pre-wrap">{m.body}</div>;
});

// A fold: a small link that shows what is inside (details the user may want, not by default).
function Details({ label, className, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={className}>
      <button type="button" className="text-muted-foreground hover:text-foreground mt-1 inline-flex cursor-pointer items-center gap-1 text-xs underline-offset-2 hover:underline" onClick={() => setOpen(!open)} aria-expanded={open}>
        <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />{label}
      </button>
      {open ? children : null}
    </div>
  );
}

// A permission request in the chat: the assistant's own (free mode) or one of a task (answered here or in the task).
function ChatApproval({ m }) {
  const t = useT();
  // 3.1: how the request ended comes from the engine too (answered in the task, nobody answered, the task stopped).
  const [local, setLocal] = useState(null);
  const task = m.meta.kind === 'task-approval';
  // 3.2: the assistant no longer runs commands itself (free mode is a direct conversation now): an old request of its is over.
  const state = local ?? (task ? m.meta.status ?? 'pending' : m.meta.status === 'pending' || !m.meta.status ? 'expired' : m.meta.status);
  const answer = async (decision) => {
    const r = await act(call('sessions.approve', { id: m.meta.session, request: m.meta.request, decision }));
    if (r !== undefined) setLocal(decision === 'deny' ? 'denied' : decision === 'always' ? 'always' : 'allowed');
  };
  const done = state !== 'pending';
  const badge = DECISION[state] ?? DECISION.denied;
  return (
    <div className={cn('mx-auto w-full max-w-[88%] rounded-xl border px-3.5 py-2.5 text-[13px]', done ? 'bg-muted/50' : 'border-warning/50 bg-warning/10')}>
      <div className="flex items-start gap-2"><ShieldAlert className={cn('mt-0.5 size-4 shrink-0', done ? 'text-muted-foreground' : 'text-warning')} /><div className="min-w-0 flex-1 whitespace-pre-wrap break-words">{m.body}</div></div>
      {/* 3.1: the command itself, for whoever wants to look: never in the sentence. */}
      {m.meta.detail ? <Details label={t('chat.seeDetails')} className="pl-6"><pre className="bg-muted mt-1.5 max-h-48 overflow-auto rounded-md px-2.5 py-1.5 font-mono text-[11px] whitespace-pre-wrap break-all">{m.meta.detail}</pre></Details> : null}
      <div className="chat-actions mt-2 flex flex-wrap items-center gap-2 pl-6">
        {done ? <Badge variant={badge[1]}>{badge[0]}</Badge> : (<>
          <Button size="xs" className="px-2.5" onClick={() => answer('allow')}><Check />{t('chat.allow')}</Button>
          <Button size="xs" className="px-2.5" variant="outline" onClick={() => answer('always')}><CheckCheck />{t('chat.always')}</Button>
          <Button size="xs" className="px-2.5" variant="outline" onClick={() => answer('deny')}><X />{t('chat.deny')}</Button>
        </>)}
        {task ? <Button size="xs" className="px-2.5" variant="ghost" onClick={() => go({ view: 'session', id: m.meta.session })}><ExternalLink />{t('chat.viewTask')}</Button> : null}
      </div>
    </div>
  );
}

// 3.2.1: a task that waits for the user's approval, with «Aprobar» and «Rechazar» right in the chat (before, only in
// Tareas). Once answered, how it ended. 3.6 (M3): a card: «"Publicar la web" necesita tu aprobación»,
// the reason in words and Rechazar · Ver la tarea · Aprobar.
const whyOf = (body) => /\(([^()]*)\)\.?\s*$/.exec(String(body ?? ''))?.[1]?.trim() || null;
function TaskApprovalLine({ m }) {
  const t = useT();
  const task = useStore((s) => s.tasks.find((x) => x.id === m.meta.task) ?? null);
  const [busy, setBusy] = useState(false);
  const waiting = task?.status === 'awaiting_approval';
  const run = async (fn) => { setBusy(true); try { await fn(task); } finally { setBusy(false); } };
  // 3.6: why it waits, in plain words from the task's own data (its sensitivity), not the short labels of the log.
  const reasons = (task?.sensitivity ?? []).map((k) => t(`orbchats.why.${k}`)).filter((x) => x && !x.startsWith('orbchats.why.'));
  const why = reasons.length ? reasons.join(t('orbchats.whyAnd')) : whyOf(m.body);
  return (
    <div className={cn('mx-auto w-full max-w-[92%] rounded-xl border px-3.5 py-3 text-[13.5px] shadow-xs', waiting ? 'bg-card border-warning/45' : 'bg-muted/50')} data-testid="chat-task-approval" data-status={task?.status ?? 'gone'}>
      <div className="flex items-start gap-2">
        <ListChecks className={cn('mt-0.5 size-4 shrink-0', waiting ? 'text-warning' : 'text-muted-foreground')} />
        <div className="min-w-0 flex-1">
          {task ? <div className="font-medium">{t('orbchats.cardTitle', { title: task.title })}</div> : <div className="whitespace-pre-wrap break-words">{m.body.replace(/^⚠️\s*/u, '')}</div>}
          {task && why ? <div className="text-muted-foreground mt-0.5 text-[13px]">{t('orbchats.cardWhy', { why })}</div> : null}
        </div>
      </div>
      <div className="chat-actions mt-2.5 flex flex-wrap items-center gap-2 sm:pl-6">
        {waiting ? (<>
          <Button size="xs" className="px-2" variant="ghost" onClick={() => go({ view: 'tasks', id: m.meta.task })} data-testid="chat-task-open">{t('orbchats.taskOpen')}</Button>
          <span className="flex-1" />
          <Button size="xs" className="px-3" variant="outline" disabled={busy} onClick={() => run(rejectTask)} data-testid="chat-task-reject">{t('tasks.reject')}</Button>
          <Button size="xs" className="px-3" disabled={busy} onClick={() => run(approveTask)} data-testid="chat-task-approve"><Check />{t('tasks.approve.ok')}</Button>
        </>) : (<>
          {task ? <Badge variant={STATUS[task.status]?.[1]}>{STATUS[task.status]?.[0] ?? task.status}</Badge> : null}
          <Button size="xs" className="px-2.5" variant="ghost" onClick={() => go({ view: 'tasks', id: m.meta.task })}><ExternalLink />{t('chat.viewTask')}</Button>
        </>)}
      </div>
    </div>
  );
}

// 3.6 (M3): the tasks of this conversation that are running or waiting their turn, each as one live line in the
// conversation (agent, «Tarea #3», what it is doing now, a small bar and the time); a click opens it in Tareas. The
// agent's own conversation and «Cancelar» stay a click away, as in the block they replace.
function TaskLines({ conversation }) {
  const live = useLiveTasks();
  const tasks = useStore((s) => (conversation == null ? [] : s.tasks.filter((x) => x.conversation_id === conversation && (x.status === 'running' || x.status === 'queued'))));
  if (!tasks.length) return null;
  return <div className="grid gap-2" data-testid="task-lines">{[...tasks].sort((a, b) => a.id - b.id).map((x) => <TaskLine key={x.id} task={x} live={liveOf(live, x.id)} />)}</div>;
}
function TaskLine({ task, live }) {
  const t = useT();
  const running = task.status === 'running';
  const agent = live?.agent ?? task.assigned_to ?? (task.agent !== 'any' ? task.agent : null);
  const now = live?.note || live?.last || task.title;
  const cancel = async () => { if (await confirm(t('comp.live.cancelTask'), t('comp.live.cancelBody', { agent: AGENT[agent] ?? agent ?? '' }), { ok: t('comp.live.cancelTask'), cancel: t('comp.live.back'), danger: true })) act(call('tasks.cancel', { id: task.id }), t('comp.live.cancelled')); };
  return (
    <div className="group/task bg-card/85 mx-auto flex w-full max-w-[92%] items-center gap-2.5 rounded-xl border px-3 py-2 text-[13px]" data-testid="task-line" data-status={task.status}>
      {agent ? <AgentIcon agent={agent} className={cn('size-4', running && 'animate-pulse')} /> : <ListChecks className="text-muted-foreground size-4 shrink-0" />}
      <button type="button" className="min-w-0 flex-1 cursor-pointer truncate text-left hover:underline" onClick={() => go({ view: 'tasks', id: task.id })} title={task.title}>
        <span className="font-semibold">{t('orbchats.taskN', { id: task.id })}</span>
        <span className="text-muted-foreground">{agent ? ` · ${AGENT[agent] ?? agent}` : ''} · </span>{now}
      </button>
      {running ? <ProgressBar percent={live?.percent ?? null} quiet={live?.quietMin >= 5} className="w-16 shrink-0 sm:w-24" /> : <span className="text-muted-foreground shrink-0 text-xs">{t('orbchats.taskQueued')}</span>}
      {running && live?.startedAt ? <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{elapsed(Date.now() - live.startedAt)}</span> : null}
      {live?.sessionId ? <BubbleTip title={t('comp.live.viewConv')}><Button size="icon-xs" variant="ghost" className="opacity-60 group-hover/task:opacity-100" aria-label={t('comp.live.viewConv')} onClick={() => go({ view: 'session', id: live.sessionId })}><MessageSquare /></Button></BubbleTip> : null}
      <BubbleTip title={t('comp.live.cancelTitle')}><Button size="icon-xs" variant="ghost" className="opacity-60 group-hover/task:opacity-100" aria-label={t('comp.live.cancelTitle')} onClick={cancel} data-testid="task-line-cancel"><Square className="size-3 fill-current" /></Button></BubbleTip>
    </div>
  );
}

// The title of a conversation in the middle of a bar, and under it, small, its project with its icon (direct
// conversations, views/session.jsx).
export function BarHeading({ title, project, onRename, renameLabel, extra, showProject = true }) {
  const t = useT();
  return (
    <div className="bar-title" data-testid="bar-title">
      {onRename ? <BubbleTip title={renameLabel}><button type="button" className="bar-title-main" onClick={onRename} data-testid="bar-title-text">{title}</button></BubbleTip> : <span className="bar-title-main">{title}</span>}
      {showProject || extra ? (
        <span className="bar-title-sub" data-testid="bar-title-project">
          {showProject ? <>{project ? <ProjectIcon name={project} className="size-3.5" /> : <Folder className="size-3 shrink-0" aria-hidden="true" />}<span className="truncate">{project ?? t('bar.noProject')}</span></> : null}{extra}
        </span>
      ) : null}
    </div>
  );
}

// 3.6: the share of the context at which the composer suggests «Compactar» (DESIGN-SYSTEM §2.2).
export const COMPACT_AT = 0.7;
// «Compactar» in the contextual slot: the conversation goes on from a summary; nothing of the history is lost.
export function CompactButton({ onCompact, busy }) {
  const t = useT();
  return (
    <BubbleTip title={t('compact.title')} text={t('compact.tip')} side="top">
      <Button size="xs" variant="soft" onClick={onCompact} disabled={busy} data-testid="chat-compact">{busy ? <Spinner /> : <Shrink />}{busy ? t('compact.busy') : t('compact.button')}</Button>
    </BubbleTip>
  );
}
// The orchestrator in the composer: its icon and a small switch; the tooltip explains it. A conversation keeps the way it
// started (locked): the switch shows it, and the tooltip says how to talk to an agent directly.
function OrchestratorSwitch({ on, onChange, name, cursor, locked = false }) {
  const t = useT();
  return (
    <BubbleTip title={t('chat.orchestratorTip', { name })} text={locked ? t('chat.orchestratorLocked', { name }) : cursor ? t('chat.orchestratorCursor', { name }) : on ? t('chat.orchestratorOn') : t('chat.orchestratorOff')} side="top">
      <label className={cn('flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2', locked ? 'cursor-default' : 'hover:bg-accent/60 cursor-pointer')} data-testid="orchestrator">
        <OrchestratorIcon className={cn('size-4', on ? 'text-primary' : 'text-muted-foreground')} aria-hidden="true" />
        <Switch size="sm" checked={on} disabled={locked} onCheckedChange={(v) => onChange(v === true)} aria-label={t('chat.orchestrator')} data-testid="orchestrator-check" />
      </label>
    </BubbleTip>
  );
}

// 3.2: onConversation / project: inside God mode, a new conversation stays there (in its project) instead of navigating.
export function ChatView({ route, onConversation, project: inProject }) {
  const t = useT();
  const app = useStore((s) => s.app);
  const version = useStore((s) => s.version);
  const id = route?.id ?? null;
  const conv = useStore((s) => (id == null ? null : s.conversations.find((c) => c.id === id) ?? null));
  const [rows, setRows] = useState([]);
  const [text, setText] = useState('');
  // 3.5, the Android app: what was shared from another app («Compartir con Orb») is waiting in the text box to be sent.
  useEffect(() => {
    if (!bridge.takeShared) return undefined;
    const take = () => { const got = bridge.takeShared(); if (got) setText((prev) => (prev.trim() ? `${prev.trimEnd()}\n${got}` : got)); };
    take();
    window.addEventListener('orb:shared', take);
    return () => window.removeEventListener('orb:shared', take);
  }, []);
  const name = app.config.assistantName;
  const chat = chatOf(app, id) ?? {};
  // 3.8: on a phone, the brain and «Orquestador» of a NEW conversation are chosen for that conversation alone (the ones
  // new conversations start with are a setting of the PC).
  const [draft, setDraft] = useState(null);
  const local = Boolean(bridge.mobile) && id == null;
  const defaults = { ...(app.assistant ?? {}), ...(local ? draft ?? {} : {}) };
  useEffect(() => { setRows([]); setOlder([]); setMore(false); }, [id]);
  useEffect(() => {
    if (id == null) return undefined;
    let alive = true;
    call('chat.list', { conversation: id }).then((r) => { if (alive) { setRows((prev) => keepSame(prev, r)); setMore(r.length >= 160); } }).catch(() => {});
    return () => { alive = false; };
  }, [id, version]);
  // A long conversation shows its last 160 lines; the earlier ones, on request.
  const [older, setOlder] = useState([]);
  const [more, setMore] = useState(false);
  const askChanges = useCallback((ids) => setText(t('chat.changesFor', { ids: ids.map((x) => `#${x}`).join(', ') })), [t]);
  const [loading, setLoading] = useState(false);
  const loadOlder = async () => {
    const first = (older[0] ?? rows[0])?.id; if (loading || !first) return; setLoading(true);
    const r = await act(call('chat.list', { conversation: id, before: first }));
    if (r) { setOlder((o) => [...r, ...o]); setMore(r.length >= 120); }
    setLoading(false);
  };
  useEffect(() => { initTestOfTheDay(); }, []);
  // 3.6 (M3): its marks in the Orb zone's list (pinned, muted, unread); what is on screen is marked read.
  useOrbInbox();
  const item = useStore((s) => (id == null ? null : (s.orbInbox?.items ?? []).find((x) => x.key === `conversation:${id}`) ?? null));
  const unread = item?.unread ?? 0;
  useEffect(() => {
    if (id == null || !unread) return undefined;
    const run = () => { if (document.visibilityState === 'visible') call('inbox.markRead', { kind: 'conversation', id }).then(() => loadOrbInboxSoon(0)).catch(() => {}); };
    const timer = setTimeout(run, 350);
    document.addEventListener('visibilitychange', run);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', run); };
  }, [id, unread, rows.length]);
  const showTest = useStore((s) => s.testToday) === true && id == null;
  const scroll = useAutoScroll([rows.length, chat.partial, chat.busy, id]);
  const catalog = useCatalog();
  const brain = conv
    ? { agent: conv.agent ?? 'claude', model: conv.model ?? '', account: conv.account ?? conv.agent, reasoning: conv.reasoning ?? 'medium' }
    : { agent: defaults.agent ?? 'claude', model: defaults.model ?? '', account: defaults.account, reasoning: defaults.reasoning ?? 'medium' };
  const orchestrate = conv ? true : defaults.orchestrate !== false;
  const bubble = useUsageBubble(catalog, brain);
  const greeting = useGreeting();
  const userName = useStore((st) => st.app?.config?.userName?.trim() || '');
  const [sending, setSending] = useState(false);
  // 3.2.1: in God mode, a new conversation goes to the project chosen there, and the bar says that one.
  const projects = useStore((s) => s.projects);
  const workProject = inProject ? projects.find((p) => p.name === inProject) ?? { name: inProject } : app.activeProject ?? null;

  // 3.2.1: inside God mode, the project chosen there right now (the answer to a first message may come after a change).
  const projectNow = useRef(inProject); projectNow.current = inProject;
  // The user went elsewhere while the first message was on its way: they stay where they are, and a notice says where
  // the message is (one click away).
  const leftBehind = (target, title) => notify({ title: t('chat.startedIn', { title }), body: t('chat.startedInBody'), tone: 'info', go: target, action: { label: t('notice.open'), onClick: () => go(target) } });
  const send = async () => {
    const msg = text.trim(); if (!msg || sending) return;
    setText('');
    dismissTest();
    if (id != null) {
      if ((await act(call('chat.send', { text: msg, conversation: id }))) === undefined) setText(msg);
      else call('chat.list', { conversation: id }).then((r) => { if (getState().route?.id === id) setRows((prev) => keepSame(prev, r)); }).catch(() => {});
      return;
    }
    setSending(true);
    const ticket = navTicket(); const startedIn = inProject;
    const moved = () => !stillHere(ticket) || (onConversation && projectNow.current !== startedIn);
    try {
      if (orchestrate) {
        // 3.2: the first message makes the conversation (in the working folder): then the screen is that conversation.
        const chosen = local && draft ? Object.fromEntries(['agent', 'model', 'reasoning'].filter((k) => draft[k] !== undefined).map((k) => [k, draft[k]])) : {};
        const r = await act(call('chat.send', { text: msg, ...(inProject ? { project: inProject } : {}), ...(Object.keys(chosen).length ? { brain: chosen } : {}) }));
        if (!r) { if (!moved()) setText(msg); return; }
        await refresh().catch(() => {});
        if (moved()) { leftBehind({ view: 'chat', id: r.conversation }, getState().conversations.find((c) => c.id === r.conversation)?.title ?? msg.slice(0, 60)); return; }
        if (onConversation) onConversation(r.conversation); else go({ view: 'chat', id: r.conversation });
      } else {
        // «Orquestador» off: the user hands out the work, and the conversation is directly with the agent chosen below
        // (3.2.1: in God mode, in the project chosen there).
        const project = inProject ?? app.activeProject?.name ?? null;
        const s = await act(call('sessions.create', { agent: brain.agent, account: brain.account && brain.account !== brain.agent ? brain.account : undefined, model: brain.model || undefined, reasoning: brain.reasoning, project, permission: project ? 'editar' : 'leer' }));
        if (!s) { if (!moved()) setText(msg); return; }
        await act(call('sessions.send', { id: s.id, text: msg }));
        await refresh().catch(() => {});
        if (!stillHere(ticket)) { leftBehind({ view: 'session', id: s.id }, s.title); return; }
        go({ view: 'session', id: s.id });
      }
    } finally { setSending(false); }
  };
  const settings = async (patch) => {
    if (local) { setDraft((d) => ({ ...(d ?? {}), ...patch })); return true; }
    const r = await act(call('chat.settings', { ...patch, ...(id != null ? { conversation: id } : {}) })); if (r) { setState((s) => ({ app: { ...s.app, ...(id == null ? { assistant: r } : {}) } })); refreshSoon(); } return r;
  };
  // 3.2.1: the assistant cannot coordinate with Cursor as its brain (Cursor takes no tools of Orb's): turning the
  // «Orquestador» on moves the brain to Claude (or Codex) and says so, instead of doing nothing.
  const coordinator = ['claude', 'codex'].find((a) => catalog?.some((x) => x.id === a)) ?? null;
  const toggleOrchestrator = async (checked) => {
    if (!checked && !(await confirm(t('chat.freeMode'), t('chat.freeModeBody', { name }), { ok: t('chat.freeModeOk') }))) return;
    if (checked && brain.agent === 'cursor') {
      if (!coordinator) { notify({ title: t('chat.orchestratorNoBrain', { name }), tone: 'warning' }); return; }
      if (await settings({ orchestrate: true, agent: coordinator, model: '' })) notify({ title: t('chat.orchestratorSwitched', { name, agent: AGENT[coordinator] }), tone: 'info' });
      return;
    }
    settings({ orchestrate: checked });
  };
  // Choosing Cursor for a new conversation with the «Orquestador» on: the conversation becomes a direct one with Cursor.
  const pickBrain = async (b) => {
    if (id == null && b.agent === 'cursor' && orchestrate) {
      if (await settings({ agent: b.agent, model: b.model, account: b.account, orchestrate: false })) notify({ title: t('chat.cursorDirect'), tone: 'info' });
      return;
    }
    settings({ agent: b.agent, model: b.model, account: b.account });
  };
  const lines = [...older, ...rows];
  // 3.6: «Compactar» when the conversation's context is at 70 % or more (never while it answers).
  const context = chat.context ?? conv?.context ?? null;
  const [compacting, setCompacting] = useState(false);
  const compactable = id != null && !chat.waiting && (compacting || (!chat.busy && context?.size > 0 && context.used / context.size >= COMPACT_AT));
  const compact = async () => {
    setCompacting(true);
    try { const r = await act(call('chat.compact', { conversation: id })); if (r) refreshSoon(); }
    finally { setCompacting(false); }
  };

  const embedded = Boolean(onConversation);
  const slim = phoneLayout() && Boolean(conv);
  const infoOpen = useStore((s) => s.orbInfo?.type === 'chat') && !embedded;
  const headProject = conv ? conv.project ?? null : workProject?.name ?? null;
  const waitingYou = useStore((s) => id != null && s.tasks.some((x) => x.conversation_id === id && x.status === 'awaiting_approval'));
  const rename = () => form(t('chat.renameTitle'), { initial: { title: conv.title }, body: (v, set) => <Input autoFocus value={v.title} onChange={(e) => set({ title: e.target.value })} maxLength={80} data-testid="rename-input" />, ok: t('session.save'), onOk: async (v) => { const r = await call('conversations.update', { id: conv.id, title: v.title.trim() || conv.title }); refreshSoon(); return r; } });
  const chatActions = useOrbActions(conv ? { kind: 'conversation', id: conv.id, title: conv.title, done: conv.status === 'done', pinned: Boolean(item?.pinned), muted: Boolean(item?.muted), unread: 0 } : null);

  return (
    <>
      {/* 3.6 (M3): the bar of a messaging app: (phone: back to the list) the pill with Orbe, the title and, small, the
          project and what it is doing; a click opens the chat's info. On the right: notifications, pause, games and ⋯. */}
      <ChatBar back={embedded ? null : <BackToList to="chats" />} testid="orb-chat-bar" className="topbar-chat" title={<>
        <h1 className="sr-only">{conv?.title ?? t('orbchats.newChatTitle')}</h1>
        <button type="button" disabled={!conv || embedded} onClick={() => (infoOpen ? closeOrbInfo() : openOrbInfo({ type: 'chat' }))}
          className={cn('press flex min-w-0 items-center gap-2.5 rounded-xl py-1 pr-3 pl-1 text-left', conv && !embedded && 'cursor-pointer', infoOpen ? 'bg-accent' : conv && !embedded ? 'hover:bg-accent/60' : '')}
          aria-expanded={conv ? infoOpen : undefined} aria-label={conv ? t('chats.openInfo', { name: conv.title }) : undefined} data-testid="orb-chat-head">
          <Robot size={36} mood={chat.busy ? 'thinking' : 'idle'} still={!chat.busy} />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5"><span className="truncate text-[15px] font-semibold" data-testid="bar-title-text">{conv?.title ?? t('orbchats.newChatTitle')}</span>{item?.muted ? <BellOff className="text-muted-foreground size-3.5 shrink-0" aria-label={t('chats.muted')} /> : null}</span>
            <span className={cn('flex min-w-0 items-center gap-1 text-[12.5px]', chat.busy ? 'text-primary' : waitingYou ? 'text-warning-foreground dark:text-warning' : 'text-muted-foreground')} data-testid="orb-chat-status">
              {headProject ? <ProjectIcon name={headProject} size={14} /> : <Folder className="size-3 shrink-0" aria-hidden="true" />}
              <span className="truncate">{headProject ?? t('orbchats.noProject')} · {chat.busy ? t('chats.working') : waitingYou ? t('orbchats.awaiting') : name}</span>
            </span>
          </span>
        </button>
      </>}>
        {/* The phone keeps the bar light: the bell is the system's notifications there, and «Pausar» goes into ⋯. */}
        {slim ? null : <NotificationBell />}
        {slim ? null : app.paused
          ? <BubbleTip title={t('bar.resume')} text={t('bar.resumeText')}><Button variant="soft" size="icon-sm" onClick={() => act(call('control.resume'), t('chat.resumed'))} aria-label={t('bar.resume')} data-testid="bar-resume"><Play /></Button></BubbleTip>
          : <BubbleTip title={t('bar.pause')} text={t('bar.pauseText')}><Button variant="ghost" size="icon-sm" onClick={() => act(call('control.pause'), t('chat.paused'))} aria-label={t('bar.pause')} data-testid="bar-pause"><Pause /></Button></BubbleTip>}
        {!fullPc() ? null : <BubbleTip title={t('bar.games')} text={t('bar.gamesText')}><Button variant="ghost" size="icon-sm" onClick={openGames} aria-label={t('bar.games')} data-testid="bar-games"><Gamepad2 /></Button></BubbleTip>}
        {conv ? (
          <DropdownMenu modal={false}>
            <BubbleTip title={t('chats.more')}><DropdownMenuTrigger asChild><Button size="icon-sm" variant="ghost" aria-label={t('chats.more')} data-testid="orb-chat-more"><Ellipsis /></Button></DropdownMenuTrigger></BubbleTip>
            <DropdownMenuContent align="end" className="w-56">
              {embedded ? null : <DropdownMenuItem onSelect={() => openOrbInfo({ type: 'chat' })} data-testid="more-info"><Info />{t('orbchats.info')}</DropdownMenuItem>}
              <DropdownMenuItem onSelect={rename} data-testid="more-rename"><PencilLine />{t('orbchats.rename')}</DropdownMenuItem>
              {slim ? <DropdownMenuItem onSelect={() => (app.paused ? act(call('control.resume'), t('chat.resumed')) : act(call('control.pause'), t('chat.paused')))} data-testid={app.paused ? 'bar-resume' : 'bar-pause'}>{app.paused ? <Play /> : <Pause />}{app.paused ? t('bar.resume') : t('bar.pause')}</DropdownMenuItem> : null}
              {chatActions.filter((a) => a.id !== 'info').map((a) => <div key={a.id}>{a.danger ? <DropdownMenuSeparator /> : null}<DropdownMenuItem variant={a.danger ? 'destructive' : undefined} onSelect={a.run} data-testid={`more-${a.id}`}><a.icon />{a.label}</DropdownMenuItem></div>)}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </ChatBar>
      <div ref={scroll.ref} onScroll={scroll.onScroll} className="min-h-0 flex-1 overflow-y-auto">
        <div className="lazy-lines mx-auto flex max-w-3xl flex-col gap-5 px-5 py-6" data-testid="chat-lines">
          {more ? <Button variant="ghost" size="sm" className="text-muted-foreground mx-auto" onClick={loadOlder} disabled={loading} data-testid="chat-older"><History />{t('chat.older')}</Button> : null}
          {id == null && !sending ? (
            <div className="flex flex-col items-center gap-3 pt-10 text-center">
              <Robot size={130} mood="hello" live />
              <div className="chat-glass chat-hero flex flex-col items-center gap-3">
                <h2 className="hero-title mt-2 text-2xl" data-testid="chat-greeting">{userName ? t(greeting.key, { ...greeting, user: userName, name }) : t('chat.hello', { name })}</h2>
                <p className="text-muted-foreground max-w-md">{t(greeting.sub)}</p>
              </div>
              <div className="mt-3 flex max-w-xl flex-wrap justify-center gap-2">{suggestionsFor(workProject?.name).map((s) => <Button key={s} variant="outline" size="sm" className="h-auto max-w-full shrink rounded-full py-1.5 whitespace-normal" onClick={() => setText(t(s))}>{t(s)}</Button>)}</div>
            </div>
          ) : lines.map((m) => <Message key={m.id} m={m} name={name} onChanges={askChanges} />)}
          <TaskLines conversation={id} />
          {chat.busy || chat.waiting || sending ? (
            <div className="flex gap-3">
              <Robot size={32} mood={chat.partial ? 'talking' : 'thinking'} className="mt-0.5" />
              <div className="chat-glass min-w-0 flex-1">
                <div className="text-muted-foreground mb-1 text-xs">{name}</div>
                {chat.partial ? <Markdown>{chat.partial}</Markdown> : null}
                {chat.waiting ? <div className="text-muted-foreground text-[13px]" data-testid="chat-waiting-turn">{t('chat.waitingTurn')}</div> : <LiveActivity chat={chat} />}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <Composer value={text} onChange={setText} onSend={send} onStop={id != null ? () => act(call('chat.stop', { conversation: id })) : undefined} busy={chat.busy} disabled={sending} testid="chat-input"
        placeholder={chat.busy ? t('chat.placeholderBusy', { name }) : orchestrate ? t('chat.placeholder', { name }) : t('chat.placeholderDirect', { agent: AGENT[brain.agent] ?? brain.agent })}
        top={<>
          {/* 3.2.1: in God mode a new conversation takes the project chosen at the top of God mode. */}
          {inProject && id == null ? null : <ProjectPicker conversation={id} />}
          <ContextSlot items={[
            // 3.6: the context is filling up: compact it (the history stays; the assistant goes on from a summary).
            compactable ? { key: 'compact', node: <CompactButton onCompact={compact} busy={compacting} /> } : null,
            // 3.0: the test of the day (first opening of the day, until the user writes; always in Ajustes › Agentes y uso).
            showTest ? { key: 'test', node: <BubbleTip title={t('test.button')} text={t('test.tip')} side="top"><Button size="xs" variant="soft" onClick={() => runTest(t('test.prompt'))} data-testid="chat-test"><FlaskConical />{t('test.button')}</Button></BubbleTip> } : null
          ]} />
        </>}
        notice={<UsageBubble text={bubble.text} onClose={bubble.close} />}
        bottom={<>
          <BrainPicker catalog={catalog} value={brain} onChange={pickBrain} className="min-w-0 shrink" />
          <ReasoningMenu catalog={catalog} value={brain} onChange={(reasoning) => settings({ reasoning })} />
          {/* 3.2: whether a NEW conversation is with the assistant or directly with the agent chosen; a conversation keeps
              the way it started. 3.6: an icon and a small switch; the tooltip explains it. */}
          <OrchestratorSwitch on={orchestrate} onChange={toggleOrchestrator} name={name} cursor={brain.agent === 'cursor'} locked={id != null} />
          {context ? <span className="text-muted-foreground ml-auto shrink-0 text-xs"><ContextMeter context={context} /></span> : null}
        </>} />
    </>
  );
}

// The conversation's top bar pieces shared by the chat and an agent's conversation: the clock, the title, pause,
// «Compactar» and each message's time.
import { useEffect, useState } from 'react';
import { Pause, Play, ChevronLeft, ChevronRight, Folder, Shrink } from 'lucide-react';
import { ProjectIcon } from '@/components/project-icon.jsx';
import { Spinner } from '@/components/ui/basic.jsx';
import { Button } from '@/components/ui/button.jsx';
import { setQueuePaused } from '@/components/task-state.jsx';
import { BubbleTip, Popover, PopoverTrigger, PopoverContent } from '@/components/ui/overlay.jsx';
import { useStore, call } from '@/lib/store.js';
import { cn } from '@/lib/utils.js';
import { useT, useLocale } from '@/lib/i18n.js';
import { timeZone } from '@/lib/clock.js';
import { useDay } from '@/lib/use-day.js';

// 2.6: the system's date and time on the left of the chat's top bar (app.css .bar-clock, in the theme's title type).
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
// The time a message was written, small at its bottom right (the day too when it is not today). One formatter per
// language and time zone (toLocale…String builds one on every call, for every message). The message is memoised: the
// time follows the day by itself (lib/clock.js: after midnight, today's messages get their day; a new zone, new times).
const msgFormats = new Map();
const msgFormat = (locale, day) => {
  const k = `${locale}|${day}|${timeZone()}`;
  if (!msgFormats.has(k)) msgFormats.set(k, new Intl.DateTimeFormat(locale, day ? { day: 'numeric', month: 'short' } : { hour: '2-digit', minute: '2-digit' }));
  return msgFormats.get(k);
};
// hover (3.8.2, an agent's conversation): shown while the pointer is over the message (or it has the focus).
export function MsgTime({ at, hover = false }) {
  const locale = useLocale();
  useDay();
  if (!at) return null;
  const d = new Date(at); if (Number.isNaN(d.getTime())) return null;
  const today = d.toDateString() === new Date().toDateString();
  const time = msgFormat(locale, false).format(d);
  return <time className={hover ? 'msg-time msg-time-hover' : 'msg-time'} dateTime={d.toISOString()}>{today ? time : `${msgFormat(locale, true).format(d)} ${time}`}</time>;
}

// The bar's pause / resume of all of Orb's work (the chat's bar and an agent conversation's).
export function BarPause() {
  const t = useT();
  const paused = useStore((s) => Boolean(s.app?.paused));
  return paused
    ? <BubbleTip title={t('bar.resume')} text={t('bar.resumeText')}><Button variant="soft" size="icon-sm" onClick={() => setQueuePaused(false, t)} aria-label={t('bar.resume')} data-testid="bar-resume"><Play /></Button></BubbleTip>
    : <BubbleTip title={t('bar.pause')} text={t('bar.pauseText')}><Button variant="ghost" size="icon-sm" onClick={() => setQueuePaused(true, t)} aria-label={t('bar.pause')} data-testid="bar-pause"><Pause /></Button></BubbleTip>;
}
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

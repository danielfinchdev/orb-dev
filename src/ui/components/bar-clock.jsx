// The clock on the left of every view's header (app.css .bar-clock) and the month calendar it opens: the same
// pieces in the chat, in an agent's conversation and in every page.
import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { IconButton } from '@/components/ui/primitives.jsx';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/overlay.jsx';
import { cn } from '@/lib/utils.js';
import { useT, useLocale } from '@/lib/i18n.js';

// The system's date and time. With the pointer on it (or the calendar open) the seconds show too; a click opens the
// month's calendar.
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
    <div>
      <div className="orb-cal-h">
        <span className="orb-cal-title truncate" aria-live="polite" data-testid="bar-calendar-title">{shown.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}</span>
        <span className="flex gap-0.5">
          <IconButton label={t('chat.calendarPrev')} onClick={() => move(-1)}><ChevronLeft className="size-3.5" /></IconButton>
          <IconButton label={t('chat.calendarNext')} onClick={() => move(1)} data-testid="bar-calendar-next"><ChevronRight className="size-3.5" /></IconButton>
        </span>
      </div>
      <div className="orb-cal-grid" role="grid" aria-label={shown.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}>
        {names.map((n, i) => <span key={`h${i}`} className="orb-cal-head" role="columnheader">{n}</span>)}
        {cells.map((d, i) => <span key={i} role="gridcell" aria-current={isToday(d) ? 'date' : undefined} className={cn('orb-cal-day', !d && 'invisible', isToday(d) && 'is-today', (first + i) % 7 === 0 || (first + i) % 7 === 6 ? 'is-weekend' : '')}>{d ?? ''}</span>)}
      </div>
      {thisMonth ? null : <Button variant="outline" className="orb-cal-today" onClick={() => setShown(new Date(today.getFullYear(), today.getMonth(), 1))}>{t('chat.calendarToday')}</Button>}
    </div>
  );
}

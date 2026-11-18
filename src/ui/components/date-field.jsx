// A date as short text («5 nov», «hoy», «ayer») that opens a month calendar; the value is 'YYYY-MM-DD' (or '' for none).
// Keyboard: arrows move the day, PageUp/PageDown the month, Enter picks, Escape closes.
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { IconButton } from '@/components/ui/primitives.jsx';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/overlay.jsx';
import { cn } from '@/lib/utils.js';
import { useT, useLocale } from '@/lib/i18n.js';
import { toIso, fromIso, addDays, shortDate, monthGrid, inRange } from '@/lib/date-field.js';

function Calendar({ value, min, max, onPick, onClear }) {
  const t = useT();
  const locale = useLocale();
  const today = new Date();
  const [focus, setFocus] = useState(() => { const start = value || toIso(today); return inRange(start, min, max) ? start : (min && start < min ? min : max || start); });
  const grid = useRef(null);
  const first = (() => { try { const w = new Intl.Locale(locale).getWeekInfo?.() ?? new Intl.Locale(locale).weekInfo; return (w?.firstDay ?? 1) % 7; } catch { return 1; } })();
  const shown = fromIso(focus) ?? today;
  const weeks = monthGrid(shown.getFullYear(), shown.getMonth(), first);
  const names = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 7 + ((first + i) % 7)).toLocaleDateString(locale, { weekday: 'narrow' })); // 7 Jan 2024 was a Sunday
  const title = shown.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  const todayIso = toIso(today);
  // keyboard focus follows the highlighted day, but only once the user has moved it (the first render keeps the popover's own focus)
  const moved = useRef(false);
  useEffect(() => { if (moved.current) grid.current?.querySelector('[tabindex="0"]')?.focus(); }, [focus]);
  const go = (iso) => { moved.current = true; setFocus(iso); };
  const month = (n) => { const d = fromIso(focus); d.setDate(1); d.setMonth(d.getMonth() + n); const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); const day = Math.min(fromIso(focus).getDate(), last); go(toIso(new Date(d.getFullYear(), d.getMonth(), day, 12))); };
  const key = (e) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (step) { e.preventDefault(); go(addDays(focus, step)); } else if (e.key === 'PageUp' || e.key === 'PageDown') { e.preventDefault(); month(e.key === 'PageUp' ? -1 : 1); }
  };
  return (
    <div data-testid="date-calendar">
      <div className="orb-cal-h">
        <span className="orb-cal-title truncate" aria-live="polite">{title}</span>
        <span className="flex gap-0.5">
          <IconButton label={t('chat.calendarPrev')} onClick={() => month(-1)} data-testid="date-prev"><ChevronLeft className="size-3.5" /></IconButton>
          <IconButton label={t('chat.calendarNext')} onClick={() => month(1)} data-testid="date-next"><ChevronRight className="size-3.5" /></IconButton>
        </span>
      </div>
      <div ref={grid} className="orb-cal-grid" role="grid" aria-label={title} onKeyDown={key}>
        {names.map((n, i) => <span key={`h${i}`} className="orb-cal-head" role="columnheader">{n}</span>)}
        {weeks.flat().map((iso, i) => {
          if (!iso) return <span key={i} role="gridcell" className="orb-cal-day invisible" />;
          const off = !inRange(iso, min, max);
          return (
            <button key={iso} type="button" role="gridcell" tabIndex={iso === focus ? 0 : -1} disabled={off} aria-selected={iso === value} aria-current={iso === todayIso ? 'date' : undefined}
              aria-label={fromIso(iso).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} data-testid="date-day"
              className={cn('orb-cal-day hover:bg-accent cursor-pointer outline-none focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent', (first + i) % 7 === 0 || (first + i) % 7 === 6 ? 'is-weekend' : '', iso === todayIso && 'font-semibold', iso === value && 'bg-primary-soft! text-primary-text! font-semibold')}
              onClick={() => onPick(iso)}>{Number(iso.slice(8))}</button>
          );
        })}
      </div>
      <div className="mt-2 flex gap-2">
        <Button variant="outline" className="flex-1" disabled={!inRange(todayIso, min, max)} onClick={() => onPick(todayIso)}>{t('chat.calendarToday')}</Button>
        <Button variant="ghost" className="flex-1" disabled={!value} onClick={onClear} data-testid="date-clear">{t('logbooks.dateClear')}</Button>
      </div>
    </div>
  );
}

export function DateField({ value, onChange, min, max, label, placeholder, className, 'data-testid': testid }) {
  const t = useT();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const text = shortDate(value, { locale, labels: { today: t('logbooks.today'), yesterday: t('logbooks.yesterday') } });
  const done = (iso) => { onChange(iso); setOpen(false); };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={label} aria-haspopup="dialog" data-testid={testid} data-value={value || ''}
          className={cn('border-border bg-card text-control rounded-ctl flex h-(--ctl) w-30 cursor-pointer items-center border px-2.5 text-left transition-[color,border-color] outline-none focus-visible:border-input', text ? 'text-foreground' : 'text-faint-foreground', className)}>
          <span className="truncate">{text || placeholder || label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="orb-cal" aria-label={label}><Calendar value={value} min={min} max={max} onPick={done} onClear={() => done('')} /></PopoverContent>
    </Popover>
  );
}

// 3.2: the bell of the top bar. Everything Orb notified (lib/notify.js), newest first, with a dot while there are new
// ones; a notice with somewhere to go opens it.
import { useState } from 'react';
import { Bell, CircleCheck, CircleX, Info, TriangleAlert } from 'lucide-react';
import { Button } from './ui/button.jsx';
import { BubbleTip, Popover, PopoverTrigger, PopoverContent } from './ui/overlay.jsx';
import { useStore, go } from '@/lib/store.js';
import { markNoticesSeen, clearNotices } from '@/lib/notify.js';
import { cn } from '@/lib/utils.js';
import { useT, useLocale } from '@/lib/i18n.js';

const ICON = { success: [CircleCheck, 'text-success'], warning: [TriangleAlert, 'text-warning'], error: [CircleX, 'text-destructive'], info: [Info, 'text-primary'] };

function When({ at }) {
  const locale = useLocale();
  const d = new Date(at);
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  return <time className="notice-time" dateTime={d.toISOString()}>{d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString(locale, { day: 'numeric', month: 'short' })} ${time}`}</time>;
}

export function NotificationBell() {
  const t = useT();
  const notices = useStore((s) => s.notices) ?? [];
  const unread = useStore((s) => s.noticesUnread) === true;
  const [open, setOpen] = useState(false);
  const change = (next) => { setOpen(next); if (next) markNoticesSeen(); };
  const label = unread ? `${t('bar.notices')} · ${t('bar.noticesNew')}` : t('bar.notices');
  return (
    <Popover open={open} onOpenChange={change}>
      <BubbleTip title={t('bar.notices')} text={t('bar.noticesText')} off={open}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="relative" aria-label={label} data-testid="bar-notices">
            <Bell />
            {unread ? <span className="notice-dot" data-testid="bar-notices-dot" aria-hidden="true" /> : null}
          </Button>
        </PopoverTrigger>
      </BubbleTip>
      <PopoverContent side="bottom" align="end" className="notice-center" data-testid="notice-center">
        <div className="flex items-center gap-2 px-1 pb-1.5">
          <span className="orb-cal-title flex-1 text-[14px] font-semibold">{t('bar.notices')}</span>
          {notices.length ? <button type="button" className="orb-cal-today" onClick={clearNotices} data-testid="notice-clear">{t('bar.noticesClear')}</button> : null}
        </div>
        {!notices.length ? <p className="orb-tip-text px-1 py-3 text-center text-[13px]">{t('bar.noticesEmpty')}</p> : (
          <ul className="-mx-1 grid max-h-[min(24rem,60vh)] gap-0.5 overflow-y-auto">
            {notices.map((n) => {
              const [Icon, tone] = ICON[n.tone] ?? ICON.info;
              const body = (
                <>
                  <Icon className={cn('mt-0.5 size-4 shrink-0', tone)} />
                  <span className="min-w-0 flex-1">
                    {n.title ? <span className="orb-tip-title block text-[13px] font-medium">{n.title}</span> : null}
                    <span className={cn('block text-[12.5px] leading-snug break-words', n.title ? 'orb-tip-text' : 'orb-tip-title')}>{n.body}</span>
                    <span className="orb-tip-text mt-0.5 flex gap-1.5 text-[11px] opacity-80"><When at={n.at} />{n.count > 1 ? <span>· ×{n.count}</span> : null}</span>
                  </span>
                </>
              );
              return (
                <li key={n.id}>
                  {n.go
                    ? <button type="button" className="notice-row" onClick={() => { go(n.go); setOpen(false); }}>{body}</button>
                    : <div className="notice-row is-static">{body}</div>}
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

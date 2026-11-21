// The conversation's top bar pieces shared by the chat and an agent's conversation: the clock, the title, pause,
// «Compactar» and each message's time.
import { Pause, Play, Folder, FoldVertical } from 'lucide-react';
import { ProjectIcon } from '@/components/project-icon.jsx';
import { Spinner } from '@/components/ui/basic.jsx';
import { Button } from '@/components/ui/button.jsx';
import { setQueuePaused } from '@/components/task-state.jsx';
import { BubbleTip } from '@/components/ui/overlay.jsx';
import { useStore } from '@/lib/store.js';
import { cn } from '@/lib/utils.js';
import { useT, useLocale } from '@/lib/i18n.js';
import { timeZone } from '@/lib/clock.js';
import { useDay } from '@/lib/use-day.js';

// The clock and its calendar (the left of every header) live in components/bar-clock.jsx.
export { BarClock } from '@/components/bar-clock.jsx';
// The time a message was written, small at its bottom right (the day too when it is not today). One formatter per
// language and time zone (toLocale…String builds one on every call, for every message). The message is memoised: the
// time follows the day by itself (lib/clock.js: after midnight, today's messages get their day; a new zone, new times).
const msgFormats = new Map();
const msgFormat = (locale, day) => {
  const k = `${locale}|${day}|${timeZone()}`;
  if (!msgFormats.has(k)) msgFormats.set(k, new Intl.DateTimeFormat(locale, day ? { day: 'numeric', month: 'short' } : { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }));
  return msgFormats.get(k);
};
// hover (an agent's conversation): shown while the pointer is over the message (or it has the focus).
// inline: in the message's header, not floating at the end of its text.
export function MsgTime({ at, hover = false, inline = false }) {
  const locale = useLocale();
  useDay();
  if (!at) return null;
  const d = new Date(at); if (Number.isNaN(d.getTime())) return null;
  const today = d.toDateString() === new Date().toDateString();
  const time = msgFormat(locale, false).format(d);
  return <time className={cn(hover ? 'msg-time msg-time-hover' : 'msg-time', inline && 'msg-time-inline')} dateTime={d.toISOString()}>{today ? time : `${msgFormat(locale, true).format(d)} ${time}`}</time>;
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

// the share of the context at which the composer suggests «Compactar» (DESIGN-SYSTEM §2.2).
export const COMPACT_AT = 0.7;
// «Compactar» in the contextual slot: the conversation goes on from a summary; nothing of the history is lost.
// percent: how full the context is, shown after the name (the chat with the assistant).
// reason: why it cannot be used now; the button stays in its place, disabled, and its bubble says why.
export function CompactButton({ onCompact, busy, percent = null, reason = null }) {
  const t = useT();
  const button = <Button size="xs" variant="ghost" className="text-muted-foreground font-normal" onClick={onCompact} disabled={busy || Boolean(reason)} data-testid="chat-compact">{busy ? <Spinner /> : <FoldVertical />}{busy ? t('compact.busy') : t('compact.button')}{!busy && percent != null ? ` · ${percent} %` : ''}</Button>;
  return (
    <BubbleTip title={t('compact.title')} text={reason ?? t('compact.tip')} side="top">
      {reason ? <span className="inline-flex">{button}</span> : button}
    </BubbleTip>
  );
}

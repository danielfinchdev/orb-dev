// The one anatomy of a message in a chat. On the PC (the mock-up's .me and plain answer): the person's message is a grey pill on
// the right, the answer is plain text without name, avatar or box, and under it a quiet row with copy and the time. Edit, pin and
// the message's other actions appear on hover or keyboard focus (always on a touch screen); a pinned message keeps its mark in view.
// The phone and a linked browser keep the avatar, name and time on top, with the bubble and the glass card.
import { useRef } from 'react';
import { Copy, Pin } from 'lucide-react';
import { Robot } from '@/components/robot.jsx';
import { MsgTime } from '@/components/conversation/bar.jsx';
import { IconButton } from '@/components/ui/primitives.jsx';
import { fullPc } from '@/lib/store.js';
import { notifyOk } from '@/lib/notify.js';
import { quiet } from '@/lib/quiet.js';
import { cn } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';

// icon: replaces the robot in front of the assistant's name (an agent's conversation shows that agent's own icon); phone only.
// pin: { pinned, onToggle } adds the pin button (hidden until the message is hovered or focused, always shown when pinned).
export function MessageBox({ user = false, name, at, actions, icon, pin, className, children, ...props }) {
  const t = useT();
  const body = useRef(null);
  if (fullPc()) {
    const copy = () => navigator.clipboard?.writeText(String(body.current?.innerText ?? '').trim()).then(() => notifyOk(t('msg.copied'))).catch(quiet);
    // hidden until the message is hovered or focused; shown at once on a touch screen
    const reveal = 'opacity-0 transition-opacity group-hover/msg:opacity-100 group-focus-within/msg:opacity-100 [@media(hover:none)]:opacity-100';
    const pinButton = pin ? <IconButton small label={pin.pinned ? t('pins.unpin') : t('pins.pin')} title={pin.pinned ? t('pins.unpin') : t('pins.pin')} aria-pressed={pin.pinned} onClick={pin.onToggle} className={pin.pinned ? 'text-primary-text' : reveal} data-testid="msg-pin"><Pin className={cn(pin.pinned && 'fill-current')} /></IconButton> : null;
    return (
      <article className={cn('msg-box group/msg flex min-w-0 flex-col', user ? 'ml-auto max-w-[80%] items-end' : 'items-start', className)} data-role={user ? 'user' : 'assistant'} {...props}>
        {/* the name stays for screen readers (and out of the trail's text, like the phone's header) */}
        <span className="msg-box-head sr-only" data-testid="msg-name">{name}</span>
        <div ref={body} className={cn('min-w-0 max-w-full break-words', user && 'bg-bubble text-bubble-foreground rounded-big px-3.5 py-[9px] whitespace-pre-wrap compact:text-body')}>{children}</div>
        {/* the person's row hangs under the pill without taking room: it only shows on hover */}
        <div className={cn('chat-actions text-faint-foreground flex flex-wrap gap-1 text-caption', user ? 'relative z-10 h-0 items-start justify-end' : 'items-center -mt-1')}>
          {user ? null : <IconButton small label={t('msg.copy')} onClick={copy} data-testid="msg-copy"><Copy /></IconButton>}
          <span className={cn('inline-flex items-center', user && cn('h-6', reveal))}><MsgTime at={at} inline /></span>
          {pinButton}
          {actions ? <span className={cn('inline-flex flex-wrap items-center gap-1', user && reveal)}>{actions}</span> : null}
        </div>
      </article>
    );
  }
  const initial = String(name ?? '').trim().charAt(0).toUpperCase();
  return (
    <article className={cn('msg-box group/msg min-w-0', user ? 'bg-bubble text-bubble-foreground ml-auto max-w-[80%] rounded-big px-3.5 py-[9px] compact:text-body' : 'chat-glass', className)} data-role={user ? 'user' : 'assistant'} {...props}>
      <header className={cn('msg-box-head mb-1 flex items-center gap-2 text-xs', user ? 'opacity-80' : 'text-muted-foreground')}>
        {user
          ? <span className="bg-muted text-muted-foreground grid size-5 shrink-0 place-items-center rounded-full font-medium" aria-hidden="true">{initial}</span>
          : icon ?? <Robot size={20} still mark className="shrink-0" />}
        <span className="min-w-0 truncate font-medium" data-testid="msg-name">{name}</span>
        <MsgTime at={at} inline />
        {pin ? <button type="button" onClick={pin.onToggle} aria-pressed={pin.pinned} aria-label={pin.pinned ? t('pins.unpin') : t('pins.pin')} title={pin.pinned ? t('pins.unpin') : t('pins.pin')} className={cn('ml-auto cursor-pointer rounded p-1 transition-opacity hover:bg-black/10 focus-visible:opacity-100', pin.pinned ? 'opacity-100' : 'opacity-0 group-hover/msg:opacity-100')} data-testid="msg-pin"><Pin className={cn('size-3.5', pin.pinned && 'fill-current')} aria-hidden="true" /></button> : null}
      </header>
      <div className={cn('min-w-0 break-words', user && 'whitespace-pre-wrap')}>{children}</div>
      {actions ? <div className="chat-actions mt-2.5 flex flex-wrap items-center gap-2">{actions}</div> : null}
    </article>
  );
}

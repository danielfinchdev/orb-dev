// The one anatomy of a message in a chat: avatar, name and time on top, then the content, then its actions.
// `user` messages keep the bubble on the right; the assistant's sit on the glass card.
import { Pin } from 'lucide-react';
import { Robot } from '@/components/robot.jsx';
import { MsgTime } from '@/components/conversation/bar.jsx';
import { cn } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';

// icon: replaces the robot in front of the assistant's name (an agent's conversation shows that agent's own icon).
// pin: { pinned, onToggle } adds the pin button on the header (hidden until the message is hovered or focused, always shown when pinned).
export function MessageBox({ user = false, name, at, actions, icon, pin, className, children, ...props }) {
  const t = useT();
  const initial = String(name ?? '').trim().charAt(0).toUpperCase();
  return (
    <article className={cn('msg-box group/msg min-w-0', user ? 'bg-bubble text-bubble-foreground ml-auto max-w-[80%] rounded-2xl rounded-br-md px-4 py-2.5 compact:text-body' : 'chat-glass', className)} data-role={user ? 'user' : 'assistant'} {...props}>
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

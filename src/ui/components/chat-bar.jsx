// the bar of a conversation (views/chat.jsx): its title block, which opens the chat's info, and its buttons on the right.
import { ChevronLeft } from 'lucide-react';
import { Button } from './ui/button.jsx';
import { SidebarToggle } from './theme-toggle.jsx';
import { AppBar } from './page.jsx';
import { BarClock } from './bar-clock.jsx';
import { useStore, go, phoneLayout } from '@/lib/store.js';
import { cn } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';

// The header of a conversation: the common one (clock · title block · actions) on the PC; on the phone the back arrow,
// the title and the buttons in a row.
// `inner`: the conversation lives inside another screen, which already has the clock and the window's buttons.
export function ChatBar({ back, title, children, testid = 'chat-bar', className, inner = false }) {
  const phone = phoneLayout();
  const folded = useStore((s) => s.sidebarCollapsed);
  if (!phone) {
    return (
      <AppBar inner={inner} className={cn('chat-bar', className)} data-testid={testid} lead={inner ? null : <>{back}{folded ? <SidebarToggle collapsed className="-ml-1" /> : null}</>} left={inner ? null : <BarClock />} center={title}>
        {children}
      </AppBar>
    );
  }
  return (
    <header className={cn('relative topbar chat-bar theme-band app-titlebar bg-background/80 flex min-h-14 shrink-0 items-center gap-2 border-b px-3 py-1.5 backdrop-blur sm:px-4', className)} data-testid={testid}>
      {back}
      <div className="no-drag flex min-w-0 flex-1 items-center">{title}</div>
      <div className="no-drag flex shrink-0 items-center gap-1">{children}</div>
    </header>
  );
}

// The phone's back arrow to the zone's chat list (the PC has the list beside).
export function BackToList({ to }) {
  const t = useT();
  if (!phoneLayout()) return null;
  return <Button size="icon" variant="ghost" className="-ml-2 shrink-0" onClick={() => go({ view: to })} aria-label={t('chats.backToList')} data-testid="chat-back"><ChevronLeft className="size-6" /></Button>;
}

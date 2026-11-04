// 3.6 (messaging): the bar of a conversation in both zones: (phone: the back arrow) the header pill, which opens the
// chat's info, and its buttons on the right. Bots: views/bots/chat.jsx; Orb: views/chat.jsx.
import { ChevronLeft } from 'lucide-react';
import { Button } from './ui/button.jsx';
import { SidebarToggle } from './theme-toggle.jsx';
import { useStore, go, phoneLayout } from '@/lib/store.js';
import { cn } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';

export function ChatBar({ back, title, children, testid = 'bot-chat-bar', className }) {
  const phone = phoneLayout();
  const folded = useStore((s) => s.sidebarCollapsed);
  return (
    <header className={cn('topbar chat-bar theme-band app-titlebar wco-pad-md bg-background/80 flex min-h-14 shrink-0 items-center gap-2 border-b px-3 py-1.5 backdrop-blur sm:px-4', phone && 'pt-[max(0.375rem,env(safe-area-inset-top))]', className)} data-testid={testid}>
      {back}{folded && !phone ? <SidebarToggle collapsed className="-ml-1" /> : null}
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

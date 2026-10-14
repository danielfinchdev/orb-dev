import { cn } from '@/lib/utils.js';
import { useStore } from '@/lib/store.js';
import { SidebarToggle } from './theme-toggle.jsx';

export function PageHeader({ icon, title, meta, center, children, className }) {
  // 2.6: with the sidebar folded away, the button that brings it back starts the bar.
  const folded = useStore((s) => s.sidebarCollapsed);
  // 3.2: something in the very middle of the bar (the chat's working folder): three columns, the sides of equal width,
  // so it stays centred whatever is on each side.
  // 3.2.1: by the width of the bar itself, not of the window (a container query): the chat inside God mode is narrow in
  // a wide window. And the sides never shrink below what they hold: the middle gives way and is cut with «…» instead of
  // drawing over the clock or the buttons.
  if (center) return (
    <div className="@container shrink-0">
      <header className={cn('topbar theme-band app-titlebar wco-pad-md bg-background/80 flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2.5 backdrop-blur @2xl:grid @2xl:flex-nowrap @2xl:grid-cols-[minmax(max-content,1fr)_minmax(0,auto)_minmax(max-content,1fr)] @2xl:px-5', className)}>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {folded ? <SidebarToggle collapsed className="-ml-1.5" /> : null}
          {icon}
          <h1 className="min-w-0 text-[16px] leading-tight">{title}</h1>
        </div>
        {/* Too narrow for three (a phone, a side panel): the middle goes to a line of its own, under the clock and the buttons. */}
        <div className="order-last flex min-w-0 basis-full justify-center overflow-hidden @2xl:order-none @2xl:max-w-[28rem] @2xl:basis-auto">{center}</div>
        <div className="flex min-w-0 items-center justify-end gap-2">{children}</div>
      </header>
    </div>
  );
  return (
    <header className={cn('topbar theme-band app-titlebar wco-pad-md bg-background/80 flex min-h-14 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2.5 backdrop-blur sm:px-5', className)}>
      {folded ? <SidebarToggle collapsed className="-ml-1.5" /> : null}
      {icon}
      {/* On a phone the buttons go under the title instead of squeezing it. */}
      <div className="min-w-[9rem] flex-1">
        <h1 className="truncate text-[16px] leading-tight">{title}</h1>
        {meta ? <div className="text-muted-foreground truncate text-xs">{meta}</div> : null}
      </div>
      {children ? <div className="flex max-w-full flex-wrap items-center gap-2">{children}</div> : null}
    </header>
  );
}

export function PageBody({ className, children }) {
  return <div className={cn('min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-5 py-5', className)}>{children}</div>;
}

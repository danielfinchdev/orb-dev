import { ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { useStore, go, phoneLayout } from '@/lib/store.js';
import { useT } from '@/lib/i18n.js';
import { Button } from './ui/button.jsx';
import { BarClock } from './bar-clock.jsx';
import { SidebarToggle } from './theme-toggle.jsx';
import { MobileMenu } from './mobile-menu.jsx';
import { WindowControlsSlot } from './window-controls.jsx';

// The header every view of the PC app shares (app.css .bar): the clock on the left, the title with a useful line under
// it in the middle, the view's actions on the right, and the window's own buttons in the 120 px kept at the end
// (window-controls.jsx). `left` is the clock unless a view brings its own; `center` the title block.
// `inner`: a bar inside a pane (the chat embedded in the God mode): it does not drag the window nor keep room for its buttons.
export function AppBar({ lead, left, center, children, className, inner = false, ...props }) {
  return (
    <header className={cn('bar topbar theme-band', !inner && 'app-titlebar', className)} {...props}>
      <div className="bar-left">{lead}{left}</div>
      <div className="bar-center">{center}</div>
      <div className="bar-right">{children}</div>
      {inner ? null : <WindowControlsSlot />}
    </header>
  );
}

// `meta`: the line under the title (counts, the project…). `center`: the view draws the whole middle itself and `title`
// then takes the clock's place.
export function PageHeader({ title, meta, center, children, className, back }) {
  // with the sidebar folded away, the button that brings it back starts the bar.
  const folded = useStore((s) => s.sidebarCollapsed);
  // the phone: the menu ☰ starts every bar (the status bar's room is the page's own, app.css › #root).
  const phone = phoneLayout();
  if (!phone) {
    return (
      <AppBar className={className} lead={folded ? <SidebarToggle collapsed className="-ml-1.5" /> : null}
        left={center ? title : <BarClock />}
        center={center ?? <><h1 className="name">{title}</h1>{meta ? <div className="sub">{typeof meta === 'string' ? <span className="min-w-0 truncate">{meta}</span> : meta}</div> : null}</>}>
        {children}
      </AppBar>
    );
  }
  // a screen that takes the whole phone (a conversation) has its back arrow there instead.
  const menu = back ?? <MobileMenu />;
  if (center) return (
    <div className="@container shrink-0">
      <header className={cn('relative topbar theme-band app-titlebar bg-background/80 flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2.5 backdrop-blur @2xl:grid @2xl:flex-nowrap @2xl:grid-cols-[minmax(max-content,1fr)_minmax(0,auto)_minmax(max-content,1fr)] @2xl:px-5', className)}>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {menu}
          <h1 className="min-w-0 text-title leading-tight">{title}</h1>
        </div>
        <div className="order-last flex min-w-0 basis-full justify-center overflow-hidden @2xl:order-none @2xl:max-w-[28rem] @2xl:basis-auto">{center}</div>
        <div className="flex min-w-0 items-center justify-end gap-2">{children}</div>
      </header>
    </div>
  );
  return (
    <header className={cn('relative topbar theme-band app-titlebar bg-background/80 flex min-h-14 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2.5 backdrop-blur sm:px-5', className)}>
      {menu}
      {/* On a phone the buttons go under the title instead of squeezing it. */}
      <div className="min-w-[9rem] flex-1">
        <h1 className="truncate text-title leading-tight">{title}</h1>
        {meta ? <div className="text-muted-foreground truncate text-xs">{meta}</div> : null}
      </div>
      {children ? <div className="flex max-w-full flex-wrap items-center gap-2">{children}</div> : null}
    </header>
  );
}

// the phone: the back arrow of a screen opened from a list (a task, a project), in place of the menu ☰.
export function BackButton({ to, label }) {
  const t = useT();
  return <Button size="icon" variant="ghost" className="-ml-2 shrink-0" onClick={() => go(to)} aria-label={label ?? t('comp.backToList')} data-testid="page-back"><ChevronLeft className="size-6" /></Button>;
}

// The scrolling body under a PageHeader. `column`: one centred column for a list.
export function PageBody({ className, column = false, children, ...props }) {
  return <div className={cn('min-h-0 flex-1 overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable] py-5 pr-[calc(1.5rem-var(--sb-w))] pl-6', className)} {...props}>{column ? <div className="mx-auto w-full max-w-3xl">{children}</div> : children}</div>;
}

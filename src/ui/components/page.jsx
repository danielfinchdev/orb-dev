import { cn } from '@/lib/utils.js';
import { useStore } from '@/lib/store.js';
import { SidebarToggle } from './theme-toggle.jsx';

export function PageHeader({ icon, title, meta, children, className }) {
  // 2.6: with the sidebar folded away, the button that brings it back starts the bar.
  const folded = useStore((s) => s.sidebarCollapsed);
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

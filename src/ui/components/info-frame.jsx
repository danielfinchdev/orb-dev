// A chat's info frame (a pane on the right on the PC, a full sheet on the phone), its groups of rows and a row. Used by the
// info of a chat and of a project (views/orb/info.jsx).
import { X, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/overlay.jsx';
import { phoneLayout } from '@/lib/store.js';
import { cn } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';

// The frame: a pane (PC) or a full sheet (phone).
export function InfoFrame({ title, onClose, children }) {
  const t = useT();
  if (phoneLayout()) return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent data-sheet="full" showClose={false} className="flex flex-col gap-3 overflow-y-auto *:shrink-0" data-testid="chat-info">
        <div className="grid grid-cols-[40px_1fr_40px] items-center">
          <Button type="button" size="icon" variant="ghost" onClick={onClose} aria-label={t('comp.close')} data-testid="chat-info-close"><X /></Button>
          <DialogTitle className="text-center text-base font-semibold">{title}</DialogTitle>
        </div>
        <DialogDescription className="sr-only">{title}</DialogDescription>
        {children}
      </DialogContent>
    </Dialog>
  );
  return (
    <aside className="bg-sidebar/60 flex w-[340px] shrink-0 flex-col border-l" aria-label={title} data-testid="chat-info">
      <div className="app-titlebar flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{title}</h2>
        <Button size="icon-sm" variant="ghost" className="no-drag" onClick={onClose} aria-label={t('comp.close')} data-testid="chat-info-close"><X /></Button>
      </div>
      <div className="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto px-4 py-5">{children}</div>
    </aside>
  );
}

// A group of rows (DESIGN-SYSTEM §4: list group) and a row: icon, label, value, chevron when it opens something.
export const List = ({ children, testid }) => <div className="bg-card divide-y overflow-hidden rounded-2xl border" data-testid={testid}>{children}</div>;
export function Row({ icon: Icon, label, value, onClick, danger, testid, children }) {
  const inner = (<>
    {Icon ? <Icon className={cn('size-[18px] shrink-0', danger ? 'text-destructive' : 'text-muted-foreground')} /> : null}
    <span className={cn('truncate', value != null ? 'shrink-0' : 'min-w-0 flex-1')}>{label}</span>
    {value != null ? <span className="text-muted-foreground min-w-0 flex-1 truncate text-right text-[13px]">{value}</span> : null}
    {children}
    {onClick && !danger && !children ? <ChevronRight className="text-muted-foreground size-4 shrink-0" /> : null}
  </>);
  const cls = cn('flex min-h-11 w-full items-center gap-3 px-3.5 py-2 text-left text-[14px]', danger && 'text-destructive', onClick && 'hover:bg-accent/50 cursor-pointer');
  return onClick ? <button type="button" className={cls} onClick={onClick} data-testid={testid}>{inner}</button> : <div className={cls} data-testid={testid}>{inner}</div>;
}

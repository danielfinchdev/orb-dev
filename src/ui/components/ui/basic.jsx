// Small shadcn/ui primitives: card, badge, input, textarea, label, separator, kbd.
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils.js';
import { BubbleTip } from './overlay.jsx';

export function Card({ className, ...props }) {
  return <div data-slot="card" className={cn('bg-card text-card-foreground flex flex-col gap-4 rounded-xl border py-5 shadow-xs', className)} {...props} />;
}
export function CardHeader({ className, ...props }) { return <div className={cn('flex flex-col gap-1 px-5', className)} {...props} />; }
export function CardTitle({ className, ...props }) { return <div data-slot="card-title" className={cn('leading-none font-medium text-[15px]', className)} {...props} />; }
export function CardDescription({ className, ...props }) { return <div className={cn('text-muted-foreground text-[13px]', className)} {...props} />; }
export function CardContent({ className, ...props }) { return <div className={cn('px-5', className)} {...props} />; }
export function CardFooter({ className, ...props }) { return <div className={cn('flex items-center gap-2 px-5', className)} {...props} />; }

const badgeVariants = cva('inline-flex items-center justify-center rounded-full border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none', {
  variants: {
    variant: {
      default: 'border-transparent bg-primary/12 text-primary',
      secondary: 'border-transparent bg-secondary text-secondary-foreground',
      outline: 'text-foreground',
      success: 'border-transparent bg-success/14 text-success',
      warning: 'border-transparent bg-warning/18 text-warning',
      destructive: 'border-transparent bg-destructive/12 text-destructive',
      info: 'border-transparent bg-info/14 text-info'
    }
  },
  defaultVariants: { variant: 'default' }
});
export function Badge({ className, variant, ...props }) { return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />; }

export function Input({ className, type = 'text', ...props }) {
  return <input type={type} data-slot="input" className={cn('placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input flex h-9 w-full min-w-0 rounded-lg border bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none disabled:opacity-50 focus-visible:border-ring focus-visible:ring-ring/40 focus-visible:ring-[3px]', className)} {...props} />;
}
export function Textarea({ className, ...props }) {
  return <textarea data-slot="textarea" className={cn('placeholder:text-muted-foreground dark:bg-input/30 border-input flex field-sizing-content min-h-16 w-full rounded-lg border bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/40 focus-visible:ring-[3px] disabled:opacity-50', className)} {...props} />;
}
export function Label({ className, ...props }) { return <label data-slot="label" className={cn('flex items-center gap-2 text-[13px] leading-none font-medium select-none', className)} {...props} />; }
export function Field({ label, hint, children, className }) {
  // min-w-0: a field in a grid or flex row may shrink below its control's one-line text (which then cuts) instead of widening the row.
  // content-start: fields side by side keep their label and control at the same height even when only one has a hint.
  return <div className={cn('grid min-w-0 content-start gap-1.5', className)}><Label>{label}</Label>{children}{hint ? <p className="text-muted-foreground text-xs leading-snug">{hint}</p> : null}</div>;
}
// A file path on one line: cut in the middle so its start and its end stay readable, the whole path in a bubble.
export function PathText({ path, className, tail = 20 }) {
  if (!path) return null;
  const cut = Math.min(tail, Math.floor(path.length / 2));
  return (
    <BubbleTip text={path} wide side="top">
      <span className={cn('inline-flex max-w-full min-w-0 font-mono whitespace-nowrap', className)} dir="ltr">
        <span className="min-w-0 shrink overflow-hidden text-ellipsis">{path.slice(0, path.length - cut)}</span><span className="shrink-0">{path.slice(path.length - cut)}</span>
      </span>
    </BubbleTip>
  );
}
export function Separator({ className, vertical = false }) { return <div role="separator" className={cn('bg-border shrink-0', vertical ? 'h-full w-px' : 'h-px w-full', className)} />; }
export function Kbd({ className, ...props }) { return <kbd className={cn('bg-muted text-muted-foreground pointer-events-none inline-flex h-5 items-center rounded border px-1.5 font-mono text-[10px]', className)} {...props} />; }
export function Spinner({ className }) { return <span className={cn('inline-block size-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary', className)} />; }
export function Empty({ icon: Icon, title, children, className }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 py-14 text-center', className)}>
      {Icon ? <div className="bg-muted text-muted-foreground mb-1 grid size-11 place-items-center rounded-xl"><Icon className="size-5" /></div> : null}
      {title ? <div className="font-medium">{title}</div> : null}
      {children ? <div className="text-muted-foreground max-w-sm text-sm">{children}</div> : null}
    </div>
  );
}

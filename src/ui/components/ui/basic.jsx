// Small shadcn/ui primitives: card, badge, input, textarea, label, separator, kbd.
import { Children, Fragment, cloneElement, isValidElement, useId } from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils.js';
import { BubbleTip } from './overlay.jsx';

export function Card({ className, ...props }) {
  return <div data-slot="card" className={cn('bg-card text-card-foreground flex flex-col gap-2.5 rounded-card border border-border py-2.5', className)} {...props} />;
}
export function CardHeader({ className, ...props }) { return <div className={cn('flex flex-col gap-1 px-3', className)} {...props} />; }
export function CardTitle({ className, ...props }) { return <div data-slot="card-title" className={cn('font-(family-name:--title) leading-tight font-semibold text-card-title', className)} {...props} />; }
export function CardDescription({ className, ...props }) { return <div className={cn('text-muted-foreground text-control', className)} {...props} />; }
export function CardContent({ className, ...props }) { return <div className={cn('px-3', className)} {...props} />; }
export function CardFooter({ className, ...props }) { return <div className={cn('flex items-center gap-2 px-3', className)} {...props} />; }

// The mock-up's .badge: 20 px pill, 11 px semibold; each variant is one of its tones (.ok .warn .err .info .acc).
const badgeVariants = cva('inline-flex h-5 items-center justify-center gap-1 rounded-full border border-transparent px-2 text-micro font-semibold w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 [&>svg]:pointer-events-none', {
  variants: {
    variant: {
      default: 'bg-primary-soft text-primary-text',
      secondary: 'bg-secondary text-muted-foreground',
      outline: 'border-border bg-transparent text-muted-foreground',
      success: 'bg-success-soft text-success',
      warning: 'bg-warning-soft text-warning-ink',
      destructive: 'bg-[color-mix(in_oklab,var(--destructive)_14%,transparent)] text-destructive',
      info: 'bg-[color-mix(in_oklab,var(--info)_14%,transparent)] text-info'
    }
  },
  defaultVariants: { variant: 'default' }
});
export function Badge({ className, variant, ...props }) { return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />; }

export function Input({ className, type = 'text', ...props }) {
  return <input type={type} data-slot="input" className={cn('placeholder:text-faint-foreground selection:bg-primary selection:text-primary-foreground border-border bg-card text-foreground rounded-ctl flex h-(--ctl) w-full min-w-0 border px-2.5 text-control transition-[color,border-color] outline-none disabled:opacity-45 focus-visible:border-input', className)} {...props} />;
}
export function Textarea({ className, ...props }) {
  return <textarea data-slot="textarea" className={cn('placeholder:text-faint-foreground border-border bg-card text-foreground rounded-ctl flex field-sizing-content min-h-16 w-full border px-2.5 py-1.5 text-control transition-[color,border-color] outline-none focus-visible:border-input disabled:opacity-45', className)} {...props} />;
}
export function Label({ className, ...props }) { return <label data-slot="label" className={cn('flex items-center gap-2 text-control leading-none font-medium select-none', className)} {...props} />; }
// The reason a field was refused, right under it (never in a toast away from the field). role=alert so it is announced.
export function FieldError({ id, className, children }) {
  if (!children) return null;
  return <p id={id} role="alert" className={cn('text-destructive text-xs leading-snug', className)}>{children}</p>;
}
export function Field({ label, hint, error, children, className }) {
  // min-w-0: a field in a grid or flex row may shrink below its control's one-line text (which then cuts) instead of widening the row.
  // content-start: fields side by side keep their label and control at the same height even when only one has a hint.
  const uid = useId();
  // Only a lone element child can be the control; its own id wins, and anything else (several nodes, a fragment, text) is left untouched.
  const only = Children.count(children) === 1 && isValidElement(children) && children.type !== Fragment ? children : null;
  const controlId = only ? (only.props.id ?? `${uid}-c`) : undefined;
  const hintId = hint ? `${uid}-h` : undefined;
  const errorId = error ? `${uid}-e` : undefined;
  const describedBy = [only?.props['aria-describedby'], hintId, errorId].filter(Boolean).join(' ');
  const control = only ? cloneElement(only, { id: controlId, ...(describedBy ? { 'aria-describedby': describedBy } : null), ...(error ? { 'aria-invalid': true } : null) }) : children;
  return <div className={cn('grid min-w-0 content-start gap-1.5', className)}><Label htmlFor={controlId}>{label}</Label>{control}{hint ? <p id={hintId} className="text-muted-foreground text-xs leading-snug">{hint}</p> : null}<FieldError id={errorId}>{error}</FieldError></div>;
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
export function Separator({ className, vertical = false }) { return <div role="separator" data-slot="separator" className={cn('bg-border shrink-0', vertical ? 'h-full w-px' : 'h-px w-full', className)} />; }
export function Kbd({ className, ...props }) { return <kbd className={cn('bg-secondary text-muted-foreground pointer-events-none inline-flex h-5 items-center rounded-ctl border border-border px-1.5 font-mono text-micro', className)} {...props} />; }
export function Spinner({ className }) { return <span className={cn('inline-block size-4 animate-spin rounded-full border-2 border-border border-t-muted-foreground', className)} />; }
export function Empty({ icon: Icon, title, children, className }) {
  return (
    <div data-slot="empty" className={cn('text-muted-foreground flex flex-col items-center justify-center gap-1.5 px-6 py-12 text-center', className)}>
      {Icon ? <Icon className="text-faint-foreground size-6" /> : null}
      {title ? <div className="text-foreground font-(family-name:--title) text-card-title font-semibold">{title}</div> : null}
      {children ? <div className="text-muted-foreground max-w-sm text-control">{children}</div> : null}
    </div>
  );
}

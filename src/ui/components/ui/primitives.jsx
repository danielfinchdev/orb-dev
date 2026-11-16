// Small pieces every screen repeats, built once so they look and behave the same everywhere. They use the tokens of
// tokens.css only. «Selected» (aria-selected / data-active, a lasting fact) is drawn apart from «pointer over» (a
// passing hover): selected is a filled row, hover is a lighter wash.
import { Ellipsis, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';
import { Button } from './button.jsx';
import { Input, FieldError } from './basic.jsx';

export { FieldError };

// An icon-only button. `label` is the accessible name and is required; the hit area is 32 px, 44 px on touch.
export function IconButton({ label, children, className, variant = 'ghost', active, ...props }) {
  if (!label && import.meta.env?.DEV) console.error('IconButton needs a label (aria-label)');
  return (
    <Button type="button" size="icon-sm" variant={variant} aria-label={label} data-active={active ? 'true' : undefined} aria-pressed={active === undefined ? undefined : Boolean(active)}
      className={cn('pointer-coarse:size-11 data-[active=true]:bg-accent data-[active=true]:text-accent-foreground', className)} {...props}>
      {children}
    </Button>
  );
}

// «⋯»: opens the menu of more actions.
export function MoreButton({ label, className, ...props }) {
  const t = useT();
  return <IconButton label={label ?? t('nav.more')} className={className} {...props}><Ellipsis /></IconButton>;
}

// «✕»: closes a panel, a card or a note.
export function CloseButton({ label, className, ...props }) {
  const t = useT();
  return <IconButton label={label ?? t('comp.close')} className={className} {...props}><X /></IconButton>;
}

const NOTE_TONES = {
  neutral: 'bg-muted/50',
  info: 'bg-info/10 border-info/30',
  warning: 'bg-warning/10 border-warning/40',
  danger: 'bg-destructive/10 border-destructive/40',
  success: 'bg-success/10 border-success/40'
};
// A notice in the flow of a page (not a popup): why something waits, what to know before acting.
const NOTE_ICON = { neutral: 'text-muted-foreground', warning: 'text-warning-ink' };
export function Note({ tone = 'neutral', icon: Icon, className, children, ...props }) {
  return (
    <div role={tone === 'danger' ? 'alert' : 'note'} className={cn('flex items-start gap-2 rounded-xl border px-3.5 py-2.5 text-control', NOTE_TONES[tone] ?? NOTE_TONES.neutral, className)} {...props}>
      {Icon ? <Icon className={cn('mt-0.5 size-4 shrink-0', NOTE_ICON[tone])} /> : null}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

// Pick one of a few: a pill bar. options: [{ value, label, testid? }]; the chosen one is `aria-selected`.
export function Segmented({ value, onChange, options, className, itemTestId, ...props }) {
  return (
    <div className={cn('bg-muted inline-flex rounded-lg p-[3px]', className)} role="tablist" {...props}>
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value} data-testid={o.testid ?? itemTestId?.(o.value)} onClick={() => onChange(o.value)}
          className={cn('cursor-pointer rounded-md px-3 py-1 text-control transition-colors', value === o.value ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// A search field with its magnifier; the accessible name is the placeholder unless `label` says otherwise.
export function SearchInput({ value, onChange, placeholder, label, className, inputClassName, ...props }) {
  return (
    <div className={cn('relative', className)}>
      <Search className="text-muted-foreground pointer-events-none absolute top-2.5 left-2.5 size-4" />
      <Input className={cn('h-8 w-64 max-w-full pl-8', inputClassName)} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label ?? placeholder} {...props} />
    </div>
  );
}

const rowState = (active) => (active ? 'bg-accent text-accent-foreground' : 'text-foreground/80 hover:bg-accent/50 hover:text-foreground');

// A place in a menu (the sidebar). `active`: it is the page on screen.
export function NavRow({ icon: Icon, iconEl, label, active, onClick, children, testid, className }) {
  return (
    <button type="button" data-testid={testid} onClick={onClick} aria-current={active ? 'page' : undefined} data-active={active ? 'true' : undefined}
      className={cn('group flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-body compact:text-control transition-colors', rowState(active), className)}>
      {iconEl ?? (Icon ? <Icon className={cn('size-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground')} /> : null)}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {children}
    </button>
  );
}

// A row of a list: title, optional second line, something at each end. `selected`: it is the one open at the side.
export function ListRow({ title, meta, leading, trailing, selected, onClick, className, ...props }) {
  const body = (
    <>
      {leading}
      <span className="min-w-0 flex-1"><span className="block truncate text-body">{title}</span>{meta ? <span className="text-muted-foreground block truncate text-xs">{meta}</span> : null}</span>
      {trailing}
    </>
  );
  const cls = cn('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors', onClick && 'cursor-pointer', rowState(selected), className);
  return onClick
    ? <button type="button" onClick={onClick} aria-selected={selected ? true : undefined} data-active={selected ? 'true' : undefined} className={cls} {...props}>{body}</button>
    : <div aria-selected={selected ? true : undefined} data-active={selected ? 'true' : undefined} className={cls} {...props}>{body}</div>;
}

// The small heading over a group of rows.
export function SectionLabel({ className, children, ...props }) {
  return <div className={cn('text-muted-foreground px-2.5 pt-3 pb-1 text-micro font-medium tracking-wide uppercase', className)} {...props}>{children}</div>;
}

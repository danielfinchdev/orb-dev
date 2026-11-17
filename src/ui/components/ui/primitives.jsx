// Small pieces every screen repeats, built once so they look and behave the same everywhere. They use the tokens of
// tokens.css only. «Selected» (aria-selected / data-active, a lasting fact) is drawn apart from «pointer over» (a
// passing hover): selected is a filled row, hover is a lighter wash.
import { Ellipsis, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';
import { Button } from './button.jsx';
import { Input, FieldError } from './basic.jsx';

export { FieldError };

// An icon-only button (.ib). `label` is the accessible name and is required; the hit area is 32 px (24 px with `small`, for
// rows), 44 px on touch.
export function IconButton({ label, children, className, variant = 'ghost', active, small = false, ...props }) {
  if (!label && import.meta.env?.DEV) console.error('IconButton needs a label (aria-label)');
  return (
    <Button type="button" size={small ? 'icon-xs' : 'icon-sm'} variant={variant} aria-label={label} data-active={active ? 'true' : undefined} aria-pressed={active === undefined ? undefined : Boolean(active)}
      className={cn('ib pointer-coarse:size-11 aria-expanded:bg-accent aria-expanded:text-foreground data-[active=true]:bg-accent data-[active=true]:text-foreground', className)} {...props}>
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
  neutral: 'bg-secondary border-border',
  info: 'bg-info/10 border-info/30',
  warning: 'bg-warning-soft border-warning/40',
  danger: 'bg-destructive/10 border-destructive/40',
  success: 'bg-success-soft border-success/40'
};
// A notice in the flow of a page (not a popup): why something waits, what to know before acting.
const NOTE_ICON = { neutral: 'text-muted-foreground', warning: 'text-warning-ink' };
export function Note({ tone = 'neutral', icon: Icon, className, children, ...props }) {
  return (
    <div role={tone === 'danger' ? 'alert' : 'note'} className={cn('flex items-start gap-2 rounded-card border px-3 py-2.5 text-caption', NOTE_TONES[tone] ?? NOTE_TONES.neutral, className)} {...props}>
      {Icon ? <Icon className={cn('mt-0.5 size-4 shrink-0', NOTE_ICON[tone])} /> : null}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

// Pick one of a few (.segm): a pill bar. options: [{ value, label, count?, testid? }]; the chosen one is `aria-selected`.
// `count` is the little number after the label (.n).
export function Segmented({ value, onChange, options, className, itemTestId, ...props }) {
  return (
    <div data-slot="segmented" className={cn('segm bg-secondary inline-flex gap-0.5 rounded-ctl p-0.5', className)} role="tablist" {...props}>
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value} data-testid={o.testid ?? itemTestId?.(o.value)} onClick={() => onChange(o.value)}
          className={cn('inline-flex h-(--ctl-sm) cursor-pointer items-center gap-1.5 rounded-[calc(var(--r-ctl)-2px)] px-2.5 text-control whitespace-nowrap transition-[color,background-color,box-shadow] duration-150 outline-none focus-visible:outline-2 focus-visible:outline-ring', value === o.value ? 'bg-card text-foreground shadow-[0_1px_2px_color-mix(in_oklab,var(--foreground)_10%,transparent)]' : 'text-muted-foreground hover:text-foreground')}>
          {o.label}{o.count != null ? <span className="n text-micro text-faint-foreground tabular-nums">{o.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

// A search field (.field) with its magnifier; the accessible name is the placeholder unless `label` says otherwise.
export function SearchInput({ value, onChange, placeholder, label, className, inputClassName, ...props }) {
  return (
    <div data-slot="search" className={cn('field bg-card text-muted-foreground border-border focus-within:border-input flex h-(--ctl) w-64 max-w-full items-center gap-2 rounded-ctl border pr-1 pl-2.5 transition-[border-color]', className)}>
      <Search className="pointer-events-none size-4 shrink-0" />
      <input className={cn('text-foreground placeholder:text-faint-foreground min-w-0 flex-1 border-0 bg-transparent text-control outline-none', inputClassName)} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label ?? placeholder} {...props} />
    </div>
  );
}

const rowState = (active) => (active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground');

// A place in a menu (the sidebar, the sections of a view: .smenu). `active`: it is the page on screen.
export function NavRow({ icon: Icon, iconEl, label, active, onClick, children, testid, className }) {
  return (
    <button type="button" data-testid={testid} onClick={onClick} aria-current={active ? 'page' : undefined} data-active={active ? 'true' : undefined}
      className={cn('group flex h-(--ctl) w-full cursor-pointer items-center gap-2.5 rounded-ctl px-2.5 text-left text-control transition-colors outline-none focus-visible:outline-2 focus-visible:outline-ring', rowState(active), className)}>
      {iconEl ?? (Icon ? <Icon className="size-4 shrink-0" /> : null)}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {children}
    </button>
  );
}

// A row of a list (.lrow): title, optional second line (.meta2), something at each end. `selected`: it is the one open at the side.
export function ListRow({ title, meta, leading, trailing, selected, onClick, className, ...props }) {
  const body = (
    <>
      {leading}
      <span className="main flex min-w-0 flex-1 flex-col gap-0.5"><b className="block truncate text-body font-medium">{title}</b>{meta ? <span className="meta2 text-muted-foreground block truncate text-caption">{meta}</span> : null}</span>
      {trailing}
    </>
  );
  const cls = cn('lrow flex w-full min-w-0 items-center gap-3 rounded-ctl px-3.5 py-3 text-left transition-colors', onClick && 'cursor-pointer outline-none focus-visible:outline-2 focus-visible:outline-ring', selected ? 'bg-accent text-foreground' : 'hover:bg-accent/60', className);
  return onClick
    ? <button type="button" onClick={onClick} aria-selected={selected ? true : undefined} data-active={selected ? 'true' : undefined} className={cls} {...props}>{body}</button>
    : <div aria-selected={selected ? true : undefined} data-active={selected ? 'true' : undefined} className={cls} {...props}>{body}</div>;
}

// The frame of a list (.lcard): rows inside it are separated by a hairline.
export function ListCard({ className, ...props }) {
  return <div data-slot="list-card" className={cn('lcard bg-card border-border rounded-card overflow-hidden border', className)} {...props} />;
}

// The small heading over a group of rows (.sec-h).
export function SectionLabel({ className, children, ...props }) {
  return <div data-slot="section-label" className={cn('sec-h text-foreground px-2.5 pt-3 pb-1 font-(family-name:--title) text-card-title font-semibold', className)} {...props}>{children}</div>;
}

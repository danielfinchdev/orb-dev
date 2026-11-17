// shadcn/ui overlays on Radix: dialog, select, tooltip, dropdown menu, switch, checkbox, tabs, collapsible.
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as SelectPrimitive from '@radix-ui/react-select';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as CollapsiblePrimitive from '@radix-ui/react-collapsible';
import { CheckIcon, ChevronDownIcon, InfoIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';

// ---- dialog
const ANIM_FADE = "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0";
const ANIM_ZOOM = `${ANIM_FADE} data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95`;
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
// The mock-up's .scrim > .dialog: a 12 px card on --background with a header (.dialog-h), a body (.dialog-b) and a footer
// (.dialog-f, the main action on the right). size="sm" is the 440 px one for confirmations. Whatever a view puts between the
// header and the footer is the body, inside the content's 18 px padding; pieces.css lets the header and footer bleed to
// the edges (a content that passes p-0, like the palette, keeps them as plain rows).
// instant: no enter or exit animation (overlay included), for surfaces opened from the keyboard such as the palette.
export function DialogContent({ className, children, showClose = true, instant = false, size, ...props }) {
  const t = useT();
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay data-slot="dialog-overlay" className={cn(!instant && ANIM_FADE, "scrim fixed inset-0 z-50 bg-black/32")} />
      <DialogPrimitive.Content data-slot="dialog-content" data-size={size} className={cn('dialog bg-background text-foreground', !instant && ANIM_ZOOM, 'fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-3 overflow-y-auto rounded-card border border-border p-[18px] duration-200', size === 'sm' ? 'sm:max-w-[440px]' : 'sm:max-w-lg', 'max-h-[90vh]', className)} {...props}>
        {children}
        {showClose ? <DialogPrimitive.Close data-slot="dialog-close" className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-ring absolute top-4 right-4 grid size-(--ctl-sm) cursor-pointer place-items-center rounded-ctl transition-colors outline-none focus-visible:outline-2"><XIcon className="size-3.5" /><span className="sr-only">{t('comp.close')}</span></DialogPrimitive.Close> : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
export function DialogHeader({ className, ...props }) { return <div data-slot="dialog-header" className={cn('dialog-h border-border flex min-h-14 flex-col justify-center gap-0.5 border-b py-2.5 pr-12 pl-[18px]', className)} {...props} />; }
export function DialogFooter({ className, ...props }) { return <div data-slot="dialog-footer" className={cn('dialog-f border-border flex flex-col-reverse gap-2 border-t px-[18px] py-3 sm:flex-row sm:justify-end', className)} {...props} />; }
export function DialogTitle({ className, ...props }) { return <DialogPrimitive.Title className={cn('font-(family-name:--title) text-title leading-tight font-semibold', className)} {...props} />; }
export function DialogDescription({ className, ...props }) { return <DialogPrimitive.Description className={cn('text-muted-foreground text-caption', className)} {...props} />; }

// ---- select
// title: what the control is for, shown as the app's bubble on hover (and as its accessible name).
// the trigger shows the chosen option itself (SelectPrimitive.Value with children). Without them, Radix copies the
// option's text into the trigger through a portal into the same <span> React also writes the placeholder in, and with the
// list kept in a detached fragment while closed, React 19 could fail with «insertBefore… is not a child of this node» when
// the screen changed (seen going from one screen to another). With children there is one writer: options may carry
// an icon (an avatar) again. o.icon: drawn before the label in the list and in the trigger.
export function Select({ value, onValueChange, options, placeholder, className, size = 'default', disabled, title, id, 'aria-describedby': describedBy, 'data-testid': testid, ...props }) {
  const chosen = options.find((o) => o.value === value) ?? null;
  const trigger = (
    <SelectPrimitive.Trigger id={id} aria-describedby={describedBy} aria-label={title} data-testid={testid} className={cn("btn pick out border-border bg-card text-foreground hover:bg-accent data-[placeholder]:text-muted-foreground flex h-(--ctl) w-fit items-center justify-between gap-1.5 rounded-ctl border px-2.5 text-control whitespace-nowrap transition-[background-color,border-color] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-45 cursor-pointer *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4", className)}>
      <SelectPrimitive.Value data-slot="select-value" placeholder={placeholder}>{chosen ? <>{chosen.icon ?? null}<span className="truncate">{chosen.label}</span></> : null}</SelectPrimitive.Value>
      <SelectPrimitive.Icon asChild><ChevronDownIcon className="text-muted-foreground size-4" /></SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
  return (
    <SelectPrimitive.Root value={value ?? undefined} onValueChange={onValueChange} disabled={disabled} {...props}>
      {title ? <BubbleTip title={title}>{trigger}</BubbleTip> : trigger}
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content data-slot="select-content" position="popper" sideOffset={4} className="pop bg-popover text-popover-foreground border-border data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 origin-(--radix-select-content-transform-origin) relative z-50 max-h-(--radix-select-content-available-height) min-w-[8rem] min-w-(--radix-select-trigger-width) overflow-x-hidden overflow-y-auto rounded-card border text-control shadow-(--shadow)">
          <SelectPrimitive.Viewport className="p-1">
            {options.map((o) => (
              <SelectPrimitive.Item key={o.value} value={o.value} disabled={o.disabled} className="it focus:bg-accent focus:text-foreground flex w-full cursor-pointer items-center gap-2 rounded-ctl px-2 py-1.5 text-control outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-45 [&_svg:not([class*='size-'])]:size-4">
                {o.icon ?? null}<SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                <span className="chk text-primary-text ml-auto flex size-4 items-center justify-center"><SelectPrimitive.ItemIndicator><CheckIcon className="size-4" /></SelectPrimitive.ItemIndicator></span>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

// ---- tooltip
// the one tooltip of the whole app, a small speech bubble (app.css: .orb-tip, styled per visual theme): a short bold
// title and, at most, a line or two of muted text, with a little tail towards the control. No icons inside. Shown on hover
// and on keyboard focus; the control keeps its own accessible name (aria-label).
// offset: how far from the control (more when a button sits right next to it, so the bubble never covers it).
// off: kept closed (its control has a list of its own open, like the bell's).
// the bubble stays inside the window (collisionPadding) and its tail never sits on a rounded corner (TAIL_PAD,
// the largest --tip-radius of the themes): a bubble pushed against the window's edge hides its tail instead of looking cut.
export const TAIL_PAD = 20;
// Radix opens a tooltip on any focus; a focus that is not :focus-visible (given back by code after a pointer choice) is
// stopped here (preventDefault skips Radix's own handler).
const keyboardFocusOnly = (e) => { try { if (!e.currentTarget.matches(':focus-visible')) e.preventDefault(); } catch { /* old engine: as before */ } };
// «Título · texto» (the mock-up's title="…") is a bold title with its text under it.
export function splitTip(title, text) {
  if (text || typeof title !== 'string') return { title, text };
  const i = title.indexOf(' · ');
  return i > 0 ? { title: title.slice(0, i), text: title.slice(i + 3) } : { title, text };
}
export function BubbleTip({ title: rawTitle, text: rawText, children, side = 'bottom', align = 'center', wide = false, offset = 8, off = false }) {
  const { title, text } = splitTip(rawTitle, rawText);
  if (!title && !text) return children;
  return (
    <TooltipPrimitive.Root delayDuration={300} open={off ? false : undefined}>
      {/* Keyboard focus only: a menu chosen with the mouse hands the focus back to its button (⋯), and its bubble popped
          up over the chat after every choice. */}
      <TooltipPrimitive.Trigger asChild onFocus={keyboardFocusOnly}>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        {/* a bubble only informs: clicks go through it to whatever it covers (it hid the project picker). */}
        <TooltipPrimitive.Content side={side} align={align} sideOffset={offset} collisionPadding={12} arrowPadding={TAIL_PAD} data-slot="tip" className={cn('orb-tip pointer-events-none z-50', wide ? 'max-w-80' : 'max-w-[17rem]')} data-testid="bubble-tip">
          {title ? <div className="orb-tip-title text-control leading-snug font-semibold">{title}</div> : null}
          {text ? <p className={cn('orb-tip-text text-caption leading-snug', title && 'mt-0.5', wide && 'break-all')}>{text}</p> : null}
          <TooltipPrimitive.Arrow asChild width={16} height={8}><span className="orb-tip-tail" aria-hidden="true" /></TooltipPrimitive.Arrow>
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
// an «ⓘ» next to a setting's name: the details that do not fit in its one-line description. A real button, so
// it is reached with the keyboard and its text is read by screen readers (the bubble also opens on focus).
export function InfoTip({ text, className }) {
  if (!text) return null;
  return (
    <BubbleTip text={text} wide={false}>
      <button type="button" aria-label={text} onClick={(e) => e.preventDefault()} className={cn('text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 inline-grid size-4 shrink-0 cursor-help place-items-center rounded-full align-[-2px] outline-none focus-visible:ring-2', className)} data-testid="info-tip"><InfoIcon className="size-3.5" /></button>
    </BubbleTip>
  );
}
// a bubble with richer content (the card of a conversation in the sidebar): the same look, any content inside.
// onOpen: called when it shows (to fetch what it needs then, not before).
export function RichTip({ content, children, side = 'right', align = 'start', offset = 12, onOpen }) {
  return (
    <TooltipPrimitive.Root delayDuration={450} onOpenChange={(open) => { if (open) onOpen?.(); }}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content side={side} align={align} sideOffset={offset} collisionPadding={12} arrowPadding={TAIL_PAD} className="orb-tip orb-card z-50 w-72" data-slot="tip" data-testid="rich-tip">
          {content}
          <TooltipPrimitive.Arrow asChild width={16} height={8}><span className="orb-tip-tail" aria-hidden="true" /></TooltipPrimitive.Arrow>
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
// A one-line bubble (the label is its title).
export function Tip({ label, children, side = 'top', align }) { return <BubbleTip title={label} side={side} align={align}>{children}</BubbleTip>; }
export const TooltipProvider = TooltipPrimitive.Provider;

// ---- popover: a bubble that opens with a click and holds controls (the chat's calendar), dressed as the help bubbles.
export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export function PopoverContent({ className, children, side = 'bottom', align = 'center', offset = 8, ...props }) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content side={side} align={align} sideOffset={offset} collisionPadding={12} data-slot="popover" className={cn('orb-tip orb-pop z-50 outline-none', className)} {...props}>
        {children}
        <PopoverPrimitive.Arrow asChild width={16} height={8}><span className="orb-tip-tail" aria-hidden="true" /></PopoverPrimitive.Arrow>
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}

// ---- dropdown menu
export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownMenuTrigger = DropdownPrimitive.Trigger;
// an item that opens a dialog (Renombrar, Posponer…): the focus stays in the dialog's field. The closing menu does
// not take it back (the dialog slides under the pointer and Radix's «pointer left the item» focused the menu), nor hand it
// to its button once closed (typing went nowhere). A menu inside a dialog still gives the focus back to its button.
const inDialog = () => Boolean(document.activeElement?.closest?.('[role=dialog], [role=alertdialog]'));
const closing = (el) => el?.closest?.('[data-slot=menu-content]')?.getAttribute('data-state') === 'closed';
export function DropdownMenuContent({ className, align = 'end', onCloseAutoFocus, ...props }) {
  const closeFocus = (e) => { onCloseAutoFocus?.(e); if (!e.defaultPrevented && inDialog()) e.preventDefault(); };
  return <DropdownPrimitive.Portal><DropdownPrimitive.Content data-slot="menu-content" align={align} sideOffset={4} onCloseAutoFocus={closeFocus} className={cn('pop bg-popover text-popover-foreground border-border data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 origin-(--radix-dropdown-menu-content-transform-origin) z-50 min-w-[11rem] overflow-hidden rounded-card border p-1 text-control shadow-(--shadow)', className)} {...props} /></DropdownPrimitive.Portal>;
}
export function DropdownMenuItem({ className, variant, onPointerLeave, ...props }) {
  const leave = (e) => { onPointerLeave?.(e); if (!e.defaultPrevented && closing(e.currentTarget)) e.preventDefault(); };
  return <DropdownPrimitive.Item onPointerLeave={leave} className={cn("it focus:bg-accent focus:text-foreground relative flex cursor-pointer items-center gap-2 rounded-ctl px-2 py-1.5 text-control outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-45 [&_svg:not([class*='size-'])]:size-4 [&_svg]:text-muted-foreground", variant === 'destructive' && 'danger text-destructive focus:text-destructive [&_svg]:text-destructive', className)} {...props} />;
}
// an item that is ticked or not (lists where several can be chosen); the menu stays open while ticking.
export function DropdownMenuCheckboxItem({ className, children, checked, onCheckedChange, ...props }) {
  return (
    <DropdownPrimitive.CheckboxItem checked={checked} onCheckedChange={onCheckedChange} onSelect={(e) => e.preventDefault()} className={cn('it focus:bg-accent focus:text-foreground relative flex cursor-pointer items-center gap-2 rounded-ctl py-1.5 pr-2 pl-8 text-control outline-hidden select-none', className)} {...props}>
      <span className={cn('absolute left-2 grid size-4 place-items-center rounded-[calc(var(--r-ctl)-3px)] border', checked ? 'bg-primary-text border-primary-text text-primary-foreground' : 'border-input')}>
        <DropdownPrimitive.ItemIndicator><CheckIcon className="size-3" /></DropdownPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownPrimitive.CheckboxItem>
  );
}
// one choice among several (a sort order, a mode): the group keeps one value, the chosen item shows a dot.
export const DropdownMenuRadioGroup = DropdownPrimitive.RadioGroup;
export function DropdownMenuRadioItem({ className, children, ...props }) {
  return (
    <DropdownPrimitive.RadioItem className={cn('it focus:bg-accent focus:text-foreground relative flex cursor-pointer items-center gap-2 rounded-ctl py-1.5 pr-2 pl-8 text-control outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-45', className)} {...props}>
      <span className="absolute left-2 grid size-4 place-items-center"><DropdownPrimitive.ItemIndicator><span className="bg-primary-text block size-2 rounded-full" /></DropdownPrimitive.ItemIndicator></span>
      {children}
    </DropdownPrimitive.RadioItem>
  );
}
export function DropdownMenuSeparator() { return <DropdownPrimitive.Separator className="bg-border my-1 h-px" />; }
export function DropdownMenuLabel({ className, ...props }) { return <DropdownPrimitive.Label className={cn('lab text-faint-foreground px-2 pt-1.5 pb-0.5 text-micro', className)} {...props} />; }

// ---- switch and checkbox
// The mock-up's .sw: a 32×18 track (soft when off, --primary-text when on) and a 14 px thumb that slides with a transform.
// size="sm" (28×16, thumb 12): for inline toolbars such as the composer (DESIGN-SYSTEM §4); the regular one elsewhere.
export function Switch({ className, size = 'default', ...props }) {
  const sm = size === 'sm';
  return (
    <SwitchPrimitive.Root data-slot="switch" data-size={size} className={cn('sw peer data-[state=checked]:bg-primary-text data-[state=unchecked]:bg-[color-mix(in_oklch,var(--foreground)_15%,transparent)] focus-visible:outline-ring relative inline-flex shrink-0 cursor-pointer items-center rounded-full transition-[background-color] duration-200 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-45', sm ? 'h-4 w-7' : 'h-[18px] w-8', className)} {...props}>
      <SwitchPrimitive.Thumb className={cn('bg-background dark:data-[state=unchecked]:bg-foreground pointer-events-none absolute top-0.5 left-0.5 block rounded-full shadow-[0_1px_2px_color-mix(in_oklch,var(--foreground)_30%,transparent)] transition-transform duration-[220ms] ease-out data-[state=unchecked]:translate-x-0', sm ? 'size-3 data-[state=checked]:translate-x-3' : 'size-3.5 data-[state=checked]:translate-x-3.5')} />
    </SwitchPrimitive.Root>
  );
}
export function Checkbox({ className, ...props }) {
  return (
    <CheckboxPrimitive.Root data-slot="checkbox" className={cn('peer border-input bg-card data-[state=checked]:bg-primary-text data-[state=checked]:text-primary-foreground data-[state=checked]:border-primary-text focus-visible:outline-ring size-[18px] shrink-0 cursor-pointer rounded-[calc(var(--r-ctl)-3px)] disabled:cursor-not-allowed disabled:opacity-45 border transition-[background-color,border-color] outline-none focus-visible:outline-2 focus-visible:outline-offset-2', className)} {...props}>
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current"><CheckIcon className="size-3.5" /></CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

// ---- range (.range): a slider whose filled track is --primary-text. Same props as <input type="range">; the fill
// follows `value` (or the live value when uncontrolled).
export function Range({ className, style, value, defaultValue, min = 0, max = 100, onChange, ...props }) {
  const [own, setOwn] = useState(defaultValue ?? min);
  const current = Number(value ?? own);
  const span = Number(max) - Number(min);
  const pct = span > 0 ? Math.min(100, Math.max(0, ((current - Number(min)) / span) * 100)) : 0;
  return (
    <input type="range" data-slot="range" className={cn('range', className)} min={min} max={max} {...(value !== undefined ? { value } : { defaultValue })}
      style={{ '--v': `${pct}%`, ...style }} onChange={(e) => { setOwn(e.target.value); onChange?.(e); }} {...props} />
  );
}

// ---- tabs (.segm pill by default; variant="line" is the mock-up's .vtabs with .ptab triggers)
export const Tabs = TabsPrimitive.Root;
export function TabsList({ className, variant = 'segm', ...props }) {
  return <TabsPrimitive.List data-slot="tabs-list" data-variant={variant} className={cn('segm text-muted-foreground inline-flex max-w-full items-center justify-start overflow-x-auto [scrollbar-width:none]', variant === 'line' ? 'vtabs border-border w-full gap-0.5 border-b pb-2' : 'bg-secondary h-(--ctl) w-fit gap-0.5 rounded-ctl p-0.5', className)} {...props} />;
}
export function TabsTrigger({ className, ...props }) {
  return <TabsPrimitive.Trigger data-slot="tabs-trigger" className={cn("ptab data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-[0_1px_2px_color-mix(in_oklab,var(--foreground)_10%,transparent)] focus-visible:outline-ring inline-flex h-(--ctl-sm) shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-[calc(var(--r-ctl)-2px)] px-2.5 text-control whitespace-nowrap transition-[color,background-color,box-shadow] duration-150 outline-none focus-visible:outline-2 disabled:opacity-45 [&_svg:not([class*='size-'])]:size-4", className)} {...props} />;
}

// ---- collapsible
export const Collapsible = CollapsiblePrimitive.Root;
export const CollapsibleTrigger = CollapsiblePrimitive.Trigger;
export const CollapsibleContent = CollapsiblePrimitive.Content;

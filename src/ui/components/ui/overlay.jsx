// shadcn/ui overlays on Radix: dialog, select, tooltip, dropdown menu, switch, checkbox, tabs, collapsible.
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as SelectPrimitive from '@radix-ui/react-select';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as CollapsiblePrimitive from '@radix-ui/react-collapsible';
import { CheckIcon, ChevronDownIcon, XIcon } from 'lucide-react';
import { cn } from '@/lib/utils.js';

// ---- dialog
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export function DialogContent({ className, children, showClose = true, ...props }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]" />
      <DialogPrimitive.Content className={cn('bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-2xl border p-6 shadow-xl duration-200 sm:max-w-lg max-h-[90vh] overflow-y-auto', className)} {...props}>
        {children}
        {showClose ? <DialogPrimitive.Close className="ring-offset-background focus:ring-ring absolute top-4 right-4 rounded-md p-1 opacity-60 transition-opacity hover:opacity-100 focus:ring-2 focus:outline-hidden cursor-pointer"><XIcon className="size-4" /><span className="sr-only">Cerrar</span></DialogPrimitive.Close> : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
export function DialogHeader({ className, ...props }) { return <div className={cn('flex flex-col gap-1.5 pr-6', className)} {...props} />; }
export function DialogFooter({ className, ...props }) { return <div className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end pt-1', className)} {...props} />; }
export function DialogTitle({ className, ...props }) { return <DialogPrimitive.Title className={cn('text-lg leading-none font-medium', className)} {...props} />; }
export function DialogDescription({ className, ...props }) { return <DialogPrimitive.Description className={cn('text-muted-foreground text-sm', className)} {...props} />; }

// ---- select
export function Select({ value, onValueChange, options, placeholder, className, size = 'default', disabled, title, ...props }) {
  return (
    <SelectPrimitive.Root value={value ?? undefined} onValueChange={onValueChange} disabled={disabled} {...props}>
      <SelectPrimitive.Trigger title={title} className={cn("border-input data-[placeholder]:text-muted-foreground dark:bg-input/30 dark:hover:bg-input/50 flex w-fit items-center justify-between gap-2 rounded-lg border bg-transparent px-3 text-sm whitespace-nowrap shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/40 focus-visible:ring-[3px] disabled:opacity-50 cursor-pointer *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4", size === 'sm' ? 'h-8 text-[13px]' : 'h-9', className)}>
        <SelectPrimitive.Value data-slot="select-value" placeholder={placeholder} />
        <SelectPrimitive.Icon asChild><ChevronDownIcon className="size-4 opacity-50" /></SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content position="popper" sideOffset={4} className="bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 relative z-50 max-h-(--radix-select-content-available-height) min-w-[8rem] min-w-(--radix-select-trigger-width) overflow-x-hidden overflow-y-auto rounded-lg border shadow-md">
          <SelectPrimitive.Viewport className="p-1">
            {options.map((o) => (
              <SelectPrimitive.Item key={o.value} value={o.value} disabled={o.disabled} className="focus:bg-accent focus:text-accent-foreground relative flex w-full cursor-pointer items-center gap-2 rounded-md py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg:not([class*='size-'])]:size-4">
                <span className="absolute right-2 flex size-3.5 items-center justify-center"><SelectPrimitive.ItemIndicator><CheckIcon className="size-4" /></SelectPrimitive.ItemIndicator></span>
                <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

// ---- tooltip
export function Tip({ label, children, side = 'top' }) {
  if (!label) return children;
  return (
    <TooltipPrimitive.Root delayDuration={350}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content side={side} sideOffset={6} className="bg-foreground text-background animate-in fade-in-0 zoom-in-95 z-50 max-w-xs rounded-md px-2.5 py-1.5 text-xs">{label}</TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
export const TooltipProvider = TooltipPrimitive.Provider;

// ---- dropdown menu
export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownMenuTrigger = DropdownPrimitive.Trigger;
export function DropdownMenuContent({ className, align = 'end', ...props }) {
  return <DropdownPrimitive.Portal><DropdownPrimitive.Content align={align} sideOffset={4} className={cn('bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 z-50 min-w-[11rem] overflow-hidden rounded-lg border p-1 shadow-md', className)} {...props} /></DropdownPrimitive.Portal>;
}
export function DropdownMenuItem({ className, variant, ...props }) {
  return <DropdownPrimitive.Item className={cn("focus:bg-accent focus:text-accent-foreground relative flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg:not([class*='size-'])]:size-4 [&_svg]:text-muted-foreground", variant === 'destructive' && 'text-destructive focus:text-destructive [&_svg]:text-destructive', className)} {...props} />;
}
export function DropdownMenuSeparator() { return <DropdownPrimitive.Separator className="bg-border -mx-1 my-1 h-px" />; }
export function DropdownMenuLabel({ className, ...props }) { return <DropdownPrimitive.Label className={cn('text-muted-foreground px-2 py-1.5 text-xs', className)} {...props} />; }

// ---- switch and checkbox
export function Switch({ className, ...props }) {
  return (
    <SwitchPrimitive.Root className={cn('peer data-[state=checked]:bg-primary data-[state=unchecked]:bg-input focus-visible:ring-ring/50 dark:data-[state=unchecked]:bg-input/80 inline-flex h-[1.15rem] w-8 shrink-0 cursor-pointer items-center rounded-full border border-transparent shadow-xs transition-all outline-none focus-visible:ring-[3px] disabled:opacity-50', className)} {...props}>
      <SwitchPrimitive.Thumb className="bg-background dark:data-[state=unchecked]:bg-foreground dark:data-[state=checked]:bg-primary-foreground pointer-events-none block size-4 rounded-full ring-0 transition-transform data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0" />
    </SwitchPrimitive.Root>
  );
}
export function Checkbox({ className, ...props }) {
  return (
    <CheckboxPrimitive.Root className={cn('peer border-input dark:bg-input/30 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=checked]:border-primary focus-visible:ring-ring/50 size-4 shrink-0 cursor-pointer rounded-[5px] border shadow-xs transition-shadow outline-none focus-visible:ring-[3px]', className)} {...props}>
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current"><CheckIcon className="size-3.5" /></CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

// ---- tabs (pill style)
export const Tabs = TabsPrimitive.Root;
export function TabsList({ className, ...props }) { return <TabsPrimitive.List className={cn('bg-muted text-muted-foreground inline-flex h-9 w-fit max-w-full items-center justify-start overflow-x-auto rounded-lg p-[3px] [scrollbar-width:none]', className)} {...props} />; }
export function TabsTrigger({ className, ...props }) {
  return <TabsPrimitive.Trigger className={cn("data-[state=active]:bg-background dark:data-[state=active]:bg-input/40 data-[state=active]:text-foreground data-[state=active]:shadow-sm inline-flex h-full flex-1 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 text-[13px] font-medium whitespace-nowrap transition-all disabled:opacity-50 [&_svg:not([class*='size-'])]:size-4", className)} {...props} />;
}

// ---- collapsible
export const Collapsible = CollapsiblePrimitive.Root;
export const CollapsibleTrigger = CollapsiblePrimitive.Trigger;
export const CollapsibleContent = CollapsiblePrimitive.Content;

import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils.js';

// The mock-up's .btn: one control height (--ctl), 13 px text, 16 px icons (14 px in the 24 px size). The variants only
// change colour, so a row of mixed buttons keeps one baseline.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-ctl text-control font-normal transition-[color,background-color,border-color,box-shadow,opacity,transform] duration-150 ease-(--ease-out) cursor-pointer disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
  {
    variants: {
      variant: {
        default: 'bg-primary-text text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-destructive text-primary-foreground hover:bg-destructive/90',
        outline: 'border border-border bg-card text-foreground hover:bg-accent',
        secondary: 'bg-secondary text-foreground hover:bg-accent',
        ghost: 'text-muted-foreground hover:bg-accent hover:text-foreground',
        link: 'text-primary-text underline-offset-4 hover:underline',
        soft: 'bg-secondary text-foreground hover:bg-accent',
        danger: 'border border-[color-mix(in_oklab,var(--destructive)_40%,var(--border))] text-destructive hover:bg-destructive/10',
        warn: 'bg-warning text-warning-foreground hover:bg-warning/90'
      },
      size: {
        default: 'h-(--ctl) px-3',
        sm: 'h-(--ctl) px-3',
        xs: 'h-(--ctl-sm) gap-1 px-2.5 text-caption [&_svg:not([class*=size-])]:size-3.5',
        lg: 'h-(--ctl) px-4',
        icon: 'size-(--ctl)',
        'icon-sm': 'size-(--ctl)',
        'icon-xs': 'size-(--ctl-sm) [&_svg:not([class*=size-])]:size-3.5'
      }
    },
    defaultVariants: { variant: 'default', size: 'default' }
  }
);

export function Button({ className, variant, size, asChild = false, ...props }) {
  const Comp = asChild ? Slot : 'button';
  return <Comp data-slot="button" data-variant={variant ?? 'default'} className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

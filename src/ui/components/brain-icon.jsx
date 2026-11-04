// 3.6: the reasoning button's brain, drawn for Orb in the stroke style of the icon set (lucide: 24 grid, stroke 2,
// round caps): two lobes either side of the midline, two folds each, legible at 16 px.
import { cn } from '@/lib/utils.js';

export function BrainIcon({ className, ...props }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cn('lucide', className)} aria-hidden="true" {...props}>
      <path d="M12 5.2C11 3.6 8.2 3.5 7.4 5.4 5.5 5.5 4.3 7.2 4.9 9 3.5 9.9 3.3 12 4.5 13.1 3.7 14.8 4.6 16.8 6.5 17.1 6.9 19.1 9.3 20.3 11 19.3 11.4 19.6 11.7 19.7 12 19.6Z" />
      <path d="M12 5.2c1-1.6 3.8-1.7 4.6.2 1.9.1 3.1 1.8 2.5 3.6 1.4.9 1.6 3 .4 4.1.8 1.7-.1 3.7-2 4-.4 2-2.8 3.2-4.5 2.2-.4.3-.7.4-1 .3Z" />
      <path d="M4.9 9c.9.6 2.2.7 3.1.1" />
      <path d="M19.1 9c-.9.6-2.2.7-3.1.1" />
      <path d="M4.5 13.1c1.1-.6 2.5-.4 3.3.6" />
      <path d="M19.5 13.1c-1.1-.6-2.5-.4-3.3.6" />
    </svg>
  );
}

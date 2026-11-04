// 3.6 (DESIGN-SYSTEM §2.2): the composer's contextual action slot, right of the project picker. It shows at most one
// suggestion, the first of `items` that is not null (the caller lists them by priority: «Compactar» before «Iniciar
// test»…). Future suggestions plug in here with their own place in the list; never two at once. The suggestion appears
// with a short fade and rise and leaves with a fade (app.css .context-slot); the text field never moves.
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils.js';

const LEAVE_MS = 120;

// items: [{ key, node } | null | false]
export function ContextSlot({ items, className }) {
  const next = items.find(Boolean) ?? null;
  const [key, setKey] = useState(next?.key ?? null);
  const last = useRef(next); // what is on screen while it fades out
  if (next && next.key === key) last.current = next;
  useEffect(() => {
    if ((next?.key ?? null) === key) return undefined;
    if (key == null) { setKey(next.key); return undefined; }
    // Another suggestion (or none): the one on screen fades out first.
    const timer = setTimeout(() => setKey(next?.key ?? null), LEAVE_MS);
    return () => clearTimeout(timer);
  }, [next?.key, key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (key == null || !last.current) return null;
  const leaving = (next?.key ?? null) !== key;
  return (
    <div className={cn('context-slot', leaving && 'is-leaving', className)} data-testid="context-slot" data-action={key}>
      <div key={key} className="context-slot-item">{last.current.node}</div>
    </div>
  );
}

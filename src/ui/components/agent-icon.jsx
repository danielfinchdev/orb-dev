// A small, recognisable mark per agent (simple shapes, not the vendors' logos).
import { cn } from '@/lib/utils.js';

const COLORS = { claude: 'text-[#d97757]', codex: 'text-[#10a37f]', cursor: 'text-foreground', any: 'text-primary', orb: 'text-primary' };

export function AgentIcon({ agent, className }) {
  const cls = cn('size-4 shrink-0', COLORS[agent] ?? 'text-muted-foreground', className);
  if (agent === 'claude') return <svg viewBox="0 0 24 24" className={cls} fill="currentColor" aria-hidden="true"><path d="M12 2.5l1.6 6.2 5.6-3.3-3.3 5.6 6.2 1.6-6.2 1.6 3.3 5.6-5.6-3.3L12 21.5l-1.6-6.2-5.6 3.3 3.3-5.6L2.5 12l6.2-1.6-3.3-5.6 5.6 3.3z" /></svg>;
  if (agent === 'codex') return <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M8.5 10l2.5 2-2.5 2M13 14.5h3" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (agent === 'cursor') return <svg viewBox="0 0 24 24" className={cls} fill="currentColor" aria-hidden="true"><path d="M12 2l9 5v10l-9 5-9-5V7z" opacity=".18" /><path d="M12 2l9 5-9 5-9-5z" opacity=".55" /><path d="M12 12l9-5v10l-9 5z" /></svg>;
  return <svg viewBox="0 0 24 24" className={cls} fill="currentColor" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></svg>;
}

// GitHub's mark (lucide no longer ships brand icons).
export function GithubIcon({ className }) {
  return <svg viewBox="0 0 24 24" className={cn('size-4 shrink-0', className)} fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.08.63-1.33-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.56 9.56 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2z" /></svg>;
}

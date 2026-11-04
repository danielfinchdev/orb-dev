// 3.6: the orchestrator's glyph, on its own so its design can change here without touching the composer. The owner's
// choice from the design sheet (docs/diseno/maquetas/orquestador.html, option 4 «Ramas desde un punto»): one point
// branching into three arrows, Orbe handing the work out to several agents. Lucide stroke style (24 grid, 2 px, round).
import { cn } from '@/lib/utils.js';

export function OrchestratorIcon({ className, ...props }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cn('lucide', className)} aria-hidden="true" data-icon="orchestrator" {...props}>
      <circle cx="4.5" cy="12" r="2" />
      <path d="M6.5 12h4" />
      <path d="M10.5 12c3 0 3-6 6.5-6H20M10.5 12H20M10.5 12c3 0 3 6 6.5 6H20" />
      <path d="m18 4 2 2-2 2M18 10l2 2-2 2M18 16l2 2-2 2" />
    </svg>
  );
}

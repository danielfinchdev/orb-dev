// 3.2: a project's icon: its own (its favicon or app icon, or one chosen in Orb; engine/project-icons.mjs) or, without
// one, a badge with its initials in a colour that is always the same for that name.
import { useStore } from '@/lib/store.js';
import { cn } from '@/lib/utils.js';

const HUES = [255, 200, 160, 135, 95, 45, 20, 340, 300, 280];
const hash = (s) => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.codePointAt(0)) >>> 0; return h; };
// «hello-world-destruccion» → HW, «erp-polo-group» → EP, «kill» → KI.
export function initials(name) {
  const parts = String(name ?? '').split(/[-_\s.]+/).filter(Boolean);
  const text = parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] ?? '?').slice(0, 2);
  return text.toUpperCase();
}

// 3.6 (M3): size: in px, for the bigger ones (the chat list, a project's info); the .project-icon rule is not a utility,
// so a size class would not win over it.
export function ProjectIcon({ name, className, size }) {
  const icon = useStore((s) => s.projectIcons?.[name] ?? null);
  if (!name) return null;
  const dims = size ? { width: size, height: size, fontSize: Math.max(7, Math.round(size * 0.38)), borderRadius: Math.round(size * 0.3) } : null;
  if (icon) return <img src={icon} alt="" aria-hidden="true" draggable={false} className={cn('project-icon is-image', className)} style={dims ?? undefined} />;
  return (
    <span className={cn('project-icon', className)} style={{ '--pi-hue': HUES[hash(name) % HUES.length], ...dims }} aria-hidden="true">{initials(name)}</span>
  );
}

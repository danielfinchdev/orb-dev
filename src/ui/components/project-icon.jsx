// a project's icon: its own (its favicon or app icon, or one chosen in Orb; engine/project-icons.mjs) or, without
// one, the mock-up's .pj: a small dot filled with a flat two-colour gradient that is always the same for that name.
import { useStore } from '@/lib/store.js';
import { cn } from '@/lib/utils.js';

// «hello-world-destruccion» → HW, «erp-polo-group» → EP, «kill» → KI.
export function initials(name) {
  const parts = String(name ?? '').split(/[-_\s.]+/).filter(Boolean);
  const text = parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] ?? '?').slice(0, 2);
  return text.toUpperCase();
}

// The same hash and colours as the mock-up's shell, so a project looks the same in the design and in the app. Pure on
// purpose: the tests evaluate it on its own.
export function projectGradient(name) {
  let h = 2166136261;
  for (const c of String(name)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); }
  h >>>= 0;
  const a = h % 360;
  const b = (a + 40 + ((h >>> 9) % 80)) % 360;
  const ang = (h >>> 17) % 360;
  return `linear-gradient(${ang}deg,hsl(${a} 95% 58%),hsl(${b} 90% 52%))`;
}

// A project without a picture is always a small dot (10 px; 8 px with `small` or a `size` of 14 or less, as in headers),
// never a big ball. A bigger `size` only reserves that much room around the dot, so the layout of the caller holds.
// With a picture, `size` is the picture's size (the .project-icon rule of app.css is not a utility, so a size class
// would not win over it).
export function ProjectIcon({ name, className, size, small = false }) {
  const icon = useStore((s) => s.projectIcons?.[name] ?? null);
  if (!name) return null;
  if (icon) {
    const dims = size ? { width: size, height: size, borderRadius: Math.round(size * 0.3) } : undefined;
    return <img src={icon} alt="" aria-hidden="true" draggable={false} className={cn('project-icon is-image', className)} style={dims} />;
  }
  const px = small || (size && size <= 14) ? 8 : 10;
  const dot = <span className={cn('pj', !(size > 16) && className)} data-project={name} aria-hidden="true" style={{ width: px, height: px, background: projectGradient(name) }} />;
  return size > 16 ? <span className={cn('inline-grid shrink-0 place-items-center', className)} style={{ width: size, height: size }} aria-hidden="true">{dot}</span> : dot;
}

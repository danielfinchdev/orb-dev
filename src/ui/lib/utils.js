import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...inputs) => twMerge(clsx(inputs));

// Error text from the bridge without Electron's "Error invoking remote method…" prefix.
export const errorText = (error) => String(error?.message ?? error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

export const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
export function ago(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'ahora';
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return fmtTime(iso);
}
export const baseName = (p) => String(p ?? '').split(/[\\/]/).filter(Boolean).pop() ?? '';

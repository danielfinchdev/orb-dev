import { clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';
import { t, currentLocale } from './i18n.js';
import { redact } from './redact.js';
import { shortPath } from '../../shared/text.mjs';
export { shortPath };

// The eight type roles of tokens.css are font sizes: without telling tailwind-merge, «text-control» would be taken for
// a colour and drop (or be dropped by) «text-muted-foreground».
const twMerge = extendTailwindMerge({ extend: { classGroups: { 'font-size': [{ text: ['micro', 'caption', 'control', 'body', 'card-title', 'title', 'dialog', 'display'] }] } } });
export const cn = (...inputs) => twMerge(clsx(inputs));

// Error text from the bridge without Electron's "Error invoking remote method…" prefix. Starting with a capital
// letter (the engine's messages start in lower case so they can also go inside a sentence).
const capital = (s) => s.replace(/^(\P{L}*)(\p{Ll})/u, (m, lead, ch) => lead + ch.toLocaleUpperCase());
export const errorText = (error) => redact(capital(String(error?.message ?? error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')));

export const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString(currentLocale(), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
export function ago(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return t('time.now');
  if (s < 3600) return t('time.minAgo', { n: Math.floor(s / 60) });
  if (s < 86400) return t('time.hAgo', { n: Math.floor(s / 3600) });
  return fmtTime(iso);
}
export const baseName = (p) => String(p ?? '').split(/[\\/]/).filter(Boolean).pop() ?? '';

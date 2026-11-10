// Ajustes: what every section uses (saving a setting, a labelled row, keys in a hint, sizes, previews).
import { Kbd } from '@/components/ui/basic.jsx';
import { InfoTip } from '@/components/ui/overlay.jsx';
import { call, act, setState, getState, applyTheme, applyAppearance } from '@/lib/store.js';
import { t } from '@/lib/i18n.js';

// unlock: the master password's token, for a change that needs it (src/domain/security/permissions.mjs › needsUnlock).
export async function save(patch, ok = t('settings.saved'), unlock = null) {
  const config = await act(call('config.save', { patch, ...(unlock ? { unlock } : {}) }), ok);
  if (config) { setState({ app: { ...getState().app, config } }); applyTheme(config.ui?.theme); applyAppearance(config.ui); }
  return config;
}
export const num = (v) => Number(v) || 0;
// The whole row is the switch's label: clicking its text toggles it too (the switch alone is a small target).
// info: the details that do not fit in the hint, behind an «ⓘ» next to the label (3.8.2).
export function Row({ label, hint, info, children }) {
  return <label className="-mx-2 flex cursor-pointer items-center justify-between gap-4 rounded-lg px-2 py-1.5 hover:bg-accent/40"><div><div className="flex items-center gap-1.5 text-sm">{label}{info ? <InfoTip text={info} /> : null}</div>{hint ? <div className="text-muted-foreground text-xs">{hint}</div> : null}</div>{children}</label>;
}
// A text with keyboard shortcuts in it: each {name} of the text becomes its keys (3.8.2: one key per sentence, so it
// translates whole, instead of a sentence cut in five).
export function WithKeys({ text, keys }) {
  return text.split(/(\{\w+\})/).map((part, i) => {
    const combo = /^\{(\w+)\}$/.test(part) ? keys[part.slice(1, -1)] : null;
    return combo ? <span key={i} className="whitespace-nowrap">{combo.map((k, j) => <Kbd key={j} className={j ? 'ml-0.5' : undefined}>{k}</Kbd>)}</span> : part;
  });
}

// Interface: its size on this PC (also Ctrl + / Ctrl - / Ctrl 0) and the terminal that Ctrl+J opens.
export const sizes = () => [{ value: '0.87', label: t('settings.size.small') }, { value: '1', label: t('settings.size.normal') }, { value: '1.15', label: t('settings.size.large') }];
// What a notification shows on a locked phone. 3.8: «all» (before, the bots' messages too) shows the same as «chat»:
// it is offered no more and reads as «chat».
export const PREVIEWS = ['chat', 'none'];
export const previewOf = (v) => (v === 'none' ? 'none' : 'chat');

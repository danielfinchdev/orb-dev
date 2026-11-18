// Ajustes: what every section uses (saving a setting, a labelled row, keys in a hint, sizes, previews).
import { Kbd, Field } from '@/components/ui/basic.jsx';
import { ListCard } from '@/components/ui/primitives.jsx';
import { cn } from '@/lib/utils.js';
import { InfoTip } from '@/components/ui/overlay.jsx';
import { call, act, setState, getState, applyTheme, applyAppearance } from '@/lib/store.js';
import { t } from '@/lib/i18n.js';
import { unlockCore } from '@/lib/core-access.js';
import { railValuesChange } from '../../../shared/rails-registry.mjs';

// unlock: the master password's token, for a change that needs it (src/domain/security/permissions.mjs › needsUnlock).
// A patch that changes a rail's value asks the password every time ('rails'); cancelling saves nothing and returns undefined,
// so a caller that already moved its control can put it back.
export async function save(patch, ok = t('settings.saved'), unlock = null) {
  if (!unlock) if (patch?.rails !== undefined || railValuesChange(patch, getState().app?.config)) { unlock = await unlockCore('rails'); if (!unlock) return undefined; }
  const config = await act(call('config.save', { patch, ...(unlock ? { unlock } : {}) }), ok);
  if (config) { setState({ app: { ...getState().app, config } }); applyTheme(config.ui?.theme); applyAppearance(config.ui); }
  return config;
}
export const num = (v) => Number(v) || 0;
// The whole row is the switch's label: clicking its text toggles it too (the switch alone is a small target).
// info: the details that do not fit in the hint, behind an «ⓘ» next to the label.
export function Row({ label, hint, info, children, className }) {
  return <label className={cn('hover:bg-accent/40 border-border flex cursor-pointer items-center justify-between gap-4 px-3.5 py-3 not-first:border-t', className)}><div className="flex min-w-0 flex-col gap-0.5"><div className="flex items-center gap-1.5 text-control leading-[1.45] font-medium">{label}{info ? <InfoTip text={info} /> : null}</div>{hint ? <div className="text-muted-foreground text-caption leading-[1.45]">{hint}</div> : null}</div><div className="flex flex-none items-center gap-1.5">{children}</div></label>;
}
// The vocabulary of every section of Ajustes, as the mock-up draws it. Block: a heading (.sec-h) with its note and, under
// them, a panel; its own flow keeps the 16 px between heading, note and panel.
export function Block({ title, count, note, actions, children, className, ...props }) {
  return (
    <section className={cn('mt-1 flex min-w-0 flex-col gap-4', className)} {...props}>
      <div className="-mb-1.5 flex items-center gap-2"><h2 className="font-(family-name:--title) text-card-title leading-[1.45] font-semibold">{title}</h2>{count != null ? <span className="text-faint-foreground text-caption">{count}</span> : null}{actions ? <span className="ml-auto flex items-center gap-1.5">{actions}</span> : null}</div>
      {note ? <p className="text-faint-foreground text-caption leading-[1.45]">{note}</p> : null}
      {children}
    </section>
  );
}
// The frame of a block's rows (.lcard).
export function Panel({ className, ...props }) { return <ListCard className={cn('mt-3', className)} {...props} />; }
// A setting (.setting): its name and what it does on the left, its control on the right.
export function Setting({ label, hint, children, className, ...props }) {
  return (
    <div className={cn('border-border flex items-center justify-between gap-4 px-3.5 py-3 not-first:border-t', className)} {...props}>
      <div className="flex min-w-0 flex-col gap-0.5"><span className="text-control leading-[1.45] font-medium">{label}</span>{hint ? <span className="text-muted-foreground text-caption leading-[1.45]">{hint}</span> : null}</div>
      {children ? <div className="flex flex-none items-center gap-1.5">{children}</div> : null}
    </div>
  );
}
// A field with its label above it (.fld), a stack of free content (.stack), the foot with the card's button (.cardfoot)
// and a quiet line of explanation (.note).
export function Fld({ label, hint, children, className }) { return <Field label={label} hint={hint} className={cn('border-border px-3.5 py-3 not-first:border-t', className)}>{children}</Field>; }
export function Stack({ className, ...props }) { return <div className={cn('flex flex-col gap-2 px-3.5 py-3', className)} {...props} />; }
export function CardFoot({ className, ...props }) { return <div className={cn('border-border flex items-center justify-end gap-3 border-t px-3.5 py-3', className)} {...props} />; }
export function Hint({ className, ...props }) { return <p className={cn('text-faint-foreground text-caption', className)} {...props} />; }
// A text with keyboard shortcuts in it: each {name} of the text becomes its keys (one key per sentence, so it
// translates whole, instead of a sentence cut in five).
export function WithKeys({ text, keys }) {
  return text.split(/(\{\w+\})/).map((part, i) => {
    const combo = /^\{(\w+)\}$/.test(part) ? keys[part.slice(1, -1)] : null;
    return combo ? <span key={i} className="whitespace-nowrap">{combo.map((k, j) => <Kbd key={j} className={j ? 'ml-0.5' : undefined}>{k}</Kbd>)}</span> : part;
  });
}

// Interface: its size on this PC (also Ctrl + / Ctrl - / Ctrl 0) and the terminal that Ctrl+J opens.
export const sizes = () => [{ value: '0.9', label: t('settings.size.small') }, { value: '1', label: t('settings.size.normal') }, { value: '1.1', label: t('settings.size.large') }, { value: '1.25', label: t('settings.size.xlarge') }];
// What a notification shows on a locked phone. «all» (the bots' messages too) shows the same as «chat»:
// it is offered no more and reads as «chat».
export const PREVIEWS = ['chat', 'none'];
export const previewOf = (v) => (v === 'none' ? 'none' : 'chat');

// The new password twice with its strength: shared by the master password's screens and the rebuild flow, so neither imports the other.
import { Field, Input } from '@/components/ui/basic.jsx';
import { Checkbox } from '@/components/ui/overlay.jsx';
import { passwordStrength, MASTER_MIN } from '@/lib/core-access.js';
import { useT } from '@/lib/i18n.js';
import { cn } from '@/lib/utils.js';

const MIN = MASTER_MIN;
const BAR = ['bg-destructive', 'bg-destructive', 'bg-warning', 'bg-success', 'bg-success'];

// The new password twice, its strength and, when asked, the box «Entiendo que…».
export function NewPassword({ v, set, ack = null, autoFocus = false }) {
  const t = useT();
  const score = passwordStrength(v.next, MIN);
  return (
    <div className="grid gap-3">
      <Field label={t('master.password')} hint={t('master.hint', { n: MIN })}>
        <Input type="password" autoComplete="new-password" autoFocus={autoFocus} value={v.next} onChange={(e) => set({ next: e.target.value })} data-testid="master-new" />
      </Field>
      {v.next ? (
        <div className="grid gap-1" data-testid="master-strength">
          <div className="flex gap-1">{[1, 2, 3, 4].map((i) => <span key={i} className={cn('h-1 flex-1 rounded-full', i <= score ? BAR[score] : 'bg-muted')} />)}</div>
          <span className="text-muted-foreground text-xs">{t(`master.strength.${score}`)}</span>
        </div>
      ) : null}
      <Field label={t('master.repeat')}><Input type="password" autoComplete="new-password" value={v.again} onChange={(e) => set({ again: e.target.value })} data-testid="master-again" /></Field>
      {v.again && v.again !== v.next ? <p className="text-destructive text-xs" role="alert">{t('master.mismatch')}</p> : null}
      {ack ? (
        <label className="flex cursor-pointer items-start gap-2 text-control"><Checkbox checked={Boolean(v.ack)} onCheckedChange={(c) => set({ ack: c === true })} data-testid="master-ack" className="mt-0.5" /><span>{ack}</span></label>
      ) : null}
    </div>
  );
}
export const ready = (v, ack = true) => [...String(v.next ?? '')].length >= MIN && v.next === v.again && (!ack || v.ack === true);

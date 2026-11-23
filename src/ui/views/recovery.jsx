// The recovery code in the window: made (or made again) with the password or the code now in force, shown once to copy or
// print. Making a new one also changes the data key unless the box is cleared, and then the dialog says what that leaves open.
// The vault checks what is typed (src/engine/api/master.mjs › backup.recovery); a token proves nothing here.
import { Copy, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Field, Input } from '@/components/ui/basic.jsx';
import { Checkbox } from '@/components/ui/overlay.jsx';
import { form, confirm } from '@/components/dialogs.jsx';
import { call } from '@/lib/store.js';
import { notifyOk } from '@/lib/notify.js';
import { keepUnlock } from '@/lib/core-access.js';
import { printCode } from '@/lib/print-code.js';
import { t as tNow } from '@/lib/i18n.js';
import { quiet } from '@/lib/quiet.js';
import { ProofFields, proofParams } from './hello.jsx';

// → the engine's answer, or null when it was cancelled. A new generated code is shown at the end; a phrase of the user's own
// (for the copies only) is only confirmed.
export async function newRecoveryCode() {
  const [status, master] = await Promise.all([call('backup.status').catch(() => null), call('master.state').catch(() => null)]);
  const hasCode = master?.hasCode === true;
  const replaces = hasCode || status?.recovery === true;
  const canCode = hasCode; // only a code the vault holds can stand in for the password
  const r = await form(tNow(replaces ? 'recovery.titleAgain' : 'recovery.title'), {
    description: tNow(replaces ? 'recovery.descAgain' : 'recovery.desc'),
    initial: { secret: '', mode: 'password', rekey: true, own: false, phrase: '' },
    body: (v, set) => (<>
      <ProofFields v={v} set={set} allowCode={canCode && !(replaces && v.rekey && !v.own)} />
      {replaces && !v.own ? (<>
        <label className="flex cursor-pointer items-start gap-2 text-control"><Checkbox checked={v.rekey} onCheckedChange={(c) => set({ rekey: c === true, ...(c === true && v.mode === 'code' ? { mode: 'password', secret: '' } : {}) })} data-testid="recovery-rekey" className="mt-0.5" /><span>{tNow('recovery.rekey')}</span></label>
        {v.rekey ? <p className="text-muted-foreground m-0 text-xs leading-snug" data-testid="recovery-rekey-note">{tNow('recovery.rekeyNote')}</p>
          : <p className="text-warning-ink m-0 text-control leading-[1.45]" role="note" data-testid="recovery-keep-warning">{tNow('recovery.keepWarning')}</p>}
      </>) : null}
      {v.own ? <Field label={tNow('recovery.phraseLabel')} hint={tNow('recovery.phraseHint')}><Input autoComplete="off" spellCheck={false} value={v.phrase} onChange={(e) => set({ phrase: e.target.value })} data-testid="recovery-phrase" /></Field> : null}
      <button type="button" className="text-muted-foreground hover:text-foreground w-fit text-xs underline" onClick={() => set({ own: !v.own, rekey: true, phrase: '', mode: 'password', secret: '' })} data-testid="recovery-own">{tNow(v.own ? 'recovery.useGenerated' : 'recovery.useOwn')}</button>
    </>),
    ok: tNow('recovery.make'),
    onOk: async (v) => {
      if (!v.secret) throw new Error(tNow('recovery.fillProof'));
      const proof = proofParams(v, 'current');
      if (v.own) {
        if ([...v.phrase.trim()].length < 12) throw new Error(tNow('recovery.phraseShort'));
        // A phrase takes the generated code's place: the code stops recovering the password, and the copies will ask the phrase.
        if (hasCode && !(await confirm(tNow('recovery.phraseTitle'), tNow('recovery.phraseDrops'), { ok: tNow('recovery.phraseOk'), danger: true }))) return false;
        return call('backup.recovery', { ...proof, code: v.phrase.trim(), ...(hasCode ? { confirm: true } : {}) });
      }
      return call('backup.recovery', { ...proof, ...(replaces ? { rekey: v.rekey } : {}) });
    }
  });
  if (!r) return null;
  // A new data key unlinks the phones; the answer carries the new unlock, kept for what the user does next.
  if (r.rekeyed) keepUnlock(r);
  if (!r.code) { notifyOk(tNow('recovery.phraseDone')); return r; }
  await form(tNow('datos.codeTitle'), {
    description: tNow('datos.codeDesc'),
    initial: {},
    noClose: true,
    body: () => (
      <div className="grid gap-2">
        <div className="bg-muted rounded-lg px-3 py-3 text-center font-mono text-lg font-semibold tracking-wider break-all select-all" data-testid="recovery-code">{r.code}</div>
        <div className="flex flex-wrap gap-1">
          {navigator.clipboard ? <Button type="button" size="sm" variant="ghost" className="w-fit" onClick={() => navigator.clipboard.writeText(r.code).then(() => notifyOk(tNow('datos.copied'))).catch(quiet)} data-testid="recovery-copy"><Copy />{tNow('datos.copy')}</Button> : null}
          <Button type="button" size="sm" variant="ghost" className="w-fit" onClick={() => printCode(r.code, { title: tNow('recovery.printTitle'), note: tNow('recovery.printNote') })} data-testid="recovery-print"><Printer />{tNow('recovery.print')}</Button>
        </div>
        {r.rekeyed ? <p className="text-muted-foreground m-0 text-xs leading-snug" data-testid="recovery-rekeyed">{tNow('recovery.rekeyed', { n: r.unlinked ?? 0 })}</p> : null}
        {r.warn ? <p className="text-warning-ink m-0 text-control leading-[1.45]" role="note" data-testid="recovery-warn">{r.warn}</p> : null}
        {r.copyWrapFailed ? <p className="text-warning-ink m-0 text-control leading-[1.45]" role="note" data-testid="recovery-copy-failed">{tNow('recovery.copyFailed')}</p> : null}
      </div>
    ),
    ok: tNow('datos.codeKept')
  });
  return r;
}

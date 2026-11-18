// Imperative dialogs: confirm(...) and form(...) return promises, rendered by <DialogHost/> once in the app.
import { useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogBody, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/overlay.jsx';
import { Button } from '@/components/ui/button.jsx';
import { FieldError } from '@/components/ui/primitives.jsx';
import { useStore, setState } from '@/lib/store.js';
import { errorText, cn } from '@/lib/utils.js';
import { t } from '@/lib/i18n.js';

let seq = 0;
// The same dialog asked for again while it is open (a double click, or clicks queued while the app was busy) does not
// open a second copy on top: it shares the answer of the one already open.
const opened = new Map(); // kind|title -> promise
function open(dialog) {
  // Same kind, title and text: two different questions that happen to share a title are two dialogs.
  const key = `${dialog.kind}|${dialog.title}|${typeof dialog.body === 'string' ? dialog.body : ''}|${typeof dialog.description === 'string' ? dialog.description : ''}`;
  if (opened.has(key)) return opened.get(key);
  const promise = new Promise((resolve) => setState((s) => ({ dialogs: [...(s.dialogs ?? []), { ...dialog, id: ++seq, resolve }] })));
  opened.set(key, promise);
  promise.finally(() => opened.delete(key));
  return promise;
}
function close(id, value) { setState((s) => { const d = (s.dialogs ?? []).find((x) => x.id === id); d?.resolve(value); return { dialogs: (s.dialogs ?? []).filter((x) => x.id !== id) }; }); }

// tone: 'primary' draws the accept button as the main (neutral) one even when danger keeps the focus on Cancel.
export const confirm = (title, description, { ok = t('comp.dialogs.ok'), cancel = t('comp.dialogs.cancel'), danger = false, warn = false, tone = null, noClose = false } = {}) => open({ kind: 'confirm', title, description, ok, cancel, danger, warn, tone, noClose });
// one of a few answers (each { value, label, hint?, variant? }); resolves with the value chosen, or null when closed.
// With hints, each answer is a full-width button with its one line under it (the first one is the default).
// cancel: false when one of the answers already is «leave it as it is».
export const choose = (title, description, options, { testid, cancel = true, noClose = false } = {}) => open({ kind: 'choice', title, description, options, testid, cancel, noClose });
// noClose: no ✕ in the corner (a question that has its own «Cancelar» button; Escape still closes it).
// Dialogs are 440 px wide, the mock-up's small size; `wide` is for the ones that hold a long text or a diff.
// body: (values, set) => JSX; onOk(values) may throw (shown under the fields, the dialog stays open) or return the result.
// okDisabled(values): the accept button stays off while it is true (a help for the eye: onOk still checks); okDanger draws it red.
export const form = (title, { description, initial = {}, body, ok = t('comp.dialogs.ok'), onOk, wide = false, okDisabled = null, okDanger = false, noClose = false }) => open({ kind: 'form', title, description, initial, body, ok, onOk, wide, okDisabled, okDanger, noClose });

function FormDialog({ d }) {
  const [values, setValues] = useState(d.initial);
  const [busy, setBusy] = useState(false);
  // Why onOk refused, shown under the fields; editing anything clears it.
  const [error, setError] = useState(null);
  const set = (patch) => { setError(null); setValues((v) => ({ ...v, ...patch })); };
  const submit = async (e) => {
    e?.preventDefault();
    setError(null);
    setBusy(true);
    try { const r = d.onOk ? await d.onOk(values) : values; if (r !== false) close(d.id, r ?? true); }
    catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="flex max-h-[inherit] min-h-0 flex-col">
      <DialogHeader className="flex-none"><DialogTitle>{d.title}</DialogTitle>{d.description ? <DialogDescription>{d.description}</DialogDescription> : null}</DialogHeader>
      <DialogBody className="grid gap-4 p-[18px]">{d.body(values, set)}<FieldError>{error}</FieldError></DialogBody>
      <DialogFooter className="flex-none"><Button type="button" variant="outline" onClick={() => close(d.id, null)}>{t('comp.dialogs.cancel')}</Button><Button type="submit" variant={d.okDanger ? 'destructive' : undefined} disabled={busy || Boolean(d.okDisabled?.(values))} aria-busy={busy}>{busy ? <LoaderCircle className="animate-spin" /> : null}{d.ok}</Button></DialogFooter>
    </form>
  );
}

function ChoiceDialog({ d }) {
  const rich = d.options.some((o) => o.hint);
  return (
    <div className="flex max-h-[inherit] min-h-0 flex-col" data-testid={d.testid ?? 'choice-dialog'}>
      <DialogHeader className="flex-none"><DialogTitle>{d.title}</DialogTitle>{d.description ? <DialogDescription className="whitespace-pre-wrap">{d.description}</DialogDescription> : <DialogDescription className="sr-only">{d.title}</DialogDescription>}</DialogHeader>
      {rich ? (
        <DialogBody className="grid gap-2 p-[18px]">
          {d.options.map((o, i) => (
            <button key={o.value} type="button" onClick={() => close(d.id, o.value)} data-testid={`choice-${o.value}`}
              className={`press grid cursor-pointer gap-0.5 rounded-xl border px-4 py-3 text-left transition-colors ${i === 0 ? 'border-primary-text/60 bg-primary-soft bg-primary-soft' : 'hover:bg-accent/60'} ${o.variant === 'danger' ? 'text-destructive' : ''}`}>
              <span className="text-body font-medium">{o.label}</span>
              {o.hint ? <span className="text-muted-foreground text-caption">{o.hint}</span> : null}
            </button>
          ))}
          <div className="flex justify-end pt-1"><Button variant="ghost" onClick={() => close(d.id, null)} data-testid="choice-cancel">{t('comp.dialogs.cancel')}</Button></div>
        </DialogBody>
      ) : (
        <DialogFooter>
          {d.cancel ? <Button variant="ghost" onClick={() => close(d.id, null)} data-testid="choice-cancel">{t('comp.dialogs.cancel')}</Button> : null}
          {d.options.map((o, i) => <Button key={o.value} variant={o.variant ?? (i === d.options.length - 1 ? 'default' : 'outline')} onClick={() => close(d.id, o.value)} data-testid={`choice-${o.value}`}>{o.label}</Button>)}
        </DialogFooter>
      )}
    </div>
  );
}

// A confirmation focuses Cancel when the action is dangerous and the main button otherwise, never the element that opened it.
function confirmAutoFocus(e) {
  e.preventDefault();
  e.currentTarget.querySelector('[data-autofocus]')?.focus();
}
// The Enter that opened the dialog may still be held down; its auto-repeat must not press the focused button.
function swallowHeldEnter(e) { if (e.key === 'Enter' && e.repeat) e.preventDefault(); }

export function DialogHost() {
  const dialogs = useStore((s) => s.dialogs ?? []);
  return dialogs.map((d) => (
    <Dialog key={d.id} open onOpenChange={(o) => { if (!o) close(d.id, null); }}>
      <DialogContent size={d.wide ? undefined : 'sm'} showClose={!d.noClose} className={d.kind === 'confirm' ? 'gap-[18px]' : cn('grid-rows-[minmax(0,1fr)] gap-0 overflow-hidden p-0', d.wide && 'sm:max-w-2xl')} onOpenAutoFocus={d.kind === 'confirm' ? confirmAutoFocus : undefined} onKeyDown={d.kind === 'confirm' ? swallowHeldEnter : undefined}>
        {d.kind === 'confirm' ? (
          <>
            <DialogHeader><DialogTitle>{d.title}</DialogTitle></DialogHeader>
            <DialogDescription className="text-foreground text-control whitespace-pre-wrap">{d.description}</DialogDescription>
            <DialogFooter>
              {d.cancel ? <Button variant="outline" data-autofocus={d.danger ? "" : undefined} onClick={() => close(d.id, false)}>{d.cancel}</Button> : null}
              <Button variant={d.tone === 'primary' ? 'default' : d.danger ? 'destructive' : d.warn ? 'warn' : 'default'} data-autofocus={d.danger && d.cancel ? undefined : ""} onClick={() => close(d.id, true)}>{d.ok}</Button>
            </DialogFooter>
          </>
        ) : d.kind === 'choice' ? <ChoiceDialog d={d} /> : <FormDialog d={d} />}
      </DialogContent>
    </Dialog>
  ));
}

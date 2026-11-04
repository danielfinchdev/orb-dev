// Imperative dialogs: confirm(...) and form(...) return promises, rendered by <DialogHost/> once in the app.
import { useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/overlay.jsx';
import { Button } from '@/components/ui/button.jsx';
import { useStore, setState } from '@/lib/store.js';
import { toast } from 'sonner';
import { errorText } from '@/lib/utils.js';
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

export const confirm = (title, description, { ok = t('comp.dialogs.ok'), cancel = t('comp.dialogs.cancel'), danger = false } = {}) => open({ kind: 'confirm', title, description, ok, cancel, danger });
// 3.7: one of a few answers (each { value, label, hint?, variant? }); resolves with the value chosen, or null when closed.
// With hints, each answer is a full-width button with its one line under it (the first one is the default).
// cancel: false when one of the answers already is «leave it as it is».
export const choose = (title, description, options, { testid, cancel = true } = {}) => open({ kind: 'choice', title, description, options, testid, cancel });
// body: (values, set) => JSX; onOk(values) may throw (shown as a toast, the dialog stays open) or return the result.
export const form = (title, { description, initial = {}, body, ok = t('comp.dialogs.ok'), onOk, wide = false }) => open({ kind: 'form', title, description, initial, body, ok, onOk, wide });

function FormDialog({ d }) {
  const [values, setValues] = useState(d.initial);
  const [busy, setBusy] = useState(false);
  const set = (patch) => setValues((v) => ({ ...v, ...patch }));
  const submit = async (e) => {
    e?.preventDefault();
    setBusy(true);
    try { const r = d.onOk ? await d.onOk(values) : values; if (r !== false) close(d.id, r ?? true); }
    catch (error) { toast.error(errorText(error)); }
    finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader><DialogTitle>{d.title}</DialogTitle>{d.description ? <DialogDescription>{d.description}</DialogDescription> : null}</DialogHeader>
      <div className="grid gap-4">{d.body(values, set)}</div>
      <DialogFooter><Button type="button" variant="outline" onClick={() => close(d.id, null)}>{t('comp.dialogs.cancel')}</Button><Button type="submit" disabled={busy} aria-busy={busy}>{busy ? <LoaderCircle className="animate-spin" /> : null}{d.ok}</Button></DialogFooter>
    </form>
  );
}

function ChoiceDialog({ d }) {
  const rich = d.options.some((o) => o.hint);
  return (
    <div className="grid gap-4" data-testid={d.testid ?? 'choice-dialog'}>
      <DialogHeader><DialogTitle>{d.title}</DialogTitle>{d.description ? <DialogDescription className="whitespace-pre-wrap">{d.description}</DialogDescription> : <DialogDescription className="sr-only">{d.title}</DialogDescription>}</DialogHeader>
      {rich ? (
        <div className="grid gap-2">
          {d.options.map((o, i) => (
            <button key={o.value} type="button" onClick={() => close(d.id, o.value)} data-testid={`choice-${o.value}`}
              className={`press grid cursor-pointer gap-0.5 rounded-xl border px-4 py-3 text-left transition-colors ${i === 0 ? 'border-primary/60 bg-primary/5 hover:bg-primary/10' : 'hover:bg-accent/60'} ${o.variant === 'danger' ? 'text-destructive' : ''}`}>
              <span className="text-[14px] font-medium">{o.label}</span>
              {o.hint ? <span className="text-muted-foreground text-[12.5px]">{o.hint}</span> : null}
            </button>
          ))}
          <div className="flex justify-end pt-1"><Button variant="ghost" onClick={() => close(d.id, null)} data-testid="choice-cancel">{t('comp.dialogs.cancel')}</Button></div>
        </div>
      ) : (
        <DialogFooter>
          {d.cancel ? <Button variant="ghost" onClick={() => close(d.id, null)} data-testid="choice-cancel">{t('comp.dialogs.cancel')}</Button> : null}
          {d.options.map((o, i) => <Button key={o.value} variant={o.variant ?? (i === d.options.length - 1 ? 'default' : 'outline')} onClick={() => close(d.id, o.value)} data-testid={`choice-${o.value}`}>{o.label}</Button>)}
        </DialogFooter>
      )}
    </div>
  );
}

export function DialogHost() {
  const dialogs = useStore((s) => s.dialogs ?? []);
  return dialogs.map((d) => (
    <Dialog key={d.id} open onOpenChange={(o) => { if (!o) close(d.id, null); }}>
      <DialogContent className={d.wide ? 'sm:max-w-2xl' : undefined} onOpenAutoFocus={d.kind === 'confirm' ? (e) => e.preventDefault() : undefined}>
        {d.kind === 'confirm' ? (
          <>
            <DialogHeader><DialogTitle>{d.title}</DialogTitle><DialogDescription className="whitespace-pre-wrap">{d.description}</DialogDescription></DialogHeader>
            <DialogFooter>
              {d.cancel ? <Button variant="outline" onClick={() => close(d.id, false)}>{d.cancel}</Button> : null}
              <Button variant={d.danger ? 'destructive' : 'default'} onClick={() => close(d.id, true)}>{d.ok}</Button>
            </DialogFooter>
          </>
        ) : d.kind === 'choice' ? <ChoiceDialog d={d} /> : <FormDialog d={d} />}
      </DialogContent>
    </Dialog>
  ));
}

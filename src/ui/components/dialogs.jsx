// Imperative dialogs: confirm(...) and form(...) return promises, rendered by <DialogHost/> once in the app.
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/overlay.jsx';
import { Button } from '@/components/ui/button.jsx';
import { useStore, setState } from '@/lib/store.js';
import { toast } from 'sonner';
import { errorText } from '@/lib/utils.js';

let seq = 0;
function open(dialog) { return new Promise((resolve) => setState((s) => ({ dialogs: [...(s.dialogs ?? []), { ...dialog, id: ++seq, resolve }] }))); }
function close(id, value) { setState((s) => { const d = (s.dialogs ?? []).find((x) => x.id === id); d?.resolve(value); return { dialogs: (s.dialogs ?? []).filter((x) => x.id !== id) }; }); }

export const confirm = (title, description, { ok = 'Aceptar', cancel = 'Cancelar', danger = false } = {}) => open({ kind: 'confirm', title, description, ok, cancel, danger });
// body: (values, set) => JSX; onOk(values) may throw (shown as a toast, the dialog stays open) or return the result.
export const form = (title, { description, initial = {}, body, ok = 'Aceptar', onOk, wide = false }) => open({ kind: 'form', title, description, initial, body, ok, onOk, wide });

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
      <DialogFooter><Button type="button" variant="outline" onClick={() => close(d.id, null)}>Cancelar</Button><Button type="submit" disabled={busy}>{d.ok}</Button></DialogFooter>
    </form>
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
        ) : <FormDialog d={d} />}
      </DialogContent>
    </Dialog>
  ));
}

// A phone's fingerprint approves sensitive actions: «Aprobar con el móvil» in the dialogs of the protected actions, and
// Ajustes › Dispositivos, where a phone is allowed to (the password or code typed here) or stopped. The signature is checked in the
// vault; this only asks and waits. lib/approve.js holds the plain functions.
import { useEffect, useRef, useState } from 'react';
import { Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Spinner } from '@/components/ui/basic.jsx';
import { form } from '@/components/dialogs.jsx';
import { call } from '@/lib/store.js';
import { notifyOk, notifyError } from '@/lib/notify.js';
import { waitApproval } from '@/lib/approve.js';
import { useT, t as tNow } from '@/lib/i18n.js';
import { errorText } from '@/lib/utils.js';
import { ProofFields, proofParams } from './hello.jsx';

// In the dialog of a protected action: the phone is asked to approve exactly `request` ({ method, params }); its one-use token
// goes to onToken and the dialog is sent with it (the caller's onOk hands it back). The password box stays under it.
export function MobileBox({ request, onToken, submit = true }) {
  const t = useT();
  const box = useRef(null);
  const live = useRef(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [name, setName] = useState('');
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const run = async () => {
    if (busy) return;
    setBusy(true); setMessage(null);
    try {
      const req = await call('approve.request', request);
      if (live.current) { setName(req.device); if (!req.delivered) setMessage(t('approve.notDelivered')); }
      const r = await waitApproval(call, req.id, { cancelled: () => !live.current });
      if (r.state === 'done' && r.unlock) {
        await onToken({ unlock: r.unlock, until: r.until, strength: 'mobile' });
        if (submit) box.current?.closest('form')?.requestSubmit();
        return;
      }
      if (live.current && r.state !== 'cancelled') setMessage(t(r.state === 'expired' ? 'approve.expired' : 'approve.refused'));
    } catch (error) { if (live.current) setMessage(errorText(error)); }
    finally { if (live.current) setBusy(false); }
  };
  return (
    <div ref={box} className="bg-muted/60 border-border rounded-ctl grid gap-2 border px-3 py-2.5" data-testid="mobile-box">
      <div className="flex items-center gap-3">
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={run} data-testid="mobile-use">{busy ? <Spinner /> : <Smartphone />}{t('approve.title')}</Button>
        {busy && name ? <span className="text-muted-foreground text-xs" role="status" data-testid="mobile-waiting">{t('approve.waitAction', { name })}</span> : null}
      </div>
      {message ? <p className="text-muted-foreground m-0 text-xs leading-snug" role="alert" data-testid="mobile-note">{message}</p> : null}
    </div>
  );
}

// «Permitir que «<móvil>» apruebe acciones delicadas»: the password or the code, typed now, with the phone's name in sight;
// then the phone makes its key and asks for the fingerprint. device: { id, name }.
export async function allowPhone(device, { reload } = {}) {
  const state = await call('master.state').catch(() => null);
  const r = await form(tNow('approve.allow', { name: device.name }), {
    description: tNow('approve.allowDesc', { name: device.name }),
    initial: { secret: '', mode: 'password' },
    body: (v, set) => <ProofFields v={v} set={set} allowCode={state?.hasCode === true} />,
    ok: tNow('approve.allowOk'),
    onOk: (v) => { if (!v.secret) throw new Error(tNow('hello.fillProof')); return call('approve.register', { id: device.id, ...proofParams(v) }); }
  });
  if (!r?.id) return false;
  notifyOk(tNow('approve.waitRegister', { name: device.name }));
  const done = await waitApproval(call, r.id);
  if (done.state === 'done') { notifyOk(tNow('approve.allowed', { name: device.name })); reload?.(); return true; }
  notifyError(new Error(tNow(done.state === 'expired' ? 'approve.expired' : 'approve.refused')));
  return false;
}

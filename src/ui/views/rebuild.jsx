// «Lo he olvidado todo»: no password and no recovery code. Windows Hello on this PC, then the fingerprint on a phone that was allowed to
// approve, then a new password; the vault makes the new recovery code and it is shown once. Without that phone or without Hello
// the way left is starting from scratch (views/master.jsx). The checks are the vault's; this only asks and waits.
import { useEffect, useState } from 'react';
import { Fingerprint, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Spinner } from '@/components/ui/basic.jsx';
import { form } from '@/components/dialogs.jsx';
import { call } from '@/lib/store.js';
import { waitApproval, countdown } from '@/lib/approve.js';
import { t as tNow, useT } from '@/lib/i18n.js';
import { HelloNotes, useHelloUnlock } from './hello.jsx';
import { NewPassword, ready } from './new-password.jsx';
import { showRecoveryCode } from './recovery.jsx';

const Step = ({ title, children, on, testid }) => (
  <section className={`grid gap-1.5 rounded-xl border px-3 py-2.5 ${on ? 'bg-muted/60' : 'opacity-60'}`} data-testid={testid} aria-current={on ? 'step' : undefined}>
    <h3 className="m-0 text-control font-medium">{title}</h3>
    {children}
  </section>
);

function Steps({ v, set, rb }) {
  const t = useT();
  const [now, setNow] = useState(Date.now());
  const hello = useHelloUnlock({
    purpose: 'rebuild-master',
    onToken: async (r) => {
      const req = await call('master.rebuildStart', { unlock: r.unlock, device: rb.phoneId });
      set({ step: 'phone', id: req.id, until: req.until, name: req.device, note: null });
    }
  });
  // The phone's answer; leaving the step (cancel, or the dialog closing) stops the wait.
  useEffect(() => {
    if (v.step !== 'phone') return undefined;
    let live = true;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    waitApproval(call, v.id, { method: 'master.rebuildPoll', cancelled: () => !live }).then((r) => {
      if (!live) return;
      if (r.state === 'done') set({ step: 'password' });
      else set({ step: 'hello', id: null, note: t(r.state === 'expired' ? 'approve.expired' : 'approve.refused') });
    });
    return () => { live = false; clearInterval(tick); };
  }, [v.step, v.id]);
  return (<>
    <Step title={t('rebuild.step1')} on={v.step === 'hello'} testid="rebuild-hello">
      <p className="text-muted-foreground m-0 text-xs leading-snug">{t('rebuild.step1Body')}</p>
      {v.step === 'hello' ? (<>
        <div className="flex items-center gap-3">
          <Button type="button" size="sm" variant="outline" disabled={hello.busy || hello.left > 0 || hello.changed} onClick={hello.run} data-testid="rebuild-hello-use">{hello.busy ? <Spinner /> : <Fingerprint />}{t('rebuild.hello')}</Button>
        </div>
        <HelloNotes {...hello} />
        {v.note ? <p className="text-muted-foreground m-0 text-xs leading-snug" role="alert" data-testid="rebuild-note">{v.note}</p> : null}
      </>) : null}
    </Step>
    <Step title={t('rebuild.step2')} on={v.step === 'phone'} testid="rebuild-phone">
      {v.step === 'phone' ? (<>
        <p className="m-0 flex items-center gap-2 text-control font-medium"><Smartphone className="size-4" />{t('rebuild.phone', { name: v.name })}</p>
        <p className="text-muted-foreground m-0 text-xs leading-snug" role="status" data-testid="rebuild-left">{t('rebuild.phoneBody', { left: countdown(v.until, now) })}</p>
        <div><Button type="button" size="sm" variant="ghost" onClick={() => set({ step: 'hello', id: null, note: null })} data-testid="rebuild-cancel">{t('rebuild.cancel')}</Button></div>
      </>) : v.step === 'hello' ? <p className="text-muted-foreground m-0 text-xs leading-snug">{t('rebuild.waiting')}</p> : null}
    </Step>
    <Step title={t('rebuild.step3')} on={v.step === 'password'} testid="rebuild-password">
      {v.step === 'password' ? (<>
        <p className="text-muted-foreground m-0 text-xs leading-snug">{t('rebuild.step3Body')}</p>
        <NewPassword v={v} set={set} autoFocus />
      </>) : <p className="text-muted-foreground m-0 text-xs leading-snug">{t('rebuild.waiting')}</p>}
    </Step>
  </>);
}

// rb: lib/approve.js › rebuildReadiness (ok: true). → the engine's last answer (with the new code, already shown) or null when cancelled.
export async function rebuildFlow(rb) {
  const r = await form(tNow('rebuild.title'), {
    description: tNow('rebuild.desc'),
    initial: { step: 'hello', id: null, until: 0, name: '', note: null, next: '', again: '' },
    body: (v, set) => <Steps v={v} set={set} rb={rb} />,
    okDisabled: (v) => v.step !== 'password',
    ok: tNow('rebuild.ok'),
    onOk: async (v) => {
      if (!ready(v, false)) throw new Error(tNow(v.next !== v.again ? 'master.mismatch' : 'master.fillAll'));
      return call('master.rebuildFinish', { id: v.id, password: v.next });
    }
  });
  if (!r) return null;
  await showRecoveryCode(r);
  return r;
}

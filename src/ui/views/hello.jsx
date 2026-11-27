// Windows Hello in the window: the button on the lock screen and in the dialogs of protected actions, the row of Ajustes › Datos
// and the welcome's offer. The proof itself is checked in the vault; this only asks for it and tells, in Orb's own window and
// before Windows' notice (which is generic), what is being approved. lib/hello.js holds the plain functions.
import { useEffect, useRef, useState } from 'react';
import { Fingerprint, CircleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Badge, Field, Input, Spinner } from '@/components/ui/basic.jsx';
import { WizardPage, WizardCard, WizardFoot, WizardText, WizardTitle } from '@/components/wizard.jsx';
import { form } from '@/components/dialogs.jsx';
import { call, act } from '@/lib/store.js';
import { notifyOk } from '@/lib/notify.js';
import { unlockCore } from '@/lib/core-access.js';
import { helloMode, helloUsable, waitSeconds, helloDoKey } from '@/lib/hello.js';
import { useT, t as tNow } from '@/lib/i18n.js';
import { errorText } from '@/lib/utils.js';
import { quiet } from '@/lib/quiet.js';
import { Setting } from './settings/rows.jsx';

// Asks Windows Hello for a token. purpose: an «ask every time» action (none: the window's own 5 minutes). onToken gets the
// engine's answer. A refusal says why in the engine's words; the state is read again after it, because over the desktop
// bridge only the text of an error arrives: the 30-second wait and «Hello ha cambiado» come from there.
export function useHelloUnlock({ purpose = null, onToken, wait = null }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [changed, setChanged] = useState(false);
  const [until, setUntil] = useState(0);
  const [left, setLeft] = useState(0);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  // A wait the engine already holds (a notice cancelled a moment ago) shows from the start.
  useEffect(() => { const at = Date.parse(wait ?? '') || 0; if (at > Date.now()) setUntil(at); }, [wait]);
  useEffect(() => {
    if (!until) { setLeft(0); return undefined; }
    const tick = () => { const s = waitSeconds(until); setLeft(s); if (!s) setUntil(0); };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [until]);
  const run = async () => {
    if (busy || left > 0) return;
    setBusy(true); setMessage(null);
    try {
      const r = await call('master.unlockHello', purpose ? { purpose } : {});
      if (r?.unlock) await onToken(r);
    } catch (error) {
      if (!live.current) return;
      setMessage(errorText(error));
      const st = await call('master.helloState').catch(() => null);
      if (!live.current) return;
      if (helloMode(st) === 'changed') setChanged(true);
      const until2 = Date.parse(st?.waitUntil ?? '') || (error?.until ? Date.parse(error.until) : 0);
      if (until2) setUntil(until2);
    } finally { if (live.current) setBusy(false); }
  };
  return { busy, message, changed, left, run };
}

// In the dialog of a protected action: what is about to be approved, and the button. The password box stays under it.
// submit: the dialog's form is sent with the token (the caller's onOk hands it back); false where the caller acts on it itself.
export function HelloBox({ action, what = null, purpose = null, wait = null, onToken, submit = true, changed = false, 'data-testid': testid = 'hello-box' }) {
  const t = useT();
  const box = useRef(null);
  const h = useHelloUnlock({ purpose, wait, onToken: async (r) => { await onToken(r); if (submit) box.current?.closest('form')?.requestSubmit(); } });
  const doing = t(helloDoKey(action, what), { what: what ?? '' });
  return (
    <div ref={box} className="bg-muted/60 border-border rounded-ctl grid gap-2 border px-3 py-2.5" data-testid={testid}>
      <p className="m-0 text-control leading-[1.45]" data-testid="hello-confirm">{t('hello.confirm', { action: doing })}</p>
      <div className="flex items-center gap-3">
        <Button type="button" size="sm" variant="outline" disabled={h.busy || h.left > 0 || h.changed} onClick={h.run} data-testid="hello-use">
          {h.busy ? <Spinner /> : <Fingerprint />}{t('hello.use')}
        </Button>
        {h.busy ? <span className="text-muted-foreground text-xs" role="status" data-testid="hello-waiting">{t('hello.waiting')}</span> : null}
      </div>
      <HelloNotes {...h} changed={h.changed || changed} />
    </div>
  );
}

// What went wrong with Hello, under its button: the engine's sentence, the countdown and the way on (the password).
export function HelloNotes({ message, left, changed }) {
  const t = useT();
  if (!message && !left && !changed) return null;
  return (
    <div className="text-muted-foreground grid gap-1 text-xs leading-snug" role="alert" data-testid="hello-notes">
      {message ? <p className="m-0 flex items-start gap-1.5"><CircleAlert className="mt-px size-3.5 shrink-0" />{message}</p> : null}
      {left > 0 ? <p className="m-0" data-testid="hello-wait">{t('hello.waitLeft', { s: left })}</p> : null}
      {changed ? <p className="m-0" data-testid="hello-changed">{t('hello.changedBody')}</p> : null}
    </div>
  );
}

// The line that tells why Windows Hello is not offered for this action (it needs the password), only when Hello is on.
export function HelloPasswordOnly() {
  const t = useT();
  return <p className="text-muted-foreground m-0 text-xs leading-snug" data-testid="hello-password-only">{t('hello.passwordOnly')}</p>;
}

// The password, or the recovery code now in force, typed to prove who is asking (the vault checks it; a token proves nothing
// here). allowCode: this PC has a code that can stand in for the password.
export function ProofFields({ v, set, allowCode = false, autoFocus = true, label = null }) {
  const t = useT();
  const code = v.mode === 'code';
  return (<>
    <Field label={label ?? t(code ? 'recovery.proofCode' : 'recovery.proofPassword')}>
      <Input type={code ? 'text' : 'password'} autoComplete={code ? 'off' : 'current-password'} spellCheck={false} autoFocus={autoFocus} className={code ? 'font-mono' : undefined}
        value={v.secret ?? ''} onChange={(e) => set({ secret: e.target.value })} placeholder={code ? 'XXXX-XXXX-…' : undefined} data-testid="proof-secret" />
    </Field>
    {allowCode ? <button type="button" className="text-muted-foreground hover:text-foreground w-fit text-xs underline" onClick={() => set({ mode: code ? 'password' : 'code', secret: '' })} data-testid="proof-switch">{t(code ? 'recovery.useMaster' : 'recovery.useCode')}</button> : null}
  </>);
}
// The field a ProofFields value stands for, as the engine's params: { password }, or the code under the name the call gives it.
export const proofParams = (v, codeKey = 'code') => (v.mode === 'code' ? { [codeKey]: v.secret ?? '' } : { password: v.secret ?? '' });

// Turn Hello on: the password (or the code) is asked here, whatever token the window holds. proof: when the caller has the
// password already (the welcome), nothing is asked.
export async function enableHello({ allowCode = false, proof = null } = {}) {
  const run = (params) => call('master.helloEnable', params);
  let r;
  if (proof) r = await act(run({ password: proof }));
  else {
    r = await form(tNow('hello.enableTitle'), {
      description: tNow('hello.enableDesc'),
      initial: { secret: '', mode: 'password' },
      body: (v, set) => (<>
        <p className="text-warning-ink m-0 text-control leading-[1.45]" data-testid="hello-risk">{tNow('hello.risk')}</p>
        <ProofFields v={v} set={set} allowCode={allowCode} />
      </>),
      ok: tNow('hello.enableOk'),
      onOk: (v) => { if (!v.secret) throw new Error(tNow('hello.fillProof')); return run(proofParams(v)); }
    });
  }
  if (r?.ok) notifyOk(tNow('hello.enabled'));
  return r?.ok === true;
}

// The row of Ajustes › Datos: its state, the risk in plain words and «Activar» / «Desactivar».
export function HelloSetting({ canCode = false }) {
  const t = useT();
  const [st, setSt] = useState(null);
  const load = () => call('master.helloState').then(setSt).catch((e) => { quiet(e); setSt(null); });
  useEffect(() => { load(); }, []);
  const mode = helloMode(st);
  if (mode === 'unknown') return null;
  const on = mode === 'on' || mode === 'noChip';
  const turnOn = async () => { if (await enableHello({ allowCode: canCode })) load(); };
  const turnOff = async () => {
    const unlock = await unlockCore('helloOff');
    if (!unlock) return;
    if (await act(call('master.helloDisable', { unlock }), t('hello.disabled'))) load();
  };
  const hint = (
    <span className="grid gap-1" data-testid="hello-setting-hint">
      <span data-testid={`hello-state-${mode}`}>{mode === 'changed' ? <Badge variant="warning">{t('hello.state.changed')}</Badge> : t(`hello.state.${mode}`)}</span>
      {mode === 'none' ? null : <span>{t('hello.risk')}</span>}
      {on ? <span>{t('hello.secretsNote')}</span> : null}
    </span>
  );
  return (
    <Setting label={t('hello.title')} hint={hint} data-testid="hello-setting">
      {on ? <Button size="sm" variant="outline" onClick={turnOff} data-testid="hello-off">{t('hello.off')}</Button> : null}
      {mode === 'off' || mode === 'changed' ? <Button size="sm" variant="outline" onClick={turnOn} data-testid="hello-on"><Fingerprint />{t(mode === 'changed' ? 'hello.again' : 'hello.on')}</Button> : null}
    </Setting>
  );
}

// The welcome's offer, after the password and the recovery code: turn it on (the password just typed proves it) or skip.
export function HelloOffer({ password, wizard = false, onDone }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const turnOn = async () => {
    setBusy(true); setError(null);
    try { await call('master.helloEnable', { password }); notifyOk(t('hello.enabled')); onDone?.(); }
    catch (e) { setError(errorText(e)); setBusy(false); }
  };
  return (
    <WizardPage step={wizard ? 'maestra' : undefined}>
      <WizardCard kick={wizard ? t('setup.kick', { n: 4 }) : null} data-testid="hello-offer">
        <WizardTitle>{t('hello.offerTitle')}</WizardTitle>
        <WizardText>{t('hello.offerBody')}</WizardText>
        <WizardText role="note" data-testid="hello-risk">{t('hello.risk')}</WizardText>
        {error ? <p className="text-destructive flex items-center gap-1.5 text-xs" role="alert" data-testid="hello-offer-error"><CircleAlert className="size-3.5 shrink-0" />{error}</p> : null}
        <WizardFoot>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onDone?.()} data-testid="hello-offer-skip">{t('hello.notNow')}</Button>
          <Button type="button" disabled={busy} onClick={turnOn} data-testid="hello-offer-on">{busy ? <Spinner className="border-primary-foreground/40 border-t-primary-foreground" /> : <Fingerprint />}{t('hello.on')}</Button>
        </WizardFoot>
      </WizardCard>
    </WizardPage>
  );
}

// Whether the welcome (or any caller) should offer Hello: this PC has it set up and it is not on yet.
export async function helloOfferable() {
  try { return helloMode(await call('master.helloState')) === 'off'; } catch { return false; }
}
export { helloUsable };

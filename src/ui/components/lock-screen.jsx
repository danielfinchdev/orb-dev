// 3.6 «Personas»: the lock screens. On this PC the lock is the engine's (persons.lock): while it is up, the window can
// only unlock (app.lockState says who may, by name). On a phone or a browser, and in the Android app, a person with a
// PIN is asked for it when the app opens and after a while in the background (in the app, the fingerprint works too).
// Also the «update the app» screen, when the Orb speaks a newer version of the link than this app.
import { useEffect, useRef, useState } from 'react';
import { Lock, Fingerprint, LoaderCircle, Download } from 'lucide-react';
import { Robot } from '@/components/robot.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/basic.jsx';
import { PersonDot } from '@/components/person-menu.jsx';
import { useStore, call, bridge, setState, getState, personSwitched, refresh } from '@/lib/store.js';
import { pinRefusal, phoneShouldLock } from '@/lib/persons.js';
import { cn } from '@/lib/utils.js';
import { AUTHOR } from '../../core/product.mjs';
import { useT } from '@/lib/i18n.js';

function PinPad({ onSubmit, busy, error, testid = 'lock-pin' }) {
  const t = useT();
  const [pin, setPin] = useState('');
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  useEffect(() => { if (error) setPin(''); }, [error]);
  return (
    <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); if (pin) onSubmit(pin); }}>
      <Input ref={ref} type="password" inputMode="numeric" autoComplete="off" maxLength={12} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder={t('persons.pin.label')} aria-label={t('persons.pin.label')} className="text-center text-lg tracking-[0.4em]" data-testid={testid} />
      {error ? <p className="text-destructive text-sm" role="alert" data-testid="lock-error">{error}</p> : null}
      <Button type="submit" size="lg" disabled={busy || !pin} data-testid="lock-unlock">{busy ? <LoaderCircle className="animate-spin" /> : <Lock />}{t('persons.unlock')}</Button>
    </form>
  );
}

function Frame({ children, testid }) {
  return (
    <div className="brand-sky grid h-full place-items-center overflow-y-auto p-6 text-center" data-testid={testid}>
      <div className="app-titlebar fixed inset-x-0 top-0 z-40 h-14" aria-hidden="true" />
      <div className="bg-card/95 text-card-foreground grid w-full max-w-sm gap-4 rounded-3xl p-7 shadow-2xl">{children}</div>
    </div>
  );
}

// This PC: who sits down, and their PIN. The person who was here is chosen first.
export function LockScreen() {
  const t = useT();
  const [st, setSt] = useState(null);
  const [pick, setPick] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { call('app.lockState').then((s) => { setSt(s); setPick(s?.person?.id ?? s?.persons?.[0]?.id ?? null); }).catch(() => {}); }, []);
  const who = st?.persons?.find((p) => p.id === pick) ?? null;
  const unlock = async (pin) => {
    setBusy(true); setError('');
    try {
      const r = await call('persons.unlock', { id: pick, pin });
      const why = pinRefusal(r);
      if (why) { setError(t(why.key, why.vars)); return; }
      if (r.person?.id && r.person.id !== st?.person?.id) await personSwitched();
      else { await refresh().catch(() => {}); if (getState().app?.config) setState({ locked: false }); }
    } catch (e) { setError(String(e?.message ?? e)); }
    finally { setBusy(false); }
  };
  return (
    <Frame testid="lock-screen">
      <div className="-mt-16 flex justify-center"><Robot size={104} mood="idle" /></div>
      <h1 className="text-xl">{t('persons.lockedTitle')}</h1>
      <p className="text-muted-foreground text-sm">{t('persons.lockedBody')}</p>
      {st?.persons?.length > 1 ? (
        <div className="flex flex-wrap justify-center gap-2" role="radiogroup" aria-label={t('persons.whoUnlocks')}>
          {st.persons.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={pick === p.id} onClick={() => { setPick(p.id); setError(''); }} data-testid={`lock-person-${p.name}`}
              className={cn('flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm', pick === p.id ? 'border-primary bg-primary/10 font-medium' : 'hover:bg-accent')}>
              <PersonDot name={p.name} size="sm" />{p.name}
            </button>
          ))}
        </div>
      ) : null}
      {who?.hasPin === false ? <Button size="lg" onClick={() => unlock(null)} disabled={busy} data-testid="lock-unlock">{busy ? <LoaderCircle className="animate-spin" /> : <Lock />}{t('persons.enterAs', { name: who.name })}</Button>
        : <PinPad key={pick} onSubmit={unlock} busy={busy} error={error} />}
    </Frame>
  );
}

// A phone, a browser or the Android app: the person's PIN (checked by the Orb: persons.verifyPin) or, in the app, their
// fingerprint. Kept in memory only: a new page asks again.
export function PhoneLock({ children }) {
  const t = useT();
  const me = useStore((s) => s.me);
  const forced = useStore((s) => s.phoneLocked);
  const hasPin = Boolean(me?.person?.hasPin);
  const [unlockedAt, setUnlockedAt] = useState(null);
  const hiddenAt = useRef(null);
  const [, redraw] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [bio, setBio] = useState(false);
  useEffect(() => { bridge.appLock?.available?.().then((ok) => setBio(Boolean(ok))).catch(() => setBio(false)); }, []);
  useEffect(() => {
    const vis = () => { if (document.hidden) hiddenAt.current = Date.now(); else { redraw((n) => n + 1); } };
    document.addEventListener('visibilitychange', vis);
    return () => document.removeEventListener('visibilitychange', vis);
  }, []);
  useEffect(() => { if (forced) { setUnlockedAt(null); setState({ phoneLocked: false }); } }, [forced]);
  const locked = phoneShouldLock({ hasPin, unlockedAt, hiddenAt: hiddenAt.current });
  const done = () => { hiddenAt.current = null; setUnlockedAt(Date.now()); setError(''); };
  const byPin = async (pin) => {
    setBusy(true); setError('');
    try {
      const r = await call('persons.verifyPin', { pin });
      const why = pinRefusal(r);
      if (why) setError(t(why.key, why.vars)); else done();
    } catch (e) { setError(String(e?.message ?? e)); }
    finally { setBusy(false); }
  };
  const byFinger = async () => { try { if (await bridge.appLock.verify(t('persons.fingerReason'))) done(); } catch (e) { setError(String(e?.message ?? e)); } };
  useEffect(() => { if (locked && bio) byFinger(); }, [locked, bio]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!locked) return children;
  return (
    <Frame testid="phone-lock">
      <div className="-mt-16 flex justify-center"><Robot size={104} mood="idle" /></div>
      <div className="flex items-center justify-center gap-2"><PersonDot name={me.person.name} color={me.person.color} /><h1 className="text-xl">{me.person.name}</h1></div>
      <p className="text-muted-foreground text-sm">{t('persons.phoneLockedBody')}</p>
      <PinPad onSubmit={byPin} busy={busy} error={error} />
      {bio ? <Button variant="outline" onClick={byFinger} data-testid="lock-finger"><Fingerprint />{t('persons.useFinger')}</Button> : null}
    </Frame>
  );
}

// The Orb needs a newer app (protocol): what to do, in plain words.
export function UpdateNeeded({ info }) {
  const t = useT();
  const u = info?.needsUpdate ?? {};
  return (
    <Frame testid="update-needed">
      <div className="-mt-16 flex justify-center"><Robot size={104} mood="worried" /></div>
      <h1 className="text-xl">{t('persons.updateTitle')}</h1>
      <p className="text-muted-foreground text-sm">{u.message || t('persons.updateBody')}</p>
      {u.app ? <Button size="lg" onClick={() => bridge.openExternal?.(`https://github.com/${AUTHOR.repo}/releases/latest`)} data-testid="update-open"><Download />{t('persons.updateApp')}</Button> : null}
    </Frame>
  );
}

export const isLocked = () => Boolean(getState().locked);

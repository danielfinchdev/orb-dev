// «Falta la carpeta core»: core (or its settings) is gone and Orb could not bring it back by itself from the newest
// backup (none, one this PC cannot open without its recovery code, or a damaged one). The engine waits
// (engine.mjs › coreBlocked): restore with the code, pick another backup, or go on without one: offered when there is no
// usable copy, and behind «No tengo el código» when a copy only needs its code (the copies there were are kept aside).
import { useRef, useState } from 'react';
import { FolderOpen, FolderX } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Input, Spinner } from '@/components/ui/basic.jsx';
import { StartNotice, StartDetails, startText } from '@/components/start-card.jsx';
import { confirm } from '@/components/dialogs.jsx';
import { bridge, act } from '@/lib/store.js';
import { useT, useLocale } from '@/lib/i18n.js';
import { coreView } from '@/lib/core-access.js';

export function CoreMissing({ state }) {
  const t = useT();
  const locale = useLocale();
  const [s, setS] = useState(state);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [noCode, setNoCode] = useState(false);
  const [codeMissing, setCodeMissing] = useState(false);
  const codeRef = useRef(null);
  const when = (iso) => (iso ? new Date(iso).toLocaleString(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
  const v = coreView(s, { when });
  const repair = async (params) => {
    setBusy(true);
    try { const r = await bridge.call('app.coreRepair', params); if (r?.missing) setS(r); else location.reload(); }
    catch (e) { setS({ ...s, error: String(e?.message ?? e) }); }
    finally { setBusy(false); }
  };
  const pick = async () => {
    const files = await bridge.pickFiles?.(t('datos.pickFile'));
    const file = Array.isArray(files) ? files[0] : files;
    if (file) repair({ file, passphrase: code || null });
  };
  const fresh = async () => { if (await confirm(t('data.core.fresh'), t('data.core.freshConfirm'), { ok: t('data.core.fresh'), danger: true, tone: 'primary', noClose: true })) repair({ fresh: true, language: locale?.startsWith('en') ? 'en' : 'es' }); };
  const offerFresh = v.fresh === 'yes' || (v.fresh === 'noCode' && noCode);
  // «Restaurar» is never greyed out: with no code typed it points at the field instead of doing nothing.
  const restore = () => {
    if (!code.trim()) { setCodeMissing(true); codeRef.current?.focus(); return; }
    repair({ passphrase: code });
  };
  // Left to right as the mock-up draws them: the way out, another copy, and the main action last. The backups' folder is a
  // quiet link under them (the mock-up does not draw it).
  const footer = (
    <>
      {!offerFresh && v.fresh === 'noCode' ? <Button variant="ghost" disabled={busy} onClick={() => setNoCode(true)} data-testid="core-no-code">{t('data.core.noCode')}</Button> : null}
      {bridge.pickFiles ? <Button variant="outline" disabled={busy} onClick={pick} data-testid="core-pick">{t('data.core.pick')}</Button> : null}
      {offerFresh ? <Button variant={v.restore ? 'outline' : 'default'} disabled={busy} onClick={fresh} data-testid="core-fresh">{t('data.core.fresh')}</Button> : null}
      {v.restore ? <Button disabled={busy} onClick={restore} data-testid="core-restore">{busy ? <Spinner className="border-primary-foreground/40 border-t-primary-foreground" /> : null}{t('data.core.restore')}</Button> : null}
    </>
  );
  const folderLink = v.folder && bridge.openPath ? (
    <button type="button" className="text-muted-foreground hover:text-foreground inline-flex cursor-pointer items-center gap-1.5 self-start border-0 bg-transparent p-0 text-caption underline-offset-2 hover:underline" onClick={() => act(bridge.openPath(v.folder))} data-testid="core-open-folder"><FolderOpen className="size-3.5" aria-hidden="true" />{t('data.core.openFolder')}</button>
  ) : null;
  return (
    <StartNotice testid="core-missing" icon={FolderX} mood={busy ? 'thinking' : 'worried'} title={t('data.core.title')} footer={footer}
      details={s.error ? <StartDetails>{s.error}</StartDetails> : null} footnote={folderLink}>
      <p className={startText} role="alert">{t(v.body, v.vars)}</p>
      {v.passphrase ? (
        <>
          <Input ref={codeRef} type="password" autoComplete="off" placeholder={t('data.core.code')} aria-label={t('data.core.code')} aria-invalid={codeMissing && !code.trim() ? true : undefined} aria-describedby={codeMissing && !code.trim() ? 'core-code-error' : undefined}
            value={code} onChange={(e) => { setCode(e.target.value); if (e.target.value.trim()) setCodeMissing(false); }} data-testid="core-code" />
          {codeMissing && !code.trim() ? <p id="core-code-error" className="text-destructive m-0 text-caption" role="alert" data-testid="core-code-error">{t('data.core.codeNeeded')}</p> : null}
        </>
      ) : null}
    </StartNotice>
  );
}

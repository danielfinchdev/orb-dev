// 3.8: «Falta la carpeta core»: core (or its settings) is gone and Orb could not bring it back by itself from the newest
// backup (none, one this PC cannot open without its recovery code, or a damaged one). The engine waits
// (engine.mjs › coreBlocked): restore with the code, pick another backup, or go on without one.
import { useState } from 'react';
import { RotateCw, FolderOpen, FileArchive, ArrowRight } from 'lucide-react';
import { Robot } from '@/components/robot.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Input, Spinner } from '@/components/ui/basic.jsx';
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
  const fresh = async () => { if (await confirm(t('data.core.fresh'), t('data.core.freshConfirm'), { ok: t('data.core.fresh') })) repair({ fresh: true }); };
  return (
    <div className="grid h-full place-items-center overflow-y-auto p-8 text-center" data-testid="core-missing">
      <div className="grid max-w-md gap-3">
        <div className="flex justify-center"><Robot size={90} mood={busy ? 'thinking' : 'worried'} /></div>
        <h1 className="text-xl">{t('data.core.title')}</h1>
        <p className="text-muted-foreground text-sm" role="alert">{t(v.body, v.vars)}</p>
        {v.passphrase ? <Input type="password" autoComplete="off" placeholder={t('data.core.code')} aria-label={t('data.core.code')} value={code} onChange={(e) => setCode(e.target.value)} data-testid="core-code" /> : null}
        <div className="flex flex-wrap justify-center gap-2">
          {v.restore ? <Button disabled={busy || !code.trim()} onClick={() => repair({ passphrase: code })} data-testid="core-restore">{busy ? <Spinner /> : <RotateCw />}{t('data.core.restore')}</Button> : null}
          {bridge.pickFiles ? <Button variant="outline" disabled={busy} onClick={pick} data-testid="core-pick"><FileArchive />{t('data.core.pick')}</Button> : null}
          {v.folder && bridge.openPath ? <Button variant="outline" onClick={() => act(bridge.openPath(v.folder))}><FolderOpen />{t('data.core.openFolder')}</Button> : null}
          <Button variant="ghost" disabled={busy} onClick={fresh} data-testid="core-fresh"><ArrowRight />{t('data.core.fresh')}</Button>
        </div>
        {s.error ? <details className="text-muted-foreground text-left text-xs"><summary className="cursor-pointer text-center">{t('data.core.details')}</summary><p className="mt-2 break-words">{s.error}</p></details> : null}
      </div>
    </div>
  );
}

// 3.6: Ajustes › Datos (the owner, on this PC): encrypted backups (every day at 03:00, or now), the recovery code that
// opens them on another PC, restoring one, and moving this Orb to another PC. src/engine/api-data.mjs does the work.
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { HardDriveDownload, KeyRound, RotateCcw, Truck, LoaderCircle, ShieldCheck, TriangleAlert, Copy, FolderOpen, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Badge, Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter, Field, Input } from '@/components/ui/basic.jsx';
import { confirm, form } from '@/components/dialogs.jsx';
import { call, act, bridge } from '@/lib/store.js';
import { useT, useLocale, t as tNow } from '@/lib/i18n.js';

const size = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);

// The recovery code: made here and shown once, to write down (copies made from then on open with it on another PC).
export async function newRecoveryCode() {
  const r = await act(call('backup.recovery', {}));
  if (!r?.code) return null;
  await form(tNow('datos.codeTitle'), {
    description: tNow('datos.codeDesc'),
    initial: {},
    body: () => (
      <div className="grid gap-2">
        <div className="bg-muted rounded-lg px-3 py-3 text-center font-mono text-lg font-semibold tracking-wider break-all select-all" data-testid="recovery-code">{r.code}</div>
        {navigator.clipboard ? <Button type="button" size="sm" variant="ghost" className="w-fit" onClick={() => navigator.clipboard.writeText(r.code).then(() => toast.success(tNow('datos.copied'))).catch(() => {})}><Copy />{tNow('datos.copy')}</Button> : null}
      </div>
    ),
    ok: tNow('datos.codeKept')
  });
  return r;
}

function BackupsCard() {
  const t = useT();
  const locale = useLocale();
  const [st, setSt] = useState(null);
  const [list, setList] = useState([]);
  const [busy, setBusy] = useState(false);
  const load = () => Promise.all([call('backup.status').then(setSt), call('backup.list').then(setList)]).catch(() => {});
  useEffect(() => { load(); return bridge.on('backup:done', () => load()); }, []);
  if (!st) return null;
  const when = (iso) => (iso ? new Date(iso).toLocaleString(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
  const now = async () => { setBusy(true); const r = await act(call('backup.now', {}), t('datos.made')); setBusy(false); if (r) load(); };
  const restore = async (b) => {
    const r = await form(t('datos.restoreTitle'), {
      description: t('datos.restoreDesc', { when: when(b.created) }),
      initial: { passphrase: '' },
      body: (v, set) => <Field label={t('datos.restorePass')} hint={t('datos.restorePassHint')}><Input type="password" autoComplete="off" value={v.passphrase} onChange={(e) => set({ passphrase: e.target.value })} /></Field>,
      ok: t('datos.restore'),
      onOk: async (v) => { await call('backup.verify', { file: b.name, passphrase: v.passphrase || null }); return call('backup.restore', { file: b.name, passphrase: v.passphrase || null }); }
    });
    if (r) toast.success(t('datos.restoreReady'), { duration: 10000 });
  };
  const pickFile = async () => {
    const files = await bridge.pickFiles?.(t('datos.pickFile'));
    const file = Array.isArray(files) ? files[0] : files;
    if (file) restore({ name: file, created: null });
  };
  return (
    <Card data-testid="backups-card">
      <CardHeader className="flex-row items-start gap-3"><HardDriveDownload className="text-primary mt-0.5 size-5 shrink-0" /><div><CardTitle>{t('datos.backupsTitle')}</CardTitle><CardDescription>{t('datos.backupsHint', { hour: String(st.hour).padStart(2, '0') })}</CardDescription></div></CardHeader>
      <CardContent className="grid gap-3">
        <div className="text-muted-foreground grid gap-1 text-xs">
          <span>{t('datos.folder')}: <span className="text-foreground font-mono break-all">{st.folder}</span></span>
          <span data-testid="backup-last">{st.last ? (st.last.ok ? t('datos.lastOk', { when: when(st.last.at) }) : t('datos.lastFailed', { when: when(st.last.at), error: st.last.error ?? '' })) : t('datos.none')}</span>
          {!st.recovery ? <span className="text-warning flex items-center gap-1"><TriangleAlert className="size-3.5" />{t('datos.noCode')}</span> : <span className="flex items-center gap-1"><ShieldCheck className="text-success size-3.5" />{t('datos.withCode')}</span>}
        </div>
        {list.length ? (
          <div className="grid gap-1.5" data-testid="backup-list">
            {list.slice(0, 8).map((b) => (
              <div key={b.name} className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[13px]">
                <span className="min-w-0 flex-1 truncate">{when(b.created)}</span>
                <Badge variant="outline" className="font-normal">{t(`datos.kind.${['daily', 'manual', 'preupdate', 'premigration', 'move'].includes(b.kind) ? b.kind : 'other'}`)}</Badge>
                <span className="text-muted-foreground text-xs tabular-nums">{size(b.size)}</span>
                {b.damaged ? <Badge variant="destructive">{t('datos.damaged')}</Badge> : <Button size="xs" variant="ghost" onClick={() => restore(b)}><RotateCcw />{t('datos.restore')}</Button>}
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
      <CardFooter className="flex-wrap">
        <Button size="sm" onClick={now} disabled={busy || st.running} data-testid="backup-now">{busy || st.running ? <LoaderCircle className="animate-spin" /> : <HardDriveDownload />}{t('datos.now')}</Button>
        <Button size="sm" variant="outline" onClick={async () => { if (await newRecoveryCode()) load(); }} data-testid="backup-code"><KeyRound />{st.recovery ? t('datos.codeAgain') : t('datos.codeMake')}</Button>
        {bridge.pickFiles ? <Button size="sm" variant="ghost" onClick={pickFile}><FolderOpen />{t('datos.restoreFile')}</Button> : null}
      </CardFooter>
    </Card>
  );
}

function MoveCard() {
  const t = useT();
  const [moved, setMoved] = useState(undefined);
  const load = () => call('data.moveStatus').then((r) => setMoved(r.moved ?? null)).catch(() => setMoved(null));
  useEffect(() => { load(); }, []);
  if (moved === undefined) return null;
  const exportIt = async () => {
    if (!(await confirm(t('datos.moveTitle'), t('datos.moveBody'), { ok: t('datos.moveGo') }))) return;
    const r = await form(t('datos.moveTitle'), {
      description: t('datos.movePassDesc'),
      initial: { passphrase: '', again: '' },
      body: (v, set) => (<>
        <Field label={t('datos.movePass')} hint={t('datos.movePassHint')}><Input type="password" autoComplete="new-password" autoFocus value={v.passphrase} onChange={(e) => set({ passphrase: e.target.value })} /></Field>
        <Field label={t('datos.movePassAgain')}><Input type="password" autoComplete="new-password" value={v.again} onChange={(e) => set({ again: e.target.value })} /></Field>
      </>),
      ok: t('datos.moveGo'),
      onOk: (v) => { if (v.passphrase.length < 12) throw new Error(t('datos.movePassHint')); if (v.passphrase !== v.again) throw new Error(t('datos.movePassMismatch')); return call('data.moveExport', { passphrase: v.passphrase }); }
    });
    if (r) { toast.success(t('datos.moveDone', { file: r.file }), { duration: 12000 }); load(); }
  };
  return (
    <Card data-testid="move-card" className={moved ? 'border-warning/60' : undefined}>
      <CardHeader className="flex-row items-start gap-3"><Truck className="text-primary mt-0.5 size-5 shrink-0" /><div><CardTitle>{t('datos.moveCardTitle')}</CardTitle><CardDescription>{moved ? t('datos.movedAway') : t('datos.moveHint')}</CardDescription></div></CardHeader>
      <CardContent className="text-muted-foreground text-xs">{t('datos.moveImportNote')}</CardContent>
      <CardFooter className="flex-wrap">
        {moved ? <>
          <Button size="sm" variant="outline" onClick={async () => { if (await act(call('data.moveUndo'), t('datos.restart'))) load(); }}><Undo2 />{t('datos.moveUndo')}</Button>
          <Button size="sm" variant="ghost" onClick={async () => { if (await confirm(t('datos.keepBothTitle'), t('datos.keepBothBody'), { ok: t('datos.keepBoth') }) && await act(call('data.moveKeepBoth'), t('datos.restart'))) load(); }}>{t('datos.keepBoth')}</Button>
        </> : <Button size="sm" variant="outline" onClick={exportIt} data-testid="move-export"><Truck />{t('datos.moveGo')}</Button>}
      </CardFooter>
    </Card>
  );
}

export function DataCards() { return <><BackupsCard /><MoveCard /></>; }

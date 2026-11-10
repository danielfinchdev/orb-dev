// 3.6: Ajustes › Datos (the owner, on this PC): encrypted backups (every day at 03:00, or now), the recovery code that
// opens them on another PC, restoring one, and moving this Orb to another PC. src/engine/api-data.mjs does the work.
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { HardDriveDownload, KeyRound, RotateCcw, LoaderCircle, ShieldCheck, TriangleAlert, Copy, FolderOpen, Archive, Trash2, FolderLock } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Badge, Card, CardContent, CardHeader, CardTitle, CardFooter, Field, Input } from '@/components/ui/basic.jsx';
import { form, confirm } from '@/components/dialogs.jsx';
import { call, act, bridge, useStore, getState, setState, openSettings } from '@/lib/store.js';
import { notify } from '@/lib/notify.js';
import { unlockCore } from '@/lib/core-access.js';
import { MasterCard } from '@/views/master.jsx';
import { useT, useLocale, t as tNow } from '@/lib/i18n.js';
import { AUTHOR } from '../../shared/product.mjs';

// 3.8.2: the details of going back to the previous key (what stops working, recovery codes), in the README.
const KEY_DOCS = `https://github.com/${AUTHOR.repo}#going-back-to-the-previous-key`;
const size = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);

// The recovery code: made here and shown once, to write down (copies made from then on open with it on another PC).
// 3.8: after the master password (the code opens the backups and «He olvidado la contraseña»).
export async function newRecoveryCode() {
  const unlock = await unlockCore('recovery');
  if (!unlock) return null;
  const r = await act(call('backup.recovery', { unlock }));
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
    const unlock = await unlockCore('restore');
    if (!unlock) return;
    const r = await form(t('datos.restoreTitle'), {
      description: t('datos.restoreDesc', { when: when(b.created) }),
      initial: { passphrase: '' },
      body: (v, set) => <Field label={t('datos.restorePass')} hint={t('datos.restorePassHint')}><Input type="password" autoComplete="off" value={v.passphrase} onChange={(e) => set({ passphrase: e.target.value })} /></Field>,
      ok: t('datos.restore'),
      onOk: async (v) => { await call('backup.verify', { file: b.name, passphrase: v.passphrase || null, unlock }); return call('backup.restore', { file: b.name, passphrase: v.passphrase || null, unlock }); }
    });
    if (r) toast.success(t('datos.restoreReady'), { duration: 10000 });
  };
  // The way back after «Empezar con una clave nueva» ('anterior'), and back to the new key after that ('nueva').
  const way = st.previousKey === 'nueva' ? 'datos.newKey' : 'datos.previousKey';
  const previousKey = async () => {
    const body = <>{t(`${way}Body`)} <button type="button" className="text-primary cursor-pointer underline-offset-2 hover:underline" onClick={() => act(bridge.openExternal(KEY_DOCS))} data-testid="previous-key-more">{t('datos.moreInfo')}</button></>;
    if (!(await confirm(t(`${way}Title`), body, { ok: t(`${way}Use`) }))) return;
    const unlock = await unlockCore('previousKey');
    if (!unlock) return;
    if (await act(call('backup.previousKey', { unlock }))) toast.success(t(`${way}Ready`), { duration: 15000 });
  };
  // 3.8: where the copies go: outside Orb's folder by default; another folder (never inside core) or back to the default.
  const setFolder = async (folder) => { const unlock = await unlockCore('backupFolder'); if (!unlock) return; if (await act(call('config.save', { patch: { backup: { folder } }, unlock }), t('datos.folderChanged'))) load(); };
  const pickFolder = async () => { const f = await bridge.pickFolder?.(t('datos.pickFolder')); if (f) setFolder(f); };
  const pickFile = async () => {
    const files = await bridge.pickFiles?.(t('datos.pickFile'));
    const file = Array.isArray(files) ? files[0] : files;
    if (file) restore({ name: file, created: null });
  };
  return (
    <Card data-testid="backups-card">
      <CardHeader className="flex-row items-start gap-3"><HardDriveDownload className="text-primary mt-0.5 size-5 shrink-0" /><CardTitle className="mt-1">{t('datos.backupsTitle')}</CardTitle></CardHeader>
      <CardContent className="grid gap-3">
        <div className="text-muted-foreground grid gap-1 text-xs">
          <span>{t('datos.folder')}: <span className="text-foreground font-mono break-all" data-testid="backup-folder">{st.folder}</span></span>
          {!st.custom ? <span>{t('datos.folderOutside')}</span> : null}
          <span data-testid="backup-last">{st.last ? (st.last.ok ? t('datos.lastOk', { when: when(st.last.at) }) : t('datos.lastFailed', { when: when(st.last.at), error: st.last.error ?? '' })) : t('datos.none')}</span>
          {!st.recovery ? <span className="text-warning flex items-center gap-1"><TriangleAlert className="size-3.5" />{t('datos.noCode')}</span> : <span className="flex items-center gap-1"><ShieldCheck className="text-success size-3.5" />{t('datos.withCode')}</span>}
        </div>
        {/* 3.8.1 (Tauri): after «Empezar con una clave nueva», Windows opens the key from before again: the way back (and
            the way back to the new key after that). */}
        {st.previousKey ? (
          <div className="grid gap-2 rounded-lg border px-3 py-2.5 text-[13px]" data-testid="previous-key">
            <span>{t(way)}</span>
            <Button size="sm" variant="outline" className="w-fit" onClick={previousKey} data-testid="previous-key-use"><KeyRound />{t(`${way}Use`)}</Button>
          </div>
        ) : null}
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
        {bridge.pickFolder ? <Button size="sm" variant="ghost" onClick={pickFolder} data-testid="backup-folder-change"><FolderOpen />{t('datos.folderChange')}</Button> : null}
        {st.custom ? <Button size="sm" variant="ghost" onClick={() => setFolder('')}><RotateCcw />{t('datos.folderDefault')}</Button> : null}
      </CardFooter>
    </Card>
  );
}

// 3.8: what Orb 3.7 left after the migration (src/domain/data/legacy/migrate-38.mjs): its archives and the copies of its database, only
// while there are any, with «Borrar los datos de Orb 3.7». 3.8.1 (review F3b M5): they, and the backups made before 3.8,
// still hold 3.7's keys without the master password: the card says so.
function LegacyCard() {
  const t = useT();
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => call('legacy.status').then(setSt).catch(() => {});
  useEffect(() => { load(); }, []);
  const local = st ? st.archives.length + st.copies.length : 0;
  if (!st || !(local + (st.oldBackups ?? 0))) return null;
  const remove = async () => {
    if (!(await confirm(t('datos.legacyConfirmTitle'), t('datos.legacyConfirmDesc', { archives: st.archives.join(', ') || '—' }), { ok: t('datos.legacyDelete'), danger: true }))) return;
    const unlock = await unlockCore('legacy'); if (!unlock) return;
    setBusy(true); const r = await act(call('legacy.delete', { unlock }), t('datos.legacyDeleted')); setBusy(false); if (r) load();
  };
  return (
    <Card data-testid="legacy-card">
      <CardHeader className="flex-row items-start gap-3"><Archive className="text-primary mt-0.5 size-5 shrink-0" /><CardTitle className="mt-1">{t('datos.legacyTitle')}</CardTitle></CardHeader>
      <CardContent className="grid gap-1.5">
        {local > 0 && <p className="text-muted-foreground text-xs">{t('datos.legacyDesc', { size: size(st.bytes) })}</p>}
        {st.oldBackups > 0 && <p className="text-muted-foreground text-xs" data-testid="legacy-backups">{t('datos.legacyBackups', { n: st.oldBackups })}</p>}
        <p className="text-warning-ink text-xs" data-testid="legacy-keys">{t('datos.legacyKeys')}</p>
      </CardContent>
      {local > 0 && <CardFooter><Button size="sm" variant="destructive" onClick={remove} disabled={busy} data-testid="legacy-delete">{busy ? <LoaderCircle className="animate-spin" /> : <Trash2 />}{t('datos.legacyDelete')}</Button></CardFooter>}
    </Card>
  );
}

// 3.8: core, Orb's own folder (hidden): what it holds and «Abrir core» (after the master password: unlockCore; the main
// process checks the token with the engine before opening it).
function CoreCard() {
  const t = useT();
  const dir = useStore((s) => s.app?.paths?.core);
  if (!dir || !bridge.openPath) return null;
  const open = async () => { const unlock = await unlockCore('open'); if (unlock) act(bridge.openPath(dir, unlock)); };
  return (
    <Card data-testid="core-card">
      <CardHeader className="flex-row items-start gap-3"><FolderLock className="text-primary mt-0.5 size-5 shrink-0" /><CardTitle className="mt-1">{t('datos.coreTitle')}</CardTitle></CardHeader>
      <CardContent className="grid gap-1 text-xs"><p className="text-muted-foreground">{t('datos.coreDesc')}</p><span className="font-mono break-all">{dir}</span></CardContent>
      <CardFooter><Button size="sm" variant="outline" onClick={open} data-testid="core-open"><FolderOpen />{t('datos.coreOpen')}</Button></CardFooter>
    </Card>
  );
}

export function DataCards() { return <><MasterCard /><BackupsCard /><CoreCard /><LegacyCard /></>; }

// 3.6: backups are on from the first day, sealed with this PC's key. A few days later, once, a quiet suggestion to make
// the recovery code (Ajustes › Datos), so a copy also opens on another PC. Never on a phone.
export const RECOVERY_AFTER_MS = 3 * 86_400_000;
const firstSeen = () => {
  try { const v = Number(localStorage.getItem('orb.firstSeen')); if (v > 0) return v; localStorage.setItem('orb.firstSeen', String(Date.now())); } catch { /* storage unavailable */ }
  return Date.now();
};
export function RecoveryNotice() {
  const done = useStore((s) => s.app?.config?.ui?.recoveryNoticed === true);
  useEffect(() => {
    if (bridge.mobile || done) return undefined;
    if (Date.now() - firstSeen() < RECOVERY_AFTER_MS) return undefined;
    const id = setTimeout(async () => {
      const st = await call('backup.status').catch(() => null);
      if (!st) return;
      const config = await call('config.save', { patch: { ui: { recoveryNoticed: true } } }).catch(() => null);
      if (config) setState({ app: { ...getState().app, config } });
      if (st.recovery) return;
      notify({ title: tNow('datos.codeNoticeTitle'), body: tNow('datos.codeNoticeBody'), tone: 'info', action: { label: tNow('datos.codeNoticeOpen'), onClick: () => openSettings('datos') } }, { ms: 15000 });
    }, 20_000);
    return () => clearTimeout(id);
  }, [done]);
  return null;
}

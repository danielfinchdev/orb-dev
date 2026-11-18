// Ajustes › Datos (the owner, on this PC): encrypted backups (every day at 03:00, or now), the recovery code that
// opens them on another PC, restoring one, and moving this Orb to another PC. src/engine/api/data.mjs does the work.
import { useEffect, useState } from 'react';
import { KeyRound, LoaderCircle, Copy, FolderOpen, Archive, Trash2, Upload, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Badge, Field, Input } from '@/components/ui/basic.jsx';
import { ListRow } from '@/components/ui/primitives.jsx';
import { form, confirm } from '@/components/dialogs.jsx';
import { call, act, bridge, useStore, getState, setState, openSettings } from '@/lib/store.js';
import { notify, notifyOk } from '@/lib/notify.js';
import { unlockCore } from '@/lib/core-access.js';
import { MasterCard } from '@/views/master.jsx';
import { TrashCard } from './settings/trash.jsx';
import { WorktreesCard } from './settings/worktrees.jsx';
import { Block, Panel, Setting, MoreOptions } from './settings/rows.jsx';
import { useT, useLocale, t as tNow } from '@/lib/i18n.js';
import { AUTHOR } from '../../shared/product.mjs';
import { quiet } from '@/lib/quiet.js';

// the details of going back to the previous key (what stops working, recovery codes), in the README.
const KEY_DOCS = `https://github.com/${AUTHOR.repo}#going-back-to-the-previous-key`;
const size = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);

// The recovery code: made here and shown once, to write down (copies made from then on open with it on another PC).
// after the master password (the code opens the backups and «He olvidado la contraseña»).
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
        {navigator.clipboard ? <Button type="button" size="sm" variant="ghost" className="w-fit" onClick={() => navigator.clipboard.writeText(r.code).then(() => notifyOk(tNow('datos.copied'))).catch(quiet)}><Copy />{tNow('datos.copy')}</Button> : null}
      </div>
    ),
    ok: tNow('datos.codeKept')
  });
  return r;
}

// The way back to the previous key (and back to the new one), after «Empezar con una clave nueva»; own call, so it shows even when the backups' status fails.
function KeyCard() {
  const t = useT();
  const [st, setSt] = useState(null);
  useEffect(() => { call('backup.status').then(setSt).catch(quiet); }, []);
  if (!st?.previousKey) return null;
  // The way back after «Empezar con una clave nueva» ('anterior'), and back to the new key after that ('nueva').
  const way = st.previousKey === 'nueva' ? 'datos.newKey' : 'datos.previousKey';
  const previousKey = async () => {
    const body = <>{t(`${way}Body`)} <button type="button" className="text-primary-text cursor-pointer underline-offset-2 hover:underline" onClick={() => act(bridge.openExternal(KEY_DOCS))} data-testid="previous-key-more">{t('datos.moreInfo')}</button></>;
    if (!(await confirm(t(`${way}Title`), body, { ok: t(`${way}Use`), danger: true }))) return;
    const unlock = await unlockCore('previousKey');
    if (!unlock) return;
    if (await act(call('backup.previousKey', { unlock }))) notifyOk(t(`${way}Ready`), { ms: 15000 });
  };
  return (
    <>
      {/* after «Empezar con una clave nueva», Windows opens the key from before again: the way back (and
          the way back to the new key after that). */}
        <Block title={t('datos.keyTitle')} note={t('datos.keyDesc')}>
          <Panel>
            <Setting label={t(`${way}Name`)} hint={t(way)} data-testid="previous-key">
              <Button size="sm" variant="outline" onClick={previousKey} data-testid="previous-key-use"><Undo2 />{t(`${way}Use`)}</Button>
            </Setting>
          </Panel>
        </Block>
    </>
  );
}


function BackupsCard() {
  const t = useT();
  const locale = useLocale();
  const [st, setSt] = useState(null);
  const [list, setList] = useState([]);
  const [busy, setBusy] = useState(false);
  const load = () => Promise.all([call('backup.status').then(setSt), call('backup.list').then(setList)]).catch(quiet);
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
    if (r) notifyOk(t('datos.restoreReady'), { ms: 10000 });
  };
  // where the copies go: outside Orb's folder by default; another folder (never inside core) or back to the default.
  const setFolder = async (folder) => { const unlock = await unlockCore('backupFolder'); if (!unlock) return; if (await act(call('config.save', { patch: { backup: { folder } }, unlock }), t('datos.folderChanged'))) load(); };
  const pickFolder = async () => { const f = await bridge.pickFolder?.(t('datos.pickFolder')); if (f) setFolder(f); };
  const pickFile = async () => {
    const files = await bridge.pickFiles?.(t('datos.pickFile'));
    const file = Array.isArray(files) ? files[0] : files;
    if (file) restore({ name: file, created: null });
  };
  const lastLine = st.last ? (st.last.ok ? t('datos.lastOk', { when: when(st.last.at) }) : t('datos.lastFailed', { when: when(st.last.at), error: st.last.error ?? '' })) : t('datos.none');
  return (
    <>
      <Block title={t('datos.backupsTitle')} note={<><span data-testid="backup-last">{lastLine}</span>{!st.custom ? ` ${t('datos.folderOutside')}` : ''}</>} data-testid="backups-card">
        <Panel>
          <Setting label={<span className="break-all" data-testid="backup-folder">{st.folder}</span>} hint={<Badge variant="info">{t('datos.folder')}</Badge>}>
            {st.custom ? <Button size="sm" variant="outline" onClick={() => setFolder('')}>{t('datos.folderDefault')}</Button> : null}
            {bridge.pickFolder ? <Button size="sm" variant="outline" onClick={pickFolder} data-testid="backup-folder-change">{t('datos.folderChange')}</Button> : null}
          </Setting>
          <Setting label={t('datos.codeLabel')} hint={!st.recovery ? <span className="text-warning-ink">{t('datos.noCode')}</span> : t('datos.withCode')}>
            <Button size="sm" variant="outline" onClick={async () => { if (await newRecoveryCode()) load(); }} data-testid="backup-code"><KeyRound />{st.recovery ? t('datos.codeAgain') : t('datos.codeMake')}</Button>
          </Setting>
          {list.length ? (
            <div className="border-border border-t" data-testid="backup-list">
              {list.slice(0, 8).map((b) => (
                <ListRow key={b.name} className="border-border rounded-none not-first:border-t" title={when(b.created)}
                  meta={`${t(`datos.kind.${['daily', 'manual', 'preupdate', 'premigration', 'move'].includes(b.kind) ? b.kind : 'other'}`)} · ${b.damaged ? '—' : size(b.size)}`}
                  trailing={(
                    <div className="flex items-center gap-1.5">
                      {b.damaged ? <Badge variant="destructive">{t('datos.damaged')}</Badge> : null}
                      <Button size="xs" variant="outline" disabled={b.damaged} onClick={() => restore(b)}>{t('datos.restore')}</Button>
                    </div>
                  )} />
              ))}
            </div>
          ) : null}
        </Panel>
      </Block>
      <div className="flex flex-wrap justify-end gap-2">
        {bridge.pickFiles ? <Button size="sm" variant="outline" onClick={pickFile}><Upload />{t('datos.restoreFile')}</Button> : null}
        <Button size="sm" onClick={now} disabled={busy || st.running} data-testid="backup-now">{busy || st.running ? <LoaderCircle className="animate-spin" /> : <Archive />}{t('datos.now')}</Button>
      </div>
    </>
  );
}

// what Orb 3.7 left after the migration (src/domain/data/legacy/migrate-38.mjs): its archives and the copies of its database, only
// while there are any, with «Borrar los datos de Orb 3.7». they, and the backups made before 3.8,
// still hold 3.7's keys without the master password: the card says so.
function LegacyCard() {
  const t = useT();
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => call('legacy.status').then(setSt).catch(quiet);
  useEffect(() => { load(); }, []);
  const local = st ? st.archives.length + st.copies.length : 0;
  if (!st || !(local + (st.oldBackups ?? 0))) return null;
  const remove = async () => {
    if (!(await confirm(t('datos.legacyConfirmTitle'), t('datos.legacyConfirmDesc', { archives: st.archives.join(', ') || '—' }), { ok: t('datos.legacyDelete'), danger: true }))) return;
    const unlock = await unlockCore('legacy'); if (!unlock) return;
    setBusy(true); const r = await act(call('legacy.delete', { unlock }), t('datos.legacyDeleted')); setBusy(false); if (r) load();
  };
  return (
    <Block title={t('datos.legacyTitle')} note={local > 0 ? t('datos.legacyDesc', { size: size(st.bytes) }) : null} data-testid="legacy-card">
      <Panel>
        <Setting label={st.oldBackups > 0 ? <span data-testid="legacy-backups">{t('datos.legacyBackups', { n: st.oldBackups })}</span> : t('datos.legacyTitle')} hint={<span className="text-warning-ink" data-testid="legacy-keys">{t('datos.legacyKeys')}</span>}>
          {local > 0 && <Button size="sm" variant="danger" onClick={remove} disabled={busy} data-testid="legacy-delete">{busy ? <LoaderCircle className="animate-spin" /> : <Trash2 />}{t('datos.legacyDelete')}</Button>}
        </Setting>
      </Panel>
    </Block>
  );
}

// core, Orb's own folder (hidden): what it holds and «Abrir core» (after the master password: unlockCore; the main
// process checks the token with the engine before opening it).
function CoreCard() {
  const t = useT();
  const dir = useStore((s) => s.app?.paths?.core);
  if (!dir || !bridge.openPath) return null;
  const open = async () => { const unlock = await unlockCore('open'); if (unlock) act(bridge.openPath(dir, unlock)); };
  return (
    <Block title={t('datos.coreTitle')} note={t('datos.coreDesc')} data-testid="core-card">
      <Panel>
        <Setting label={<span className="break-all">{dir}</span>} hint={t('datos.coreHint')}>
          <Button size="sm" variant="outline" onClick={open} data-testid="core-open"><FolderOpen />{t('datos.coreOpen')}</Button>
        </Setting>
      </Panel>
    </Block>
  );
}

export function DataCards() { return <><MasterCard /><KeyCard /><LegacyCard /><BackupsCard /><CoreCard /><MoreOptions testid="more-options-datos"><TrashCard /><WorktreesCard /></MoreOptions></>; }

// backups are on from the first day, sealed with this PC's key. A few days later, once, a quiet suggestion to make
// the recovery code (Ajustes › Datos), so a copy also opens on another PC. Never on a phone.
const RECOVERY_AFTER_MS = 3 * 86_400_000;
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

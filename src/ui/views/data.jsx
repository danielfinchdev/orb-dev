// Ajustes › Datos (the owner, on this PC): encrypted backups (every day at 03:00, or now), the recovery code that
// opens them on another PC, restoring one, and moving this Orb to another PC. src/engine/api/data.mjs does the work.
import { useEffect, useState } from 'react';
import { KeyRound, LoaderCircle, FolderOpen, Archive, Trash2, Upload, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Badge, Field, Input } from '@/components/ui/basic.jsx';
import { ListRow } from '@/components/ui/primitives.jsx';
import { form, confirm } from '@/components/dialogs.jsx';
import { call, act, bridge, useStore, getState, setState, openSettings } from '@/lib/store.js';
import { notify, notifyOk } from '@/lib/notify.js';
import { unlockCore } from '@/lib/core-access.js';
import { newRecoveryCode } from '@/views/recovery.jsx';
import { askNewSecret } from '@/components/new-secret.jsx';
import { TrashCard } from './settings/trash.jsx';
import { WorktreesCard } from './settings/worktrees.jsx';
import { Block, Panel, Setting } from './settings/rows.jsx';
import { useT, useLocale, t as tNow } from '@/lib/i18n.js';
import { AUTHOR } from '../../shared/product.mjs';
import { quiet } from '@/lib/quiet.js';

// the details of going back to the previous key (what stops working, recovery codes), in the README.
const KEY_DOCS = `https://github.com/${AUTHOR.repo}#going-back-to-the-previous-key`;
const size = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);

// This PC's key (on the PC only): the way back to the previous key (and back to the new one) when there is one, and
// «Empezar con una clave nueva», asked with the master password every time. Own call, so it shows even when the backups' status fails.
function KeyCard() {
  const t = useT();
  const [st, setSt] = useState(null);
  const [failed, setFailed] = useState(false);
  const [master, setMaster] = useState(null);
  const load = () => Promise.all([call('backup.status').then(setSt), call('master.state').then((m) => setMaster(m?.exists === true))]).then(() => setFailed(false)).catch((e) => { setFailed(true); quiet(e); });
  useEffect(() => { if (!bridge.mobile) load(); }, []);
  if (bridge.mobile) return null;
  // The way back after «Empezar con una clave nueva» ('anterior'), and back to the new key after that ('nueva').
  const way = st?.previousKey === 'nueva' ? 'datos.newKey' : 'datos.previousKey';
  // an action already asked waits for the next start: nothing else is offered until Orb is opened again
  const pending = Boolean(st?.pendingKey);
  const previousKey = async () => {
    const body = <>{t(`${way}Body`)} <button type="button" className="text-primary-text cursor-pointer underline-offset-2 hover:underline" onClick={() => act(bridge.openExternal(KEY_DOCS))} data-testid="previous-key-more">{t('datos.moreInfo')}</button></>;
    if (!(await confirm(t(`${way}Title`), body, { ok: t(`${way}Use`), danger: true }))) return;
    const unlock = await unlockCore('previousKey');
    if (!unlock) return;
    if (await act(call('backup.previousKey', { unlock }))) notifyOk(t(`${way}Ready`), { ms: 15000 });
    load();
  };
  // The key opens fine here: the dialog is the start-up one (the word EMPEZAR), then the password, then the signal for the next start.
  const startNew = async () => {
    if (!(await askNewSecret({ master: true, recovery: st?.recovery === true }, { readable: true, typed: true }))) return;
    const unlock = await unlockCore('newKey');
    if (!unlock) return;
    if (await act(call('backup.newKey', { unlock }))) notifyOk(t('datos.startKeyReady'), { ms: 15000 });
    load();
  };
  const cancel = async () => { await act(call('backup.cancelKey')); load(); };
  // without a master password (or without knowing the state) the red button is not offered, and says why
  const hint = failed || !st ? t('datos.startKeyNoStatus') : master === false ? t('datos.startKeyNoMaster') : t('datos.startKeyHint');
  const can = Boolean(st) && !failed && master === true && !pending;
  return (
    <Block title={t('datos.keyTitle')} note={t('datos.keyDesc')} data-testid="key-card">
      <Panel>
        {/* after «Empezar con una clave nueva», Windows opens the key from before again: the way back (and
            the way back to the new key after that). */}
        {st?.previousKey ? (
          <Setting label={t(`${way}Name`)} hint={t(way)} data-testid="previous-key">
            <Button size="sm" variant="outline" onClick={previousKey} disabled={pending} data-testid="previous-key-use"><Undo2 />{t(`${way}Use`)}</Button>
          </Setting>
        ) : null}
        <Setting label={t('datos.startKeyName')} hint={pending ? <span data-testid="key-pending">{t('datos.keyPending')} <button type="button" className="text-primary-text cursor-pointer underline-offset-2 hover:underline" onClick={cancel} data-testid="key-cancel">{t('datos.keyCancel')}</button></span> : hint} data-testid="new-key">
          <Button size="sm" variant="danger" onClick={startNew} disabled={!can} data-testid="new-key-start">{t('datos.startKeyName')}</Button>
        </Setting>
      </Panel>
    </Block>
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
    const r = await form(t('datos.restoreTitle'), {
      description: t('datos.restoreDesc', { when: when(b.created) }),
      initial: { passphrase: '', password: '' },
      body: (v, set) => (<>
        <Field label={t('datos.restorePass')} hint={t('datos.restorePassHint')}><Input type="password" autoComplete="off" value={v.passphrase} onChange={(e) => set({ passphrase: e.target.value })} data-testid="restore-code" /></Field>
        <Field label={t('datos.restoreMaster')} hint={t('datos.restoreMasterHint')}><Input type="password" autoComplete="current-password" value={v.password} onChange={(e) => set({ password: e.target.value })} data-testid="restore-password" /></Field>
      </>),
      ok: t('datos.restore'),
      // The password or the phone's approval comes after the form: the phone approves exactly this restore.
      onOk: async (v) => {
        const params = { file: b.name, passphrase: v.passphrase || null, password: v.password || undefined };
        const info = {};
        const unlock = await unlockCore('restore', { request: { method: 'backup.restore', params }, info });
        if (!unlock) return false;
        // A phone's token is for the restore alone, so the check beforehand (a password's token) is skipped; the restore checks the copy too.
        if (!info.mobile) await call('backup.verify', { file: b.name, passphrase: v.passphrase || null, unlock });
        return call('backup.restore', { ...params, unlock });
      }
    });
    if (r) notifyOk(`${t(r.secretsKept ? 'datos.restoreKept' : 'datos.restoreReady')}${r.turnedOff ? ` ${t('datos.restoreHelloOff')}` : ''}`, { ms: 10000 });
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

// The master password is in Permisos y seguridad; here, the copies, the key of this PC and what Orb keeps of its own.
export function DataCards() { return <><BackupsCard /><KeyCard /><LegacyCard /><TrashCard /><WorktreesCard /><CoreCard /></>; }

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

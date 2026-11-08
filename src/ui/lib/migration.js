// 3.8: what the screen «No se pudieron actualizar tus datos a Orb 3.8» shows (main.jsx › MigrationFailed), kept apart so
// it can be tested without a window. state: app.migrationState; update: the app's updater (src-tauri/src/updater.rs) or null.

// The folder that holds a file (the copy of the database, or the database itself), for «Abrir carpeta».
export const folderOf = (file) => (typeof file === 'string' && /[\\/]/.test(file) ? file.replace(/[\\/][^\\/]*$/, '') : null);

// → { body, folder, update } where update is null (no updater: an Orb run from its code) or
// { action: 'check' | 'update' | 'restart' | null, busy, percent, none, version, portable, error }.
export function migrationView(state, update) {
  const s = state ?? {};
  const body = s.committed ? 'data.migration38.bodyCommitted' : 'data.migration38.body';
  const folder = folderOf(s.backup ?? s.data);
  if (!update || update.state === 'off') return { body, folder, update: null };
  const st = update.state;
  const action = st === 'available' ? 'update' : st === 'downloaded' ? 'restart' : st === 'downloading' ? null : 'check';
  return {
    body, folder,
    update: { action, busy: st === 'checking' || st === 'downloading', percent: st === 'downloading' ? update.percent ?? 0 : null, none: st === 'none', version: update.version ?? null, portable: Boolean(update.portable), error: update.error ?? null }
  };
}

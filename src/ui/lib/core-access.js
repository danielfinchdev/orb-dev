// 3.8: Orb's core folder seen from the window.
//   unlockCore: every action of the window that touches core (opening it, restoring a backup over it, choosing where its
//     backups go) asks here first. Today it always lets them through; the master password (3.8, next step) is asked here,
//     so that is the only place to change.
//   coreView: what the screen «Falta la carpeta core» shows (views/core-missing.jsx), kept apart so it can be tested
//     without a window. state: app.coreState ({ missing, home, reason, backup, error, folder }).

// action: 'open' | 'restore' | 'backupFolder'. → true when the action may go on.
export async function unlockCore(action) {
  void action; // which one: the master password will say it
  return true;
}

// → { body, vars, passphrase, restore, folder }: the text (key and values), whether the recovery code is asked, whether
// «Restaurar» is offered (a copy that this PC could not open with its own key) and the backups' folder for «Abrir».
export function coreView(state, { when = (iso) => iso ?? '—' } = {}) {
  const s = state ?? {};
  const created = when(s.backup?.created ?? null);
  if (s.reason === 'needsPassphrase') return { body: 'data.core.needsPassphrase', vars: { created }, passphrase: true, restore: true, folder: s.folder ?? null };
  if (s.reason === 'damaged') return { body: 'data.core.damaged', vars: { created }, passphrase: false, restore: false, folder: s.folder ?? null };
  return { body: 'data.core.noBackup', vars: { home: s.home ?? '' }, passphrase: false, restore: false, folder: s.folder ?? null };
}

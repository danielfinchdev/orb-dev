// Sample data for the start-up notices' preview (main.jsx › StartPreview), the one the e2e tour uses to picture cards
// that cannot be provoked. Data only, taken from the mock-up 15-arranque: no calls to the engine or to the network.
const BACKUP = { created: '2026-11-03T22:14:00' };
const CORE_ERROR = 'No se puede abrir core\\orb.json: el archivo no existe.';
const CORE = { missing: true, home: 'C:\\Orb', folder: 'C:\\Orb\\copias', error: CORE_ERROR };
const KEY_MESSAGE = 'Windows no puede abrir la clave que protege los datos de Orb en este PC.';
const MIGRATION = {
  failed: true, committed: false, backup: 'C:\\Orb\\copia-orb-3.7', data: 'C:\\Orb\\core\\datos',
  reason: 'No hay espacio suficiente en el disco para actualizar los datos de Orb: hacen falta 480 MB y quedan 120 MB. Libera espacio y reintenta. No se ha cambiado nada.'
};

// name → { card, ...props of that card }. The names are the only thing the page's variable can choose among.
export const PREVIEW = Object.freeze({
  core: { card: 'core', state: { ...CORE, reason: 'needsPassphrase', backup: BACKUP } },
  'core-sin': { card: 'core', state: { ...CORE, reason: 'noBackup' } },
  'core-danada': { card: 'core', state: { ...CORE, reason: 'damaged', backup: BACKUP } },
  // the small dialog «Seguir sin copia» open over the card without a copy
  'core-confirma': { card: 'core', state: { ...CORE, reason: 'noBackup' }, confirm: true },
  migra: { card: 'migration', state: MIGRATION, update: { state: 'none-yet' } },
  'migra-act': { card: 'migration', state: MIGRATION, update: { state: 'downloading', percent: 42, version: '3.8.5' } },
  error: { card: 'error', error: KEY_MESSAGE, startError: { code: 'secretUnreadable', message: KEY_MESSAGE, master: true, recovery: false } },
  clave: { card: 'error', error: KEY_MESSAGE, startError: { code: 'secretUnreadable', message: KEY_MESSAGE, master: true, recovery: false }, dialog: true },
  falla: { card: 'crash' },
  'falla-red': { card: 'offline' },
  actualiza: { card: 'update', info: { needsUpdate: { app: true } } }
});

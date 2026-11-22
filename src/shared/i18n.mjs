// Translations: the app speaks Spanish (Spain) and English. One shared module for the interface (React) and the
// engine (chat notices, errors the user reads). Keys are short dotted names; a missing key falls back to Spanish, and a
// missing Spanish text falls back to the key itself (so a forgotten key is visible, never a crash).
//   t('nav.tasks')                         → 'Tareas' / 'Tasks'
//   t('tasks.waiting', { n: 3 })           → placeholders {n} replaced
// Both languages are loaded here (the engine needs them synchronously); the main window uses i18n-core.mjs instead.
import es from './locales/es.mjs';
import en from './locales/en.mjs';
import { registerLocale } from './i18n-core.mjs';

registerLocale('es', es);
registerLocale('en', en);
export { LANGUAGES, translate, createT, localeOf } from './i18n-core.mjs';

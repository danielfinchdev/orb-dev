// Translations (2.3): the app speaks Spanish (Spain) and English. One shared module for the interface (React) and the
// engine (chat notices, errors the user reads). Keys are short dotted names; a missing key falls back to Spanish, and a
// missing Spanish text falls back to the key itself (so a forgotten key is visible, never a crash).
//   t('nav.tasks')                         → 'Tareas' / 'Tasks'
//   t('tasks.waiting', { n: 3 })           → placeholders {n} replaced
import es from './locales/es.mjs';
import en from './locales/en.mjs';

export const LANGUAGES = { es: 'Español (España)', en: 'English' };
const DICTS = { es, en };

export function translate(lang, key, vars) {
  const text = DICTS[lang]?.[key] ?? DICTS.es[key] ?? key;
  return vars ? text.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m)) : text;
}
export const createT = (lang) => (key, vars) => translate(DICTS[lang] ? lang : 'es', key, vars);
// Locale for dates and numbers.
export const localeOf = (lang) => (lang === 'en' ? 'en-GB' : 'es-ES');

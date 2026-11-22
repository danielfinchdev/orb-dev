// The translation lookup without any dictionary in it: the engine gets both languages from i18n.mjs, the window
// registers Spanish at once and English only when someone asks for it (ui/lib/i18n.js), so a Spanish session never
// loads or parses the English texts.
export const LANGUAGES = { es: 'Español (España)', en: 'English' };
const DICTS = {};
// One function per language (stable across renders: components can depend on it); a new dictionary renews it.
let T_CACHE = {};

export function registerLocale(lang, dict) {
  DICTS[lang] = dict;
  T_CACHE = {};
}
export const hasLocale = (lang) => Boolean(DICTS[lang]);

export function translate(lang, key, vars) {
  const text = DICTS[lang]?.[key] ?? DICTS.es?.[key] ?? key;
  return vars ? text.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m)) : text;
}
export const createT = (lang) => {
  const use = DICTS[lang] ? lang : 'es';
  return (T_CACHE[use] ??= (key, vars) => translate(use, key, vars));
};
// Locale for dates and numbers.
export const localeOf = (lang) => (lang === 'en' ? 'en-GB' : 'es-ES');

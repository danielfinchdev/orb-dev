// The interface's translations: useT() gives t(key, vars) in the language chosen in Ajustes (config.language).
// Spanish is in the main bundle; English arrives on demand (its own chunk), and everything that uses t() redraws then.
import { useSyncExternalStore } from 'react';
import { useStore, getState, uiLanguage } from './state.js';
import { createT, localeOf, registerLocale, hasLocale } from '../../shared/i18n-core.mjs';
import es from '../../shared/locales/es.mjs';

registerLocale('es', es);

const LOADERS = { en: () => import('../../shared/locales/en.mjs') };
const loading = new Map();
const listeners = new Set();
let version = 0;
const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const snapshot = () => version;

// Starts loading a language's texts once; until they arrive the Spanish ones are shown.
function ensure(lang) {
  if (hasLocale(lang) || loading.has(lang) || !LOADERS[lang]) return;
  loading.set(lang, LOADERS[lang]().then((m) => {
    registerLocale(lang, m.default);
    version++;
    for (const fn of [...listeners]) fn();
  }, () => loading.delete(lang)));
}

// The last language is remembered so that a start in English waits (briefly) for its texts before the window is shown,
// instead of painting Spanish first and switching.
const SAVED_KEY = 'orb.language';
const ENGLISH_WAIT_MS = 300;
export function rememberLanguage(lang) { try { localStorage.setItem(SAVED_KEY, lang); } catch { /* storage unavailable */ } }
export const languageReady = (() => {
  let saved = null; try { saved = localStorage.getItem(SAVED_KEY); } catch { /* none */ }
  if (saved !== 'en' || !LOADERS.en) return Promise.resolve();
  ensure('en');
  return Promise.race([loading.get('en'), new Promise((r) => setTimeout(r, ENGLISH_WAIT_MS))]);
})();

export function useT() {
  const lang = useStore(uiLanguage);
  ensure(lang);
  useSyncExternalStore(subscribe, snapshot);
  return createT(lang);
}
// Outside components (dialogs, toasts): the current language at call time.
export const t = (key, vars) => { const lang = uiLanguage(getState()); ensure(lang); return createT(lang)(key, vars); };
export const useLocale = () => localeOf(useStore(uiLanguage));
// Outside components: the locale for dates and numbers at call time.
export const currentLocale = () => localeOf(uiLanguage(getState()));

// The interface's translations: useT() gives t(key, vars) in the language chosen in Ajustes (config.language).
import { useStore, getState, uiLanguage } from './state.js';
import { createT, localeOf } from '../../shared/i18n.mjs';

export function useT() { const lang = useStore(uiLanguage); return createT(lang); }
// Outside components (dialogs, toasts): the current language at call time.
export const t = (key, vars) => createT(uiLanguage(getState()))(key, vars);
export const useLocale = () => localeOf(useStore(uiLanguage));
// Outside components: the locale for dates and numbers at call time.
export const currentLocale = () => localeOf(uiLanguage(getState()));

// The interface's translations: useT() gives t(key, vars) in the language chosen in Ajustes (config.language).
import { useStore, getState } from './store.js';
import { createT, localeOf } from '../../core/i18n.mjs';

export function useT() { const lang = useStore((s) => s.app?.config?.language ?? 'es'); return createT(lang); }
// Outside components (dialogs, toasts): the current language at call time.
export const t = (key, vars) => createT(getState().app?.config?.language ?? 'es')(key, vars);
export const useLocale = () => localeOf(useStore((s) => s.app?.config?.language ?? 'es'));
// Outside components: the locale for dates and numbers at call time.
export const currentLocale = () => localeOf(getState().app?.config?.language ?? 'es');

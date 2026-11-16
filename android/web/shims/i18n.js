// Stand-in for the desktop app's i18n: only the games.* texts, in Spanish.
import dict from 'virtual:games-es';

export const t = (key, vars) => {
  const text = dict[key] ?? key;
  return vars ? text.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m)) : text;
};
export const useT = () => t;

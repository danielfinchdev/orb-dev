// Day / night switch. Saved in the assistant's settings (ui.theme): "claro", "oscuro" or "sistema".
import { Moon, Sun } from 'lucide-react';
import { Button } from './ui/button.jsx';
import { Tip } from './ui/overlay.jsx';
import { call, applyTheme, isDark, act, setState, getState, bridge } from '@/lib/store.js';
import { useT } from '@/lib/i18n.js';

export function ThemeToggle({ className }) {
  const t = useT();
  const toggle = async () => {
    const next = isDark() ? 'claro' : 'oscuro';
    applyTheme(next);
    if (bridge.mobile) { try { localStorage.setItem('orb.theme', next); } catch { /* storage unavailable */ } return; } // a phone keeps its own choice
    const config = await act(call('config.save', { patch: { ui: { theme: next } } }));
    if (config) setState({ app: { ...getState().app, config } });
  };
  return (
    <Tip label={t('comp.theme.tip')}>
      <Button variant="ghost" size="icon-sm" className={className} onClick={toggle} aria-label={t('comp.theme.aria')}>
        <Sun className="size-4 dark:hidden" /><Moon className="hidden size-4 dark:block" />
      </Button>
    </Tip>
  );
}

// Day / night switch. Saved in the assistant's settings (ui.theme): "claro", "oscuro" or "sistema".
import { Moon, Sun, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Button } from './ui/button.jsx';
import { Tip } from './ui/overlay.jsx';
import { call, applyTheme, isDark, act, setState, getState, bridge, setSidebarCollapsed } from '@/lib/store.js';
import { cn } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';

// 2.6: fold the sidebar away / bring it back (wide windows; narrow ones already have it as a drawer).
export function SidebarToggle({ className, collapsed = false }) {
  const t = useT();
  const label = collapsed ? t('comp.sidebar.expand') : t('comp.sidebar.collapse');
  return (
    <Tip label={label}>
      <Button variant="ghost" size="icon-sm" className={cn('hidden md:inline-flex', className)} onClick={() => setSidebarCollapsed(!collapsed)} aria-label={label} data-testid={collapsed ? 'sidebar-expand' : 'sidebar-collapse'}>
        {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
      </Button>
    </Tip>
  );
}

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

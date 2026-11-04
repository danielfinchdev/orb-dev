// 3.5: «Orb | Bots» at the top of the menu (on the phone, at the top of the screen): Orb is the app as always; Bots, the
// user's own bots with their own menu. The mode is remembered. The marker under the chosen mode slides to the other one
// (200 ms, ease-out: it says where you went), and stays put with reduced motion.
import { Sparkles, Bot } from 'lucide-react';
import { useStore, setMode, modeOf } from '@/lib/store.js';
import { cn } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';

export function ModeSwitch({ className }) {
  const t = useT();
  const mode = useStore((s) => modeOf(s.route));
  const item = (id, Icon, label) => (
    <button type="button" role="tab" aria-selected={mode === id} onClick={() => setMode(id)} data-testid={`mode-${id}`}
      className={cn('press relative z-10 flex min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium transition-[color,transform] duration-150 ease-(--ease-out)', mode === id ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}>
      <Icon className={cn('size-3.5 shrink-0', mode === id && 'text-primary')} /><span className="truncate">{label}</span>
    </button>
  );
  return (
    <div role="tablist" aria-label={t('nav.mode')} className={cn('bg-muted relative flex items-center gap-0.5 rounded-lg p-[3px]', className)} data-testid="mode-switch" data-mode={mode}>
      <span aria-hidden className="mode-thumb bg-background absolute inset-y-[3px] left-[3px] w-[calc(50%-4px)] rounded-md shadow-xs transition-transform duration-200 ease-(--ease-out)" style={{ transform: mode === 'bots' ? 'translateX(calc(100% + 2px))' : 'translateX(0)' }} />
      {item('orb', Sparkles, t('nav.modeOrb'))}
      {item('bots', Bot, t('nav.modeBots'))}
    </div>
  );
}

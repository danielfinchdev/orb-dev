// A linked browser has no Ajustes of the PC: its gear (the same slot and icon as on the PC) opens a small menu with
// what it does have, this device's settings.
import { MonitorSmartphone, Settings } from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, BubbleTip } from '@/components/ui/overlay.jsx';
import { go } from '@/lib/store.js';
import { cn } from '@/lib/utils.js';
import { t, useT } from '@/lib/i18n.js';

// list: the sidebar's footer unfolded (a row with the name) instead of the icon.
export function BrowserSettingsMenu({ list = false, active = false }) {
  useT();
  const label = t('nav.settings');
  return (
    <DropdownMenu>
      {list ? (
        <DropdownMenuTrigger asChild>
          <button type="button" className={cn('group flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[14px]', active ? 'bg-accent text-accent-foreground' : 'text-foreground/80 hover:bg-accent/60 hover:text-foreground')} data-testid="nav-settings">
            <Settings className={cn('size-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground')} /><span className="min-w-0 flex-1 truncate">{label}</span>
          </button>
        </DropdownMenuTrigger>
      ) : (
        <BubbleTip title={label} side="top">
          <DropdownMenuTrigger asChild>
            <button type="button" className={cn('side-foot-icon', active && 'is-active')} aria-label={label} data-testid="nav-settings"><Settings className="size-4" /></button>
          </DropdownMenuTrigger>
        </BubbleTip>
      )}
      <DropdownMenuContent side="top" align="start" className="min-w-52">
        <DropdownMenuItem onSelect={() => go('phone')} data-testid="nav-device"><MonitorSmartphone className="size-4" />{t('nav.thisDevice')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

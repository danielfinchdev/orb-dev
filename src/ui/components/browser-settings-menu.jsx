// A linked browser has no Ajustes of the PC: its gear (the same slot and icon as on the PC) opens a small menu with
// what it does have, this device's settings.
import { MonitorSmartphone, Settings } from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, BubbleTip } from '@/components/ui/overlay.jsx';
import { go } from '@/lib/store.js';
import { t, useT } from '@/lib/i18n.js';

export function BrowserSettingsMenu({ active = false }) {
  useT();
  const label = t('nav.settings');
  return (
    <DropdownMenu>
      <BubbleTip title={label} side="top" align="start">
        <DropdownMenuTrigger asChild>
          <button type="button" className="side-foot-icon" aria-label={label} aria-current={active ? 'page' : undefined} data-testid="nav-settings"><Settings className="size-5" /></button>
        </DropdownMenuTrigger>
      </BubbleTip>
      <DropdownMenuContent side="top" align="start" className="min-w-52">
        <DropdownMenuItem onSelect={() => go('phone')} data-testid="nav-device"><MonitorSmartphone className="size-4" />{t('nav.thisDevice')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

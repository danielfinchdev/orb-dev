// «+» under the box: Adjuntar archivo and, on the PC, Capturar una ventana. With only the first one (the phone, a linked
// browser) it stays the plain attach button, as it always was.
import { Paperclip, Plus, ScreenShare } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, Tip } from '@/components/ui/overlay.jsx';
import { useT } from '@/lib/i18n.js';

export function AttachMenu({ onAttach, onCapture }) {
  const t = useT();
  if (!onCapture) return <Tip label={t('session.attach')}><Button variant="ghost" size="icon-sm" aria-label={t('session.attach')} onClick={onAttach} data-testid="attach"><Paperclip /></Button></Tip>;
  return (
    <DropdownMenu>
      <Tip label={t('session.attach')}>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={t('session.attach')} data-testid="attach-menu"><Plus /></Button></DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="start" side="top" onCloseAutoFocus={(e) => e.preventDefault()}>
        <DropdownMenuItem onSelect={onAttach} data-testid="attach"><Paperclip />{t('session.attachFile')}</DropdownMenuItem>
        <DropdownMenuItem onSelect={onCapture} data-testid="capture-window"><ScreenShare />{t('session.captureWindow')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

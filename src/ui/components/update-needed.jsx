// The «update the app» screen: the Orb speaks a newer version of the link than this app (or page).
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { StartNotice, startText } from '@/components/start-card.jsx';
import { bridge } from '@/lib/store.js';
import { AUTHOR } from '../../shared/product.mjs';
import { useT } from '@/lib/i18n.js';

export function UpdateNeeded({ info }) {
  const t = useT();
  const u = info?.needsUpdate ?? {};
  return (
    <StartNotice testid="update-needed" icon={Download} title={t('appUpdate.title')}
      footer={u.app ? <Button onClick={() => bridge.openExternal?.(`https://github.com/${AUTHOR.repo}/releases/latest`)} data-testid="update-open"><Download />{t('appUpdate.download')}</Button> : null}>
      <p className={startText}>{u.message || t('appUpdate.body')}</p>
    </StartNotice>
  );
}

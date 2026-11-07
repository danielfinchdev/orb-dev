// The «update the app» screen: the Orb speaks a newer version of the link than this app (or page).
import { Download } from 'lucide-react';
import { Robot } from '@/components/robot.jsx';
import { Button } from '@/components/ui/button.jsx';
import { bridge } from '@/lib/store.js';
import { AUTHOR } from '../../core/product.mjs';
import { useT } from '@/lib/i18n.js';

export function UpdateNeeded({ info }) {
  const t = useT();
  const u = info?.needsUpdate ?? {};
  return (
    <div className="brand-sky grid h-full place-items-center overflow-y-auto p-6 text-center" data-testid="update-needed">
      <div className="app-titlebar fixed inset-x-0 top-0 z-40 h-14" aria-hidden="true" />
      <div className="bg-card/95 text-card-foreground grid w-full max-w-sm gap-4 rounded-3xl p-7 shadow-2xl">
        <div className="-mt-16 flex justify-center"><Robot size={104} mood="worried" /></div>
        <h1 className="text-xl">{t('appUpdate.title')}</h1>
        <p className="text-muted-foreground text-sm">{u.message || t('appUpdate.body')}</p>
        {u.app ? <Button size="lg" onClick={() => bridge.openExternal?.(`https://github.com/${AUTHOR.repo}/releases/latest`)} data-testid="update-open"><Download />{t('appUpdate.download')}</Button> : null}
      </div>
    </div>
  );
}

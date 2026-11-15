// Decorative caption and status bars for the themes that dress surfaces as windows (Vaporwave, Retro). Other themes
// draw nothing, so their DOM is unchanged. Purely visual: aria-hidden, no handlers, never part of a drag region.
import { useSkin } from '@/lib/store.js';
import { useT } from '@/lib/i18n.js';

const WINDOW_SKINS = new Set(['vaporwave', 'retro']);

export function WindowBar({ kind }) {
  const skin = useSkin();
  const t = useT();
  if (!WINDOW_SKINS.has(skin)) return null;
  if (kind === 'status') return <div className="skin-statusbar" data-slot="window-statusbar" aria-hidden="true"><span>{t('comp.window.ready')}</span><span>Orb.exe</span></div>;
  return <div className="skin-titlebar" data-slot="window-titlebar" aria-hidden="true"><span>Orb.exe</span><span className="skin-caption"><i /><i /><i /></span></div>;
}

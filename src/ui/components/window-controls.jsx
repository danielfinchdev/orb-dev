// 2.6: the window's minimise / maximise / close, drawn by the app (no Windows buttons): top right, as tall as the top bars,
// over every screen (also the welcome and the dialogs), styled like the rest of the bar in each theme (themes.css:
// .win-controls). Only in the PC app: a browser (the phone) has its own.
import { useEffect, useState } from 'react';
import { Minus, Square, Copy, X } from 'lucide-react';
import { useT } from '@/lib/i18n.js';

const controls = () => window.orb?.windowControls;

export function WindowControls() {
  const t = useT();
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    const c = controls();
    if (!c) return undefined;
    Promise.resolve(c.act('state')).then((s) => setMaximized(Boolean(s?.maximized))).catch(() => {});
    return c.onState((s) => setMaximized(Boolean(s?.maximized)));
  }, []);
  if (!controls()) return null;
  const act = (a) => Promise.resolve(controls().act(a)).catch(() => {});
  const button = (action, label, icon, extra = '') => (
    <button type="button" className={`win-control ${extra}`} onClick={() => act(action)} aria-label={label} data-testid={`window-${action}`}>{icon}</button>
  );
  return (
    // Over an open dialog (Ajustes, the games…) a click here must not close it: neither the press nor the focus reach it.
    <div className="win-controls" role="group" aria-label={t('app.window.controls')} onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.preventDefault()}>
      {button('minimize', t('app.window.minimize'), <Minus />)}
      {button('maximize', maximized ? t('app.window.restore') : t('app.window.maximize'), maximized ? <Copy className="-scale-x-100" /> : <Square />)}
      {button('close', t('app.window.close'), <X />, 'win-close')}
    </div>
  );
}

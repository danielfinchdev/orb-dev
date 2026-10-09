// New version of Orb: a card in the top-right corner, under the header (it never covers the menu or the message box), with «Actualizar», the download progress and
// «Reiniciar y actualizar». The state comes from the main process (src/main/updater.mjs); the phone has no updates.
import { useEffect, useState } from 'react';
import { X, Download, RotateCw } from 'lucide-react';
import { bridge, act } from '@/lib/store.js';
import { useT } from '@/lib/i18n.js';

const SHOWN = new Set(['available', 'downloading', 'downloaded']);
const HIDDEN_KEY = 'orb.update.hidden';
export const notesUrl = (version) => `https://github.com/danielfinchdev/orb-dev/releases/tag/v${version}`;

export function useUpdate() {
  const [st, setSt] = useState(null);
  useEffect(() => {
    if (!bridge?.update) return undefined;
    bridge.update.get().then(setSt).catch(() => {});
    return bridge.on('app:update', setSt);
  }, []);
  return st;
}

// What the button does in each state: download (installed), open the download page (portable) or restart into it.
export const updateActions = {
  update: (st) => act(st?.portable ? bridge.update.install() : bridge.update.download()),
  restart: () => act(bridge.update.install()),
  check: () => act(bridge.update.check())
};

export function UpdateCard() {
  const t = useT();
  const st = useUpdate();
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(HIDDEN_KEY) ?? ''; } catch { return ''; } });
  if (!st || !SHOWN.has(st.state) || !st.version || hidden === `${st.state}:${st.version}`) return null;
  // «X» hides it for this version and this step; a later step (downloaded) shows it again.
  const hide = () => { const key = `${st.state}:${st.version}`; setHidden(key); try { localStorage.setItem(HIDDEN_KEY, key); } catch { /* this session only */ } };
  return (
    <div data-testid="update-card" role="status" className="animate-in fade-in-0 slide-in-from-top-2 fixed top-20 right-4 z-50 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl bg-linear-to-br from-[#8f9ef0] to-[#3d63e0] p-5 text-center text-white shadow-2xl">
      <button onClick={hide} className="absolute top-3 right-3 grid size-7 cursor-pointer place-items-center rounded-full hover:bg-white/15" aria-label={t('update.close')}><X className="size-4" /></button>
      <div className="text-[15px] font-semibold">{t('update.title')}</div>
      <p className="mt-2 text-[13px] leading-snug text-white/90">
        {st.state === 'downloaded' ? t('update.ready', { version: st.version }) : t('update.available', { version: st.version })}
      </p>
      {st.state === 'downloading' ? (
        <div className="mt-4 grid gap-1.5" data-testid="update-progress">
          <div className="h-2 overflow-hidden rounded-full bg-white/25"><div className="h-full rounded-full bg-white transition-[width]" style={{ width: `${st.percent ?? 0}%` }} /></div>
          <div className="text-xs text-white/85">{t('update.downloading', { percent: st.percent ?? 0 })}</div>
        </div>
      ) : st.state === 'downloaded' ? (
        <>
          <button data-testid="update-restart" onClick={updateActions.restart} className="mt-4 inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/70 px-4 py-2.5 text-[15px] font-medium hover:bg-white/15"><RotateCw className="size-4" />{t('update.restart')}</button>
          <button onClick={hide} className="mt-2 cursor-pointer text-xs text-white/85 underline-offset-2 hover:underline">{t('update.later')}</button>
        </>
      ) : (
        <>
          <button data-testid="update-now" onClick={() => updateActions.update(st)} className="mt-4 inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/70 px-4 py-2.5 text-[15px] font-medium hover:bg-white/15"><Download className="size-4" />{st.portable ? t('update.download') : t('update.update')}</button>
          {st.error ? <p className="mt-2 text-xs text-white/90">{t('update.failed', { error: st.error })}</p> : null}
        </>
      )}
      <button onClick={() => act(bridge.openExternal(notesUrl(st.version)))} className="mt-3 cursor-pointer text-xs text-white/90 underline underline-offset-2">{t('update.notes')}</button>
    </div>
  );
}

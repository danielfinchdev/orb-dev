// New version of Orb: a card in the top-right corner, under the header (it never covers the menu or the message box), with «Descargar e instalar», the download progress and
// «Reiniciar e instalar». The state comes from the main process (src/main/updater.mjs); the phone has no updates.
// 3.7: below it, the same card for the linked Orb Server (ServerUpdateCard: server.update.* through the app's link).
import { useEffect, useState } from 'react';
import { X, Download, RotateCw, Server } from 'lucide-react';
import { bridge, act, useStore } from '@/lib/store.js';
import { useT, t as tNow } from '@/lib/i18n.js';
import { serverCall } from '@/lib/server.js';
import { POLL_MS, needsCheck, serverOffer, isDenied } from '@/lib/server-update.js';
import { errorText } from '@/lib/utils.js';
import { toast } from 'sonner';
import { AUTHOR } from '../../core/product.mjs';

const SHOWN = new Set(['available', 'downloading', 'downloaded']);
const HIDDEN_KEY = 'orb.update.hidden';
const SERVER_HIDDEN_KEY = 'orb.serverUpdate.hidden';
const CARD = 'animate-in fade-in-0 slide-in-from-top-2 pointer-events-auto relative w-full overflow-hidden rounded-2xl bg-linear-to-br from-[#8f9ef0] to-[#3d63e0] p-5 text-center text-white shadow-2xl';
const BUTTON = 'mt-4 inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/70 px-4 py-2.5 text-[15px] font-medium hover:bg-white/15 disabled:cursor-default disabled:opacity-70';
const CLOSE = 'absolute top-3 right-3 grid size-7 cursor-pointer place-items-center rounded-full hover:bg-white/15';
const readHidden = (key) => { try { return localStorage.getItem(key) ?? ''; } catch { return ''; } };
const saveHidden = (key, value) => { try { localStorage.setItem(key, value); } catch { /* this session only */ } };
export const notesUrl = (version) => `https://github.com/${AUTHOR.repo}/releases/tag/v${version}`;

// Both cards, stacked in the top-right corner (the app's first).
export function UpdateCards() {
  return (
    <div className="pointer-events-none fixed top-20 right-4 z-50 grid w-72 max-w-[calc(100vw-2rem)] gap-3">
      <UpdateCard />
      <ServerUpdateCard />
    </div>
  );
}

export function useUpdate() {
  const [st, setSt] = useState(null);
  useEffect(() => {
    if (!bridge?.update) return undefined;
    bridge.update.get().then(setSt).catch(() => {});
    return bridge.on('app:update', setSt);
  }, []);
  return st;
}

// What the button does in each state: download (installed), open the download page (not installed: Orb Light, the portable .exe) or restart into it.
export const updateActions = {
  update: (st) => act(st?.portable ? bridge.update.install() : bridge.update.download()),
  restart: () => act(bridge.update.install()),
  check: () => act(bridge.update.check())
};

export function UpdateCard() {
  const t = useT();
  const st = useUpdate();
  const [hidden, setHidden] = useState(() => readHidden(HIDDEN_KEY));
  if (!st || !SHOWN.has(st.state) || !st.version || hidden === `${st.state}:${st.version}`) return null;
  // «X» hides it for this version and this step; a later step (downloaded) shows it again.
  const hide = () => { const key = `${st.state}:${st.version}`; setHidden(key); saveHidden(HIDDEN_KEY, key); };
  return (
    <div data-testid="update-card" role="status" className={CARD}>
      <button onClick={hide} className={CLOSE} aria-label={t('update.close')}><X className="size-4" /></button>
      <div className="px-6 text-[15px] font-semibold">{t('update.title', { version: st.version })}</div>
      <p className="mt-2 text-[13px] leading-snug text-white/90">
        {st.state === 'downloaded' ? t('update.ready', { version: st.version }) : st.portable ? t('update.availablePortable') : t('update.available')}
      </p>
      {st.state === 'downloading' ? (
        <div className="mt-4 grid gap-1.5" data-testid="update-progress">
          <div className="h-2 overflow-hidden rounded-full bg-white/25"><div className="h-full rounded-full bg-white transition-[width]" style={{ width: `${st.percent ?? 0}%` }} /></div>
          <div className="text-xs text-white/85">{t('update.downloading', { percent: st.percent ?? 0 })}</div>
        </div>
      ) : st.state === 'downloaded' ? (
        <>
          <button data-testid="update-restart" onClick={updateActions.restart} className={BUTTON}><RotateCw className="size-4" />{t('update.restart')}</button>
          <button onClick={hide} className="mt-2 cursor-pointer text-xs text-white/85 underline-offset-2 hover:underline">{t('update.later')}</button>
        </>
      ) : (
        <>
          <button data-testid="update-now" onClick={() => updateActions.update(st)} className={BUTTON}><Download className="size-4" />{st.portable ? t('update.download') : t('update.update')}</button>
          {st.error ? <p className="mt-2 text-xs text-white/90">{st.error === 'install' ? t('update.installFailed') : t('update.failed', { error: st.error })}</p> : null}
        </>
      )}
      <button onClick={() => act(bridge.openExternal(notesUrl(st.version)))} className="mt-3 cursor-pointer text-xs text-white/90 underline underline-offset-2">{t('update.notes')}</button>
    </div>
  );
}

// The linked Orb Server's update state (server.update.status), asked on start, when the link comes online and every
// POLL_MS; when it never checked, or long ago, it is asked to check first. A refusal (this device may not administer
// it) hides the card until the app restarts.
const deniedTexts = () => [tNow('msg.authz.ownerOnly'), tNow('msg.remote.pcOnly')];
function useServerUpdate() {
  const server = useStore((s) => s.server);
  const online = Boolean(server?.linked && !server.direct && server.peer?.online);
  const [status, setStatus] = useState(null);
  const [denied, setDenied] = useState(false);
  const load = async () => {
    try {
      let s = await serverCall('server.update.status', {});
      if (needsCheck(s)) {
        try { await serverCall('server.update.check', {}); s = await serverCall('server.update.status', {}); }
        catch (e) { if (isDenied(e, deniedTexts())) { setDenied(true); return; } }
      }
      setStatus(s ?? null);
    } catch (e) { if (isDenied(e, deniedTexts())) setDenied(true); }
  };
  useEffect(() => {
    if (!online || denied) return undefined;
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [online, denied]); // eslint-disable-line react-hooks/exhaustive-deps
  return { server, status, denied, setDenied, load };
}

export function ServerUpdateCard() {
  const t = useT();
  const { server, status, denied, setDenied, load } = useServerUpdate();
  const [hidden, setHidden] = useState(() => readHidden(SERVER_HIDDEN_KEY));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const offer = serverOffer({ server, status, denied, hidden });
  if (!offer) return null;
  // «X» hides it for this version; a newer one shows it again.
  const hide = () => { setHidden(offer.version); saveHidden(SERVER_HIDDEN_KEY, offer.version); };
  const apply = async () => {
    setBusy(true); setError('');
    try {
      const r = await serverCall('server.update.apply', {});
      if (r?.updated) toast.success(t('server.updating')); // it restarts: the link goes offline and the card with it
      else load();
    } catch (e) {
      if (isDenied(e, deniedTexts())) setDenied(true);
      else setError(errorText(e));
    } finally { setBusy(false); }
  };
  const working = busy || offer.applying;
  return (
    <div data-testid="server-update-card" role="status" className={CARD}>
      <button onClick={hide} className={CLOSE} aria-label={t('update.close')}><X className="size-4" /></button>
      <div className="flex items-center justify-center gap-1.5 px-6 text-[15px] font-semibold"><Server className="size-4 shrink-0" />{t('server.updateCardTitle', { v: offer.version })}</div>
      <p className="mt-2 text-[13px] leading-snug text-white/90">{working ? t('server.updateCardBusy') : t('server.updateCardHint')}</p>
      <button data-testid="server-update-now" onClick={apply} disabled={working} className={BUTTON}>
        {working ? <RotateCw className="size-4 animate-spin" /> : <Download className="size-4" />}{t('server.updateApply')}
      </button>
      {error ? <p className="mt-2 text-xs text-white/90" role="alert">{t('server.updateFailed', { error })}</p> : null}
    </div>
  );
}

// The little always-on-top window: live picture of the page the agent is using, who it is and what it just did.
// Expand, collapse to a pill, or close until the next activity.
import './app.css';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Maximize2, Minimize2, ChevronUp, ChevronDown, X, AppWindow, LoaderCircle } from 'lucide-react';
import { Robot } from '@/components/robot.jsx';
import { cn } from '@/lib/utils.js';
import { createT } from '../core/i18n.mjs';

const host = (url) => { try { return new URL(url).host; } catch { return url; } };

// This window has no store: the main process may send `language` with the state (es by default).
function IconButton({ label, onClick, children }) {
  return <button type="button" title={label} aria-label={label} onClick={onClick} className="no-drag grid size-7 cursor-pointer place-items-center rounded-md text-white/70 transition hover:bg-white/10 hover:text-white [&_svg]:size-3.5">{children}</button>;
}

function Pip() {
  const [state, setState] = useState({ mode: 'normal', agent: null, url: '', title: '', loading: false, action: '' });
  const t = createT(state.language === 'en' ? 'en' : 'es');
  const [src, setSrc] = useState(null);
  useEffect(() => {
    const offState = window.pip.onState(setState);
    const offFrame = window.pip.onFrame((url) => { if (typeof url === 'string' && url.startsWith('data:image/jpeg;base64,')) setSrc(url); });
    return () => { offState(); offFrame(); };
  }, []);
  const act = (name) => window.pip.action(name);
  const who = state.agent ? `${state.agent}${state.task ? t('pip.task', { n: state.task }) : ''}` : t('pip.agent');
  if (state.mode === 'pildora') return (
    <div className="drag flex h-full items-center gap-2 bg-[#11131c] pr-1 pl-2.5 text-white" data-testid="pip">
      <Robot size={22} mood={state.loading ? 'thinking' : 'talking'} still={false} />
      <div className="min-w-0 flex-1 truncate text-xs"><span className="text-white/90">{who}</span> <span className="text-white/50">{state.action || host(state.url)}</span></div>
      <IconButton label={t('pip.show')} onClick={() => act('normal')}><ChevronDown /></IconButton>
      <IconButton label={t('pip.closeUntil')} onClick={() => act('cerrar')}><X /></IconButton>
    </div>
  );
  return (
    <div className="flex h-full flex-col bg-[#11131c] text-white" data-testid="pip">
      <div className="drag flex h-9 shrink-0 items-center gap-2 border-b border-white/10 pr-1 pl-2.5">
        <Robot size={20} mood={state.loading ? 'thinking' : 'talking'} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-xs text-white/90">{who}{state.action ? <span className="text-white/50"> · {state.action}</span> : null}</div>
          <div className="flex items-center gap-1 truncate text-[10.5px] text-white/45">{state.loading ? <LoaderCircle className="size-2.5 animate-spin" /> : null}{host(state.url) || t('pip.noPage')}</div>
        </div>
        <IconButton label={t('pip.toApp')} onClick={() => act('app')}><AppWindow /></IconButton>
        {state.mode === 'grande' ? <IconButton label={t('pip.smaller')} onClick={() => act('normal')}><Minimize2 /></IconButton> : <IconButton label={t('pip.bigger')} onClick={() => act('grande')}><Maximize2 /></IconButton>}
        <IconButton label={t('pip.collapse')} onClick={() => act('pildora')}><ChevronUp /></IconButton>
        <IconButton label={t('pip.closeUntil')} onClick={() => act('cerrar')}><X /></IconButton>
      </div>
      <div className="relative min-h-0 flex-1 bg-black/40">
        {src ? <img src={src} alt={state.title || t('pip.pageAlt')} className="absolute inset-0 size-full object-contain" draggable={false} /> : <div className="grid h-full place-items-center text-xs text-white/50">{t('pip.waiting')}</div>}
        {state.title ? <div className={cn('pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-2.5 pt-4 pb-1.5 text-[11px] text-white/85')}>{state.title}</div> : null}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><Pip /></StrictMode>);

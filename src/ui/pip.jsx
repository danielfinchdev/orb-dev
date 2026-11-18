// The little always-on-top window: live picture of the page the agent is using, who it is and what it just did.
// Expand, collapse to a pill, or close until the next activity. Always dark (body.dark). The window is moved by the
// bridge's pip drag, so nothing here declares a drag region of its own, and nothing that animates sits inside .drag.
import './lib/tauri-pip-bridge.js';
import './app.css';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Maximize2, Minimize2, ChevronUp, ChevronDown, X, AppWindow, LoaderCircle, MousePointerClick, MousePointer2, Circle, Square, Lock, Globe } from 'lucide-react';
import { AgentIcon } from '@/components/agent-icon.jsx';
import { IconButton } from '@/components/ui/primitives.jsx';
import { Badge } from '@/components/ui/basic.jsx';
import { cn } from '@/lib/utils.js';
import { createT } from '../shared/i18n.mjs';

const host = (url) => { try { return new URL(url).host; } catch { return url; } };
// where a click fell on the page's picture (shown with object-contain), as fractions of the picture
// (4 decimals, as the app expects: src-tauri/src/pip.rs › point_request). → [x, y] or null (outside the picture).
function pictureFraction(e) {
  const img = e.currentTarget; const box = img.getBoundingClientRect();
  if (!img.naturalWidth || !img.naturalHeight) return null;
  const k = Math.min(box.width / img.naturalWidth, box.height / img.naturalHeight);
  const w = img.naturalWidth * k; const h = img.naturalHeight * k;
  const x = (e.clientX - box.left - (box.width - w) / 2) / w; const y = (e.clientY - box.top - (box.height - h) / 2) / h;
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? [x, y].map((v) => String(Math.round(v * 10000) / 10000)) : null;
}

// The agent's mark from its display name («Claude Code», «Codex»…); anything else gets the generic sparkle.
const KNOWN = ['claude', 'codex', 'cursor', 'gemini', 'copilot', 'qwen', 'opencode', 'hermes'];
const agentOf = (label) => { const w = String(label ?? '').trim().split(/\s+/)[0].toLowerCase(); return KNOWN.includes(w) ? w : 'orb'; };

// This window has no store: the main process may send `language` with the state (es by default).
// A 24 px icon button; its title holds the label and what it does. no-drag: the header is the drag handle.
function PipButton({ label, hint, onClick, active, children }) {
  return <IconButton small label={label} title={hint ? `${label} · ${hint}` : label} active={active} onClick={onClick} className="no-drag active:transform-none! data-[active=true]:bg-primary data-[active=true]:text-primary-foreground [&_svg]:size-4">{children}</IconButton>;
}

function Pip() {
  const [state, setState] = useState({ mode: 'normal', agent: null, url: '', title: '', loading: false, action: '' });
  const t = createT(state.language === 'en' ? 'en' : 'es');
  const [src, setSrc] = useState(null);
  const [pointing, setPointing] = useState(false);
  useEffect(() => {
    const offState = window.pip.onState(setState);
    const offFrame = window.pip.onFrame((url) => { if (typeof url === 'string' && url.startsWith('data:image/jpeg;base64,')) setSrc(url); });
    return () => { offState(); offFrame(); };
  }, []);
  const act = (name) => window.pip.action(name);
  const pick = (e) => { if (!pointing) return; const f = pictureFraction(e); if (!f) return; setPointing(false); act(`point:${f[0]},${f[1]}`); };
  const who = state.agent ? `${state.agent}${state.task ? t('pip.task', { n: state.task }) : ''}` : t('pip.agent');
  const mark = <AgentIcon agent={agentOf(state.agent)} className="size-3" />;
  const closeBtn = <PipButton label={t('pip.closeUntil')} hint={t('pip.closeUntilDesc')} onClick={() => act('cerrar')}><X /></PipButton>;
  const appBtn = <PipButton label={t('pip.toApp')} hint={t('pip.toAppDesc')} onClick={() => act('app')}><AppWindow /></PipButton>;
  if (state.mode === 'pildora') return (
    <div className="drag border-border bg-background text-foreground flex h-full items-center gap-1.5 border pr-1.5 pl-3" data-testid="pip">
      {mark}
      <div className="flex min-w-0 flex-1 flex-col leading-tight"><b className="truncate text-xs font-semibold">{who}</b><span className="text-muted-foreground truncate text-micro">{state.action || host(state.url)}</span></div>
      {appBtn}
      <PipButton label={t('pip.show')} onClick={() => act('normal')}><ChevronDown /></PipButton>
      {closeBtn}
    </div>
  );
  const big = state.mode === 'grande';
  return (
    <div className="border-border bg-background text-foreground flex h-full flex-col border" data-testid="pip">
      <div className="drag border-border flex h-9 shrink-0 items-center gap-0.5 border-b pr-1 pl-2.5">
        {mark}
        <b className="ml-1.5 min-w-0 truncate text-xs font-medium">{who}{state.action ? ` · ${state.action}` : ''}</b>
        {state.recording ? <Badge variant="destructive" className="ml-1"><Circle />{t('pip.recording')}</Badge> : null}
        <span className="flex-1" />
        {/* point at an element (it goes to the chat's message box) and record what the agent does. */}
        <PipButton label={t('pip.point')} hint={t('pip.pointDesc')} active={pointing} onClick={() => setPointing(!pointing)}><MousePointerClick /></PipButton>
        {state.recording ? <PipButton label={t('pip.stopRecording')} onClick={() => act('parar')}><Square /></PipButton>
          : <PipButton label={t('pip.record')} hint={t('pip.recordDesc')} onClick={() => act('grabar')}><Circle /></PipButton>}
        {appBtn}
        {big ? <PipButton label={t('pip.smaller')} hint={t('pip.sizeDesc')} onClick={() => act('normal')}><Minimize2 /></PipButton> : <PipButton label={t('pip.bigger')} hint={t('pip.sizeDesc')} onClick={() => act('grande')}><Maximize2 /></PipButton>}
        <PipButton label={t('pip.collapse')} hint={t('pip.collapseDesc')} onClick={() => act('pildora')}><ChevronUp /></PipButton>
        {closeBtn}
      </div>
      {src ? (
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 p-2">
          <div className="border-border bg-card text-muted-foreground rounded-ctl flex h-(--ctl-sm) shrink-0 items-center gap-1.5 border px-2 text-xs">
            {state.loading ? <LoaderCircle className="size-3.5 animate-spin" /> : state.url.startsWith('https:') ? <Lock className="size-3.5" /> : <Globe className="size-3.5" />}
            <span className="min-w-0 flex-1 truncate">{host(state.url) || t('pip.noPage')}</span>
          </div>
          <div className="border-border bg-card rounded-ctl relative min-h-0 flex-1 overflow-hidden border">
            <img src={src} alt={state.title || t('pip.pageAlt')} onClick={pick} className={cn('absolute inset-0 size-full object-contain', pointing && 'cursor-crosshair')} draggable={false} />
          </div>
          {pointing || state.title ? (
            <div className="text-muted-foreground flex shrink-0 items-center gap-1.5 text-micro">
              {pointing ? <><MousePointerClick className="size-3.5 shrink-0" /><span role="status" className="min-w-0 truncate">{t('pip.pointNote')}</span></> : null}
              <span className="flex-1" />
              {state.title ? <span className="max-w-[60%] truncate">{state.title}</span> : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="text-muted-foreground text-control flex min-h-0 flex-1 flex-col items-center justify-center gap-1.5 p-4 text-center">
          {state.url || state.loading ? <LoaderCircle className="size-5 animate-spin" /> : <Globe className="size-5" />}
          <b className="text-foreground font-medium">{state.url || state.loading ? t('pip.waiting') : t('pip.noPageTitle')}</b>
        </div>
      )}
      {state.action ? <div className="border-border text-muted-foreground flex h-7 shrink-0 items-center gap-1.5 border-t px-2.5 text-xs"><MousePointer2 className="size-3.5 shrink-0" /><span className="truncate">{state.action}</span></div> : null}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><Pip /></StrictMode>);

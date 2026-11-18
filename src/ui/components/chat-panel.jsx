// The right panel of a chat with an agent: Ficha, Cambios and PR in one pane (mock-up 01-chat). Its edge is dragged
// between 320 and 640 px (remembered in this window) and it opens and closes with a slide and a fade (transform and
// opacity only). «Cambios» only exists with the panel open; Ctrl+D and «Revisar» open the panel on it (openChatPanel).
import { useEffect, useState } from 'react';
import { FileDiff, GitPullRequest, Info } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/overlay.jsx';
import { CloseButton } from '@/components/ui/primitives.jsx';
import { WindowControlsSlot } from '@/components/window-controls.jsx';
import { useT } from '@/lib/i18n.js';

const PANEL_MIN = 320; const PANEL_MAX = 640; const PANEL_DEFAULT = 440; const WIDTH_KEY = 'orb.anchoPanel';
const clamp = (n) => Math.round(Math.min(PANEL_MAX, Math.max(PANEL_MIN, n)));

function usePanelWidth() {
  const [width, setRaw] = useState(() => { try { const n = Number(localStorage.getItem(WIDTH_KEY)); return n >= PANEL_MIN && n <= PANEL_MAX ? n : PANEL_DEFAULT; } catch { return PANEL_DEFAULT; } });
  const remember = (w) => { try { localStorage.setItem(WIDTH_KEY, String(w)); } catch { /* storage unavailable */ } };
  const setWidth = (n) => { const w = clamp(n); setRaw(w); remember(w); };
  // The edge is on the panel's left: dragging left widens it. The pointer stays captured, so a release outside the window
  // or a cancelled drag still ends it; the width is saved once, on release.
  const startResize = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget; const x0 = e.clientX; const w0 = handle.parentElement.getBoundingClientRect().width; let last = w0;
    try { handle.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    handle.setAttribute('data-dragging', ''); document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
    const move = (ev) => { last = clamp(w0 - (ev.clientX - x0)); setRaw(last); };
    const end = () => {
      handle.removeAttribute('data-dragging'); document.body.style.cursor = ''; document.body.style.userSelect = '';
      for (const [n, f] of [['pointermove', move], ['pointerup', end], ['pointercancel', end], ['lostpointercapture', end]]) handle.removeEventListener(n, f);
      remember(last);
    };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end); handle.addEventListener('lostpointercapture', end);
  };
  return { width, setWidth, startResize };
}

// open: the panel is shown; while it closes it stays mounted for the length of its exit animation.
export function ChatPanel({ open, tab, onTab, onClose, prNumber, children }) {
  const t = useT();
  const { width, setWidth, startResize } = usePanelWidth();
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) { setMounted(true); return undefined; }
    const id = setTimeout(() => setMounted(false), 180);
    return () => clearTimeout(id);
  }, [open]);
  if (!mounted && !open) return null;
  const nudge = (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); setWidth(width + 16); } else if (e.key === 'ArrowRight') { e.preventDefault(); setWidth(width - 16); }
  };
  return (
    <aside className="chat-panel bg-background relative flex max-w-[70%] shrink-0 flex-col border-l" style={{ width }} data-state={open ? 'open' : 'closed'} data-testid="chat-panel" aria-label={t('panel.tabs')}>
      <div className="chat-panel-resize" role="separator" aria-orientation="vertical" aria-label={t('panel.resize')} aria-valuemin={PANEL_MIN} aria-valuemax={PANEL_MAX} aria-valuenow={width} tabIndex={0}
        onPointerDown={startResize} onDoubleClick={() => setWidth(PANEL_DEFAULT)} onKeyDown={nudge} data-testid="chat-panel-resize" />
      <Tabs value={tab} onValueChange={onTab} className="flex min-h-0 flex-1 flex-col">
        <div className="chat-panel-tabs app-titlebar relative flex h-14 shrink-0 items-center gap-0.5 border-b pl-2.5 pr-2.5">
          <TabsList variant="line" className="no-drag h-auto w-auto border-b-0 pb-0">
            <TabsTrigger value="info" data-testid="panel-tab-info"><Info className="size-3.5" />{t('panel.tab.info')}</TabsTrigger>
            <TabsTrigger value="changes" data-testid="panel-tab-changes"><FileDiff className="size-3.5" />{t('panel.tab.changes')}</TabsTrigger>
            {prNumber ? <TabsTrigger value="pr" data-testid="panel-tab-pr"><GitPullRequest className="size-3.5" />{t('panel.tab.pr', { n: prNumber })}</TabsTrigger> : null}
          </TabsList>
          <CloseButton className="no-drag ml-auto" label={t('turns.close')} onClick={onClose} data-testid="turn-changes-close" />
          <WindowControlsSlot />
        </div>
        <div className="chat-panel-body min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-5 py-[18px]" role="tabpanel" aria-label={t(`panel.tab.${tab}`, { n: prNumber })} data-tab={tab}>{children}</div>
      </Tabs>
    </aside>
  );
}

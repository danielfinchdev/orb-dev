// The HTML pages an agent showed in this chat (orb_html_show, src/engine/host/html-pages.mjs). Only in this PC's window.
// The page is untrusted code: it runs in a frame with sandbox="allow-scripts" ONLY (an opaque origin: no popups or
// top navigation), served from the engine's loopback server whose CSP is also sandboxed. The title is plain text.
// The internet switch is the engine's state (list + events), never a local copy: it is written by htmlPages.setInternet.
import { useEffect, useState } from 'react';
import { Globe, Maximize2, ShieldAlert, X } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Switch, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/overlay.jsx';
import { cn } from '@/lib/utils.js';
import { call, act, bridge, fullPc } from '@/lib/store.js';
import { useT } from '@/lib/i18n.js';
import { quiet } from '@/lib/quiet.js';
import { mountable } from '@/lib/html-mount.js';

const refOf = (p) => ({ id: p.id, session: p.session });

// One frame element for both the tile and the enlarged view. sandbox stays "allow-scripts" ONLY: no same-origin, popups or top navigation.
function PageFrame({ p, className, testid }) {
  const t = useT();
  // key: a new key reloads the frame, so the new internet policy is fetched
  return <iframe key={`${p.id}:${p.internet ? 1 : 0}`} src={p.url} sandbox="allow-scripts" referrerPolicy="no-referrer" title={t('htmlpage.frame', { title: p.title })} className={cn('bg-white w-full rounded-md border', className)} data-testid={testid} />;
}

// The answers the agent offers (orb_html_show › choices): buttons of Orb's own, outside the frame. Pressing one sends its text, as
// it reads, as the person's message in this chat; the page itself can press nothing.
function Choices({ sessionId, choices }) {
  const t = useT();
  const [sent, setSent] = useState(null);
  if (!choices?.length) return null;
  const send = async (text) => { setSent(text); if ((await act(call('sessions.send', { id: String(sessionId), text }))) === undefined) setSent(null); };
  return (
    <div role="group" aria-label={t('htmlpage.choices')} className="flex flex-wrap items-center gap-2" data-testid="html-choices">
      {choices.map((c) => <Button key={c} type="button" size="sm" variant="outline" className="h-auto max-w-full py-1.5 whitespace-normal" disabled={sent !== null} aria-pressed={sent === c} title={t('htmlpage.choiceTip')} onClick={() => send(c)} data-testid="html-choice">{c}</Button>)}
    </div>
  );
}

function HtmlPage({ p, paused, sessionId }) {
  const t = useT();
  const [big, setBig] = useState(false);
  const internet = p.internet === true;
  // a page that went to sleep must not pop its enlarged view back open when it wakes
  useEffect(() => { if (paused) setBig(false); }, [paused]);
  return (
    <div className={cn('bg-card grid gap-2.5 rounded-xl border px-3.5 py-3 text-control', internet && 'border-warning/50')} data-testid="html-page">
      <div className="flex items-center gap-2 font-medium">
        <Globe className="text-muted-foreground size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate" data-testid="html-title"><bdi>{p.title}</bdi></span>
        <Button type="button" size="icon-sm" variant="ghost" disabled={paused} aria-label={t('htmlpage.expand')} title={t('htmlpage.expand')} onClick={() => setBig(true)} data-testid="html-expand"><Maximize2 className="size-4" /></Button>
        <Button type="button" size="icon-sm" variant="ghost" aria-label={t('htmlpage.close')} title={t('htmlpage.close')} onClick={() => act(call('htmlPages.close', refOf(p)))} data-testid="html-close"><X className="size-4" /></Button>
      </div>
      {paused
        ? <div className="text-muted-foreground bg-muted/40 rounded-md border px-3 py-6 text-center text-xs" data-testid="html-paused">{t('htmlpage.pausedNote')}</div>
        : <PageFrame p={p} className="h-[320px]" testid="html-frame" />}
      {paused ? null : <Choices sessionId={sessionId} choices={p.choices} />}
      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-xs font-medium" title={t('htmlpage.internetHint')}>
          <Switch checked={internet} onCheckedChange={(on) => act(call('htmlPages.setInternet', { ...refOf(p), internet: on === true }))} aria-describedby={`html-help-${p.id}`} data-testid="html-internet" />
          {t('htmlpage.internet')}
        </label>
      </div>
      {internet ? <p className="text-warning-ink flex items-start gap-1.5 text-xs font-medium" role="status" data-testid="html-internet-warn"><ShieldAlert className="mt-px size-3.5 shrink-0" />{t('htmlpage.internetOn')}</p> : null}
      <p id={`html-help-${p.id}`} className="text-muted-foreground text-xs" data-testid="html-help">{t('htmlpage.sandboxHelp')}</p>
      {/* the enlarged view mounts a second frame only while open and only if this page is the live one */}
      <Dialog open={big && !paused} onOpenChange={setBig}>
        <DialogContent className="h-[85vh] max-w-[min(1100px,92vw)] grid-rows-[auto_1fr]" data-testid="html-big">
          <DialogHeader><DialogTitle className="truncate"><bdi>{p.title}</bdi></DialogTitle><DialogDescription>{t('htmlpage.expandedTitle')}</DialogDescription></DialogHeader>
          <PageFrame p={p} className="h-full min-h-0" testid="html-frame-big" />
        </DialogContent>
      </Dialog>
    </div>
  );
}

// The pages of one conversation.
export function HtmlPages({ sessionId }) {
  const [list, setList] = useState([]);
  useEffect(() => {
    if (!fullPc()) return undefined;
    let alive = true;
    setList([]);
    const mine = (p) => p?.session === String(sessionId);
    const put = (p) => setList((prev) => (prev.some((x) => x.id === p.id) ? prev.map((x) => (x.id === p.id ? p : x)) : [...prev, p]));
    call('htmlPages.list').then((all) => { if (alive) setList((all ?? []).filter(mine)); }).catch(quiet);
    const offPage = bridge.on('html:page', (p) => { if (mine(p)) put(p); });
    const offUpdate = bridge.on('html:update', (p) => { if (mine(p)) put(p); });
    const offClosed = bridge.on('html:closed', (p) => setList((prev) => prev.filter((x) => x.id !== p?.id)));
    return () => { alive = false; offPage(); offUpdate(); offClosed(); };
  }, [sessionId]);
  if (!list.length) return null;
  const live = mountable(list);
  return <div className="mx-auto grid w-full max-w-3xl shrink-0 gap-2 px-5 pb-2">{list.map((p) => <HtmlPage key={p.id} p={p} paused={!live.has(p.id)} sessionId={sessionId} />)}</div>;
}

// The HTML pages an agent showed in this chat (orb_html_show, src/engine/host/html-pages.mjs). Only in this PC's window.
// The page is untrusted code: it runs in a frame with sandbox="allow-scripts" ONLY (an opaque origin: no popups or
// top navigation), served from the engine's loopback server whose CSP is also sandboxed. The title is plain text.
// The internet switch is the engine's state (list + events), never a local copy: it is written by htmlPages.setInternet.
import { useEffect, useState } from 'react';
import { Globe, X } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Switch } from '@/components/ui/overlay.jsx';
import { call, act, bridge, fullPc } from '@/lib/store.js';
import { useT } from '@/lib/i18n.js';
import { mountable } from '@/lib/html-mount.js';

const refOf = (p) => ({ id: p.id, session: p.session });

function HtmlPage({ p, paused }) {
  const t = useT();
  return (
    <div className="bg-card grid gap-2 rounded-xl border px-3.5 py-3 text-[13px]" data-testid="html-page">
      <div className="flex items-center gap-2 font-medium">
        <Globe className="text-muted-foreground size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate" data-testid="html-title"><bdi>{p.title}</bdi></span>
        <Button type="button" size="icon" variant="ghost" aria-label={t('htmlpage.close')} title={t('htmlpage.close')} onClick={() => act(call('htmlPages.close', refOf(p)))} data-testid="html-close"><X className="size-4" /></Button>
      </div>
      {/* key: a new key reloads the frame, so the new internet policy is fetched */}
      {paused
        ? <div className="text-muted-foreground bg-muted/40 rounded-md border px-3 py-6 text-center text-xs" data-testid="html-paused">{t('htmlpage.pausedNote')}</div>
        : <iframe key={`${p.id}:${p.internet ? 1 : 0}`} src={p.url} sandbox="allow-scripts" referrerPolicy="no-referrer" title={t('htmlpage.frame', { title: p.title })} className="bg-white h-[320px] w-full rounded-md border" data-testid="html-frame" />}
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground text-xs">{t('htmlpage.note')}</span>
        <label className="flex items-center gap-2 text-xs" title={t('htmlpage.internetHint')}>
          {t('htmlpage.internet')}
          <Switch checked={p.internet === true} onCheckedChange={(on) => act(call('htmlPages.setInternet', { ...refOf(p), internet: on === true }))} data-testid="html-internet" />
        </label>
      </div>
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
    call('htmlPages.list').then((all) => { if (alive) setList((all ?? []).filter(mine)); }).catch(() => {});
    const offPage = bridge.on('html:page', (p) => { if (mine(p)) put(p); });
    const offUpdate = bridge.on('html:update', (p) => { if (mine(p)) put(p); });
    const offClosed = bridge.on('html:closed', (p) => setList((prev) => prev.filter((x) => x.id !== p?.id)));
    return () => { alive = false; offPage(); offUpdate(); offClosed(); };
  }, [sessionId]);
  if (!list.length) return null;
  const live = mountable(list);
  return <div className="mx-auto grid w-full max-w-3xl shrink-0 gap-2 px-5 pb-2">{list.map((p) => <HtmlPage key={p.id} p={p} paused={!live.has(p.id)} />)}</div>;
}

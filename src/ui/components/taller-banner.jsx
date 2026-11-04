// 3.5: on a phone (or a browser) linked with the server, how the PC that does the work («taller») is: on, or off with
// when it was last seen, a button that wakes it (Wake-on-LAN from the server) and a way to leave it something to do
// when it comes back.
import { useEffect, useState } from 'react';
import { Laptop, Power, Clock } from 'lucide-react';
import { Button } from './ui/button.jsx';
import { Input } from './ui/basic.jsx';
import { call, act, bridge } from '@/lib/store.js';
import { tallerBanner } from '@/lib/bots.js';
import { cn, ago } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';

export function TallerBanner() {
  const t = useT();
  const [status, setStatus] = useState(null);
  const [queue, setQueue] = useState(null); // null = closed; '' or text = open
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!bridge.mobile) return undefined;
    let alive = true;
    const load = () => call('link.status').then((s) => alive && setStatus(s)).catch(() => {});
    load();
    const id = setInterval(load, 30_000);
    const off = bridge.on('*', (event, p) => { if (event === 'link:status' && p) setStatus(p); else if (event === 'link:queue') load(); });
    return () => { alive = false; clearInterval(id); off(); };
  }, []);
  const b = tallerBanner(status);
  if (!b) return null;
  const wake = async () => { setBusy(true); await act(call('taller.wake', {}), t('link.taller.waking', { name: b.name })); setBusy(false); };
  const leave = async () => {
    const text = (queue ?? '').trim(); if (!text) return;
    setBusy(true);
    const r = await act(call('taller.queue', { method: 'chat.send', params: { text } }), t('link.taller.queued', { name: b.name }));
    setBusy(false);
    if (r) setQueue(null);
  };
  return (
    <div className={cn('shrink-0 border-b px-4 py-2 text-[13px]', b.online ? 'bg-success/8' : 'bg-warning/10')} data-testid="taller-banner" data-online={b.online}>
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-1.5">
        <Laptop className={cn('size-4 shrink-0', b.online ? 'text-success' : 'text-warning')} />
        <span className="min-w-0 flex-1">{b.online ? t('link.taller.on', { name: b.name }) : t('link.taller.off', { name: b.name })}
          {!b.online && b.lastSeen ? <span className="text-muted-foreground"> · {t('link.seen', { when: ago(b.lastSeen) })}</span> : null}
          {b.queued ? <span className="text-muted-foreground"> · {t('link.taller.pending', { n: b.queued })}</span> : null}
        </span>
        {b.online ? null : (<>
          {b.canWake ? <Button size="xs" onClick={wake} disabled={busy} data-testid="taller-wake"><Power />{t('link.taller.wake')}</Button> : null}
          <Button size="xs" variant="outline" onClick={() => setQueue(queue == null ? '' : null)} data-testid="taller-queue"><Clock />{t('link.taller.queue')}</Button>
        </>)}
      </div>
      {queue != null && !b.online ? (
        <form className="mx-auto mt-2 flex max-w-3xl gap-2" onSubmit={(e) => { e.preventDefault(); leave(); }}>
          <Input autoFocus value={queue} onChange={(e) => setQueue(e.target.value)} maxLength={4000} placeholder={t('link.taller.queuePh', { name: b.name })} data-testid="taller-queue-text" />
          <Button size="sm" type="submit" disabled={busy || !queue.trim()}>{t('link.taller.leave')}</Button>
        </form>
      ) : null}
    </div>
  );
}

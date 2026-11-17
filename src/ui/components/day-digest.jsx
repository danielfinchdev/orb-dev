// The morning card: what the logs and the board registered yesterday (engine › inbox.digest). Shown once per day on this
// device, at the top of the chat list (the PC's sidebar and the phone's «Chats» tab). Nothing is guessed: a part with
// nothing registered is not drawn, and a day with nothing at all shows no card.
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { call, go } from '@/lib/store.js';
import { quiet } from '@/lib/quiet.js';
import { useT } from '@/lib/i18n.js';
import { digestLines } from '@/lib/day-digest.js';
import { cn } from '@/lib/utils.js';

export function DayDigestCard({ phone = false }) {
  const t = useT();
  const [d, setD] = useState(null);
  useEffect(() => {
    let live = true;
    call('inbox.digest', {}).then((r) => { if (live && r?.due && !r.empty) setD(r); }).catch(quiet);
    return () => { live = false; };
  }, []);
  if (!d) return null;
  const close = () => { setD(null); call('inbox.digestSeen', {}).catch(quiet); };
  const lines = digestLines(d, t);
  return (
    <section className={cn('bg-card relative border', phone ? 'mx-2 mt-2 rounded-xl px-3 py-2.5' : 'mx-0.5 mt-1 mb-1.5 rounded-card px-2.5 py-2 text-caption')} aria-label={t('orbchats.digestTitle')} data-testid="day-digest">
      <button type="button" onClick={close} className="text-muted-foreground hover:text-foreground absolute top-2 right-2 grid size-6 cursor-pointer place-items-center rounded" aria-label={t('orbchats.digestClose')} data-testid="day-digest-close"><X className="size-3.5" /></button>
      <h3 className="pr-7 text-control font-semibold">{t('orbchats.digestTitle')} <span className="text-muted-foreground font-normal">{d.day}</span></h3>
      <ul className="mt-1 grid gap-1.5 text-control">
        {lines.map((l) => (
          <li key={l.key} data-testid={`day-digest-${l.key}`}>
            <span>{l.text}</span>
            {l.items.length ? <ul className="text-muted-foreground mt-0.5 grid gap-0.5 text-caption">{l.items.map((x, i) => <li key={i} className="truncate">· {x}</li>)}</ul> : null}
          </li>
        ))}
      </ul>
      {d.waiting?.approvals || d.waiting?.held ? <button type="button" onClick={() => { close(); go({ view: 'tasks' }); }} className="text-primary-text mt-2 cursor-pointer text-control hover:underline" data-testid="day-digest-tasks">{t('orbchats.digestOpenTasks')}</button> : null}
    </section>
  );
}

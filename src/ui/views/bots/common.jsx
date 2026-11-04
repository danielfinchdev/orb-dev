// 3.5: what the screens of the Bots mode share: the list of bots from the store, a bot's face (its icon), whether this
// device may change bots, and the cards for «no bots yet» and «the bots do not answer».
import { useEffect } from 'react';
import { Bot, RefreshCw, Plus, ServerOff, Server } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Spinner } from '@/components/ui/basic.jsx';
import { useStore, bridge, go, loadBots, loadCentro } from '@/lib/store.js';
import { botsPrefix, canManageBots } from '@/lib/bots.js';
import { cn } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';

// The bots, their groups and what each one is doing; loaded once by the first screen that needs them.
export function useBots() {
  const data = useStore((s) => s.bots);
  const error = useStore((s) => s.botsError);
  const states = useStore((s) => s.botStates) ?? {};
  const version = useStore((s) => s.version);
  useEffect(() => { loadBots(); }, [version]);
  return { bots: data?.bots ?? [], groups: data?.groups ?? [], tools: data?.tools ?? [], loaded: Boolean(data), error, states };
}

// Creating, changing or deleting bots, their memories and the golden rules: on the PC, or on a linked device marked
// «Puede administrar» in Magic Link. Any other phone talks to them, answers their cards and pauses them.
export function useCanManage() {
  const access = useStore((s) => s.app?.access);
  return canManageBots({ mobile: bridge.mobile, access });
}

export function BotFace({ bot, size = 'md', busy = false, className }) {
  const box = size === 'lg' ? 'size-12 text-2xl rounded-2xl' : size === 'sm' ? 'size-6 text-[13px] rounded-md' : 'size-9 text-lg rounded-xl';
  return (
    <span className={cn('bg-primary/10 relative grid shrink-0 place-items-center select-none', box, className)} aria-hidden="true">
      {bot?.icon ? <span className="leading-none">{bot.icon}</span> : <Bot className="text-primary size-[60%]" />}
      {busy ? <span className="bg-primary absolute -right-0.5 -bottom-0.5 size-2.5 animate-pulse rounded-full ring-2 ring-[var(--background)]" /> : null}
    </span>
  );
}

// No bots at all: an invitation to make the first one (nothing comes made beyond the starter «Asistente»).
export function NoBots() {
  const t = useT();
  const manage = useCanManage();
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center" data-testid="bots-empty">
      <div className="bg-primary/10 text-primary grid size-14 place-items-center rounded-2xl"><Bot className="size-7" /></div>
      <h2 className="text-xl">{t('bots.empty.title')}</h2>
      <p className="text-muted-foreground max-w-md text-sm">{t('bots.empty.body')}</p>
      {manage ? <Button onClick={() => go({ view: 'bots', id: 'new' })} data-testid="bots-create-first"><Plus />{t('bots.empty.create')}</Button>
        : <p className="text-muted-foreground text-xs">{t('bots.empty.onPc')}</p>}
    </div>
  );
}

// The bots do not answer (the server is off or without network): said in words, with a way to try again.
export function BotsDown({ error }) {
  const t = useT();
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center" role="alert" data-testid="bots-down">
      <div className="bg-warning/15 text-warning grid size-14 place-items-center rounded-2xl"><ServerOff className="size-7" /></div>
      <h2 className="text-xl">{t('bots.down.title')}</h2>
      <p className="text-muted-foreground max-w-md text-sm">{t('bots.down.body')}</p>
      {error ? <p className="text-muted-foreground max-w-md text-xs">{error}</p> : null}
      <Button variant="outline" onClick={() => loadBots()}><RefreshCw />{t('bots.down.retry')}</Button>
    </div>
  );
}

export function Loading() { return <div className="grid place-items-center py-16"><Spinner /></div>; }

// The scrolling body of a screen of the Bots mode.
export function BotPage({ children, className, wide = false }) {
  return <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-5 sm:px-5"><div className={cn('mx-auto grid gap-4', wide ? 'max-w-5xl' : 'max-w-3xl', className)}>{children}</div></div>;
}

// Where the bots live when this PC is linked with a server: «Bots en <server>», with whether it answers now.
export function CentroBadge({ className }) {
  const t = useT();
  const centro = useStore((s) => s.centro);
  useEffect(() => { if (!bridge.mobile && centro === undefined) loadCentro(); }, [centro]);
  if (!botsPrefix(centro)) return null;
  return (
    <span className={cn('text-muted-foreground inline-flex min-w-0 items-center gap-1.5 text-xs', className)} data-testid="bots-centro" title={centro.online ? t('bots.centro.on') : t('bots.centro.off')}>
      <Server className="size-3.5 shrink-0" /><span className="truncate">{t('bots.centro.where', { name: centro.name })}</span>
      <span className={cn('size-1.5 shrink-0 rounded-full', centro.online ? 'bg-success' : 'bg-muted-foreground/50')} aria-label={centro.online ? t('bots.centro.on') : t('bots.centro.off')} />
    </span>
  );
}

// 3.5: what the screens of the Bots mode share: the list of bots from the store, a bot's face (3.6: its avatar), whether this
// device may change bots, and the cards for «no bots yet» and «the bots do not answer».
import { useEffect } from 'react';
import { RefreshCw, Plus, ServerOff, Server } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Spinner } from '@/components/ui/basic.jsx';
import { useStore, bridge, go, loadBots, loadCentro } from '@/lib/store.js';
import { botsPrefix, canManageBots } from '@/lib/bots.js';
import { cn } from '@/lib/utils.js';
import { BotAvatar, GroupAvatar } from '@/components/bot-avatar.jsx';
import { useAvatarPulse, avatarState } from '@/lib/avatar-pulse.js';
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

// 3.6: a bot's face is its avatar (components/bot-avatar.jsx): working while its turn runs, paused when paused, a bounce
// on a new message and a hop when its card is approved (lib/avatar-pulse.js). size: xs 20, sm 24, md 36, lg 48, or px.
const FACE = { xs: 20, sm: 24, md: 36, lg: 48, xl: 64 };
export function BotFace({ bot, size = 'md', busy = false, state, still, chief = false, className, label }) {
  const pulse = useAvatarPulse(bot?.id);
  const px = typeof size === 'number' ? size : FACE[size] ?? FACE.md;
  return <BotAvatar bot={bot} size={px} state={state ?? avatarState({ pulse, paused: bot?.paused, busy })} still={still} chief={chief} label={label} className={className} data-testid="bot-avatar" />;
}
// A group's face: up to three of its members together.
export function GroupFace({ group, bots, size = 'md', className, label }) {
  const states = useStore((s) => s.botStates) ?? {};
  const byId = new Map((bots ?? []).map((b) => [b.id, b]));
  const members = (group?.members ?? []).map((m) => byId.get(Number(m?.id ?? m))).filter(Boolean);
  const px = typeof size === 'number' ? size : FACE[size] ?? FACE.md;
  return <GroupAvatar members={members} states={states} size={px} label={label} className={className} />;
}

// No bots at all: an invitation to make the first one (nothing comes made beyond the starter «Asistente»).
export function NoBots() {
  const t = useT();
  const manage = useCanManage();
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center" data-testid="bots-empty">
      <BotAvatar shape="mochi" color="cielo" size={72} />
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

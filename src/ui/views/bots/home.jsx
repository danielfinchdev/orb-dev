// 3.7 (WS4): one home per bot in the Bots zone. A bot runs on ONE Orb (this PC or the Orb Server); everywhere else it is a
// live, read-only copy (docs/BOTS.md › «One home per bot»). Here: the small badge of the list («Server» / «Este PC», grey
// when that Orb does not answer), the bar of a chat whose bot runs elsewhere («Se ejecuta en Server» + «Pasar aquí»),
// «Pasar al Server» / «Pasar a este PC» with the steps the move may ask for (a group, a brain, a takeover), the merge of
// two bots of the same name and the banner when the Server's Claude or Codex has signed out.
import { Server, Monitor, ArrowRightLeft, CloudOff, Clock, ArchiveRestore } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { confirm, choose } from '@/components/dialogs.jsx';
import { botCall, act, getState } from '@/lib/store.js';
import { homeOf, badgeOf, replicaActions, moveTargets, tn } from '@/lib/homes.js';
import { homesChanged } from '@/lib/bot-homes.js';
import { AGENT } from '@/lib/labels.js';
import { cn } from '@/lib/utils.js';
import { t as tNow, useT } from '@/lib/i18n.js';
import { toast } from 'sonner';

// The badge next to a chat's name: where its bot runs. Only once bots can run in two places (lib/homes.js › showHomeBadges).
export function HomeBadge({ bot, className }) {
  const t = useT();
  const b = badgeOf(bot, t);
  const Icon = b.kind === 'server' ? Server : Monitor;
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-px text-[10.5px] leading-4 font-medium', b.offline ? 'bg-muted text-muted-foreground' : b.kind === 'server' ? 'bg-primary/12 text-primary' : 'bg-muted text-foreground/70', className)}
      data-testid="home-badge" data-home={b.kind} data-offline={b.offline ? '1' : '0'} title={b.offline ? t('home.offlineTip', { name: b.text }) : t('home.runsOn', { name: b.text })}>
      {b.offline ? <CloudOff className="size-3" aria-hidden="true" /> : <Icon className="size-3" aria-hidden="true" />}{b.text}
      {b.offline ? <span className="sr-only">{t('home.offline')}</span> : null}
    </span>
  );
}

// «Pasar al Server» / «Pasar a este PC». The move may need the user: the bot is in a group (move the whole group, or take it
// out), the new home does not run its brain, or its home does not answer (take it over here, with the warning).
export async function moveBot(bot, target, { quiet = false } = {}) {
  const t = tNow;
  const to = target.here ? 'here' : target.key;
  const opts = {};
  for (let i = 0; i < 4; i++) {
    let r;
    const id = toast.loading(t('home.moving', { name: bot.name, to: target.here ? t('home.badge.here') : target.name }));
    try { r = await botCall('bots.move', { id: bot.id, to, ...opts }); } catch (e) { toast.dismiss(id); toast.error(String(e?.message ?? e)); return null; }
    toast.dismiss(id);
    if (r?.step === 'group') {
      const g = r.groups?.[0];
      const pick = await choose(t('home.groupTitle', { name: bot.name, group: g?.name ?? '' }), t('home.groupBody', { members: (g?.members ?? []).join(', ') }),
        [{ value: 'group', label: t('home.groupAll'), hint: t('home.groupAllHint') }, { value: 'leave', label: t('home.groupLeave'), hint: t('home.groupLeaveHint') }], { testid: 'move-group' });
      if (!pick) return null;
      opts.group = pick; continue;
    }
    if (r?.step === 'brain') {
      const brains = (r.brains ?? []).filter(Boolean);
      const pick = await choose(t('home.brainTitle', { name: bot.name }), t('home.brainBody', { agent: AGENT[r.agent] ?? r.agent }), brains.map((b) => ({ value: b, label: AGENT[b] ?? b })), { testid: 'move-brain' });
      if (!pick) return null;
      opts.brain = { agent: pick }; continue;
    }
    if (r?.step === 'confirm') {
      if (!(await confirm(t('home.takeoverTitle', { name: bot.name }), r.confirm, { ok: t('home.takeoverOk') }))) return null;
      opts.force = true; continue;
    }
    homesChanged();
    if (!r?.ok) { toast.error(t('home.moveFailed', { name: bot.name })); return r; }
    if (!quiet) toast.success(target.here ? t('home.movedHere', { name: bot.name }) : t('home.movedTo', { name: bot.name, to: target.here ? t('home.badge.server') : target.name }));
    if (!quiet && r.sameName?.uid) offerMerge({ id: r.id ?? bot.id, name: bot.name }, { uid: r.sameName.uid, name: r.sameName.name });
    if (!quiet && (r.sites?.length || r.missing?.connectors?.length || r.missing?.ha)) {
      const parts = [r.sites?.length ? t('home.reportSites', { list: r.sites.join(', ') }) : null, r.missing?.connectors?.length ? t('home.reportMissing', { list: r.missing.connectors.join(', ') }) : null, r.missing?.ha ? t('home.reportHa') : null].filter(Boolean);
      toast.info(t('home.reportTitle'), { description: parts.join('\n'), duration: 12000 });
    }
    return r;
  }
  return null;
}

// Two bots with the same name after a move: keep both (default) or merge them (the other's memory becomes proposals to
// review, its chat is archived). other: { uid, name } of the one that was there.
export async function offerMerge(survivor, other) {
  const t = tNow;
  const pick = await choose(t('home.sameTitle', { name: other.name }), t('home.sameBody'), [{ value: 'both', label: t('home.sameKeep'), variant: 'outline' }, { value: 'merge', label: t('home.sameMerge') }], { testid: 'merge-prompt', cancel: false });
  if (pick !== 'merge') return null;
  const list = getState().bots?.bots ?? [];
  const twin = list.find((b) => b.uid === other.uid);
  if (!twin) { toast.info(t('home.sameLater')); return null; }
  const r = await act(botCall('bots.merge', { survivor: survivor.id, other: twin.id }), t('home.merged', { name: survivor.name }));
  homesChanged();
  return r;
}

// The bar over the composer of a bot that runs elsewhere: where it runs, whether that Orb answers (what is written waits
// for it), and «Pasar aquí»; a frozen copy whose home is gone: «Restaurar aquí».
export function ReplicaBar({ bot, homes }) {
  const t = useT();
  const h = homeOf(bot);
  if (h.here) return null;
  const a = replicaActions(bot);
  const where = h.kind === 'server' ? t('home.badge.server') : h.name || t('home.badge.orb');
  const hereName = t('home.badge.here');
  const here = moveTargets(bot, homes).find((x) => x.here) ?? { here: true, key: 'here', name: hereName };
  const restore = async () => { if (await act(botCall('bots.restore', { id: bot.id }), t('home.restored', { name: bot.name }))) homesChanged(); };
  return (
    <div className={cn('mx-auto mb-2 flex w-full max-w-3xl items-center gap-2.5 rounded-xl border px-3 py-2 text-[13px]', h.online ? 'bg-muted/50' : 'border-warning/40 bg-warning/10')} data-testid="replica-bar" data-online={h.online ? '1' : '0'}>
      {a.restore ? <ArchiveRestore className="text-muted-foreground size-4 shrink-0" /> : !h.online ? <CloudOff className="text-warning size-4 shrink-0" /> : h.kind === 'server' ? <Server className="text-primary size-4 shrink-0" /> : <Monitor className="text-primary size-4 shrink-0" />}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{a.restore ? t('home.archived', { name: where }) : t('home.runsOn', { name: where })}</div>
        <div className="text-muted-foreground line-clamp-2 text-[12px]">
          {a.restore ? t('home.archivedHint') : h.online ? t('home.copyHint') : h.queued ? tn(t, 'home.queued', h.queued) : t('home.offlineHint', { name: where })}
        </div>
      </div>
      {a.restore ? <Button size="xs" variant="outline" onClick={restore} data-testid="replica-restore"><ArchiveRestore />{t('home.restore')}</Button>
        : a.move ? <Button size="xs" variant="outline" onClick={() => moveBot(bot, here)} data-testid="replica-move-here"><ArrowRightLeft />{t('home.moveHereShort')}</Button> : null}
    </div>
  );
}

// A line written to a bot whose home is off: shown at once, marked «Pendiente» until that Orb has it.
export function PendingMark() {
  const t = useT();
  return <span className="text-muted-foreground mt-1 flex items-center justify-end gap-1 text-[11.5px]" data-testid="line-pending"><Clock className="size-3" />{t('home.pending')}</span>;
}


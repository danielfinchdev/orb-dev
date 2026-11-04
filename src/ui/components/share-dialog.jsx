// 3.6 «Personas»: share a bot, a group or a project with other people of this Orb: to see it, to talk with it (or work
// in the project) or to change it. Only who may share it sees the button (the server checks it again). Also the badge
// «Compartido por Ana» and the list «Compartido conmigo».
import { useEffect, useState } from 'react';
import { Share2, LoaderCircle, Users } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, Select } from '@/components/ui/overlay.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Badge } from '@/components/ui/basic.jsx';
import { PersonDot } from '@/components/person-menu.jsx';
import { useStore, call, act, setState, go, refreshSoon, loadBotsSoon } from '@/lib/store.js';
import { RIGHTS, personsOn, shareRows, sharedWithMe, sharedBy } from '@/lib/persons.js';
import { cn } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';

// { type: 'bot' | 'group' | 'project', id, name, owner? }
export const openShare = (res) => setState({ share: res });

export function ShareButton({ type, id, name, owner, size = 'sm', className }) {
  const t = useT();
  const me = useStore((s) => s.me);
  const shared = useStore((s) => s.shared?.withMe);
  if (!personsOn(me) || id == null) return null;
  // The resource's person (or, on a shared one with «editar», they too: the server decides; the button just offers it).
  const mine = !owner || owner === me.person?.id;
  const edit = sharedBy(shared ?? [], type, id)?.right === 'edit';
  if (!mine && !edit) return null;
  return <Button size={size} variant="outline" className={className} onClick={() => openShare({ type, id, name, owner })} data-testid={`share-${type}`}><Share2 />{t('share.button')}</Button>;
}

export function ShareHost() {
  const t = useT();
  const res = useStore((s) => s.share);
  const me = useStore((s) => s.me);
  const [people, setPeople] = useState(null);
  const [shares, setShares] = useState([]);
  const [busy, setBusy] = useState(null);
  const load = async () => {
    if (!res) return;
    const [p, s] = await Promise.all([call('persons.list').catch(() => []), call('shares.list', { type: res.type, id: String(res.id) }).catch(() => [])]);
    setPeople(p); setShares(s);
  };
  useEffect(() => { setPeople(null); setShares([]); load(); }, [res?.type, res?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!res) return null;
  const rows = shareRows(people ?? [], shares, { me: me?.person?.id, owner: res.owner ?? null });
  const change = async (person, right) => {
    setBusy(person);
    const ok = right === 'none'
      ? await act(call('shares.remove', { type: res.type, id: String(res.id), person }), t('share.removed'))
      : await act(call('shares.set', { type: res.type, id: String(res.id), person, right }), t('share.saved'));
    setBusy(null);
    if (ok) { load(); refreshSoon(); if (res.type !== 'project') loadBotsSoon(); }
  };
  const options = [{ value: 'none', label: t('share.right.none') }, ...RIGHTS.map((r) => ({ value: r, label: t(`share.right.${r}`) }))];
  return (
    <Dialog open onOpenChange={(o) => { if (!o) setState({ share: null }); }}>
      <DialogContent data-testid="share-dialog" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t('share.title', { name: res.name ?? '' })}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-1.5">
          {people == null ? <LoaderCircle className="text-muted-foreground mx-auto size-5 animate-spin" />
            : !rows.length ? <p className="text-muted-foreground text-sm">{t('share.nobody')}</p>
              : rows.map((p) => (
                <div key={p.id} className="flex items-center gap-3 rounded-xl border px-3 py-2" data-testid={`share-row-${p.name}`}>
                  <PersonDot name={p.name} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
                  {busy === p.id ? <LoaderCircle className="text-muted-foreground size-4 animate-spin" /> : null}
                  <Select className="w-40" value={p.right ?? 'none'} onValueChange={(v) => change(p.id, v)} options={options} title={t('share.rightFor', { name: p.name })} data-testid={`share-right-${p.name}`} />
                </div>
              ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// «Compartido por Ana» on something of someone else.
export function SharedBadge({ type, id, className }) {
  const t = useT();
  const shared = useStore((s) => s.shared?.withMe);
  const s = sharedBy(shared ?? [], type, id);
  if (!s) return null;
  return <Badge variant="secondary" className={cn('font-normal', className)} title={t(`share.right.${s.right}`)} data-testid="shared-badge">{t('share.by', { name: s.by })}</Badge>;
}

// The sidebar's «Compartido conmigo»: what others shared with this person, each opening its screen.
export function SharedWithMe({ kinds = ['project', 'bot', 'group'], className }) {
  const t = useT();
  const shared = useStore((s) => s.shared?.withMe);
  const bots = useStore((s) => s.bots);
  const projects = useStore((s) => s.projects);
  const list = sharedWithMe(shared ?? [], { bots: bots?.bots ?? [], groups: bots?.groups ?? [], projects }).filter((x) => kinds.includes(x.type));
  if (!list.length) return null;
  const open = (x) => (x.type === 'project' ? go({ view: 'projects', project: x.name }) : x.type === 'bot' ? go({ view: 'bot-chat', id: Number(x.id) }) : go({ view: 'bot-group', id: Number(x.id) }));
  return (
    <div className={cn('pt-3', className)} data-testid="shared-with-me">
      <div className="text-muted-foreground flex items-center gap-1.5 px-2.5 pb-1 text-[11px] tracking-wide uppercase"><Users className="size-3" />{t('share.withMe')}<span className="opacity-70">· {list.length}</span></div>
      <div className="grid gap-px">
        {list.map((x) => (
          <button key={`${x.type}:${x.id}`} type="button" onClick={() => open(x)} className="hover:bg-accent/60 flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px]" data-testid={`shared-${x.type}-${x.name}`}>
            <span className="w-4 shrink-0 text-center">{x.icon || (x.type === 'project' ? '📁' : x.type === 'group' ? '👥' : '🤖')}</span>
            <span className="min-w-0 flex-1 truncate">{x.name}</span>
            <span className="text-muted-foreground shrink-0 text-[11px]">{t('share.by', { name: x.by })}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

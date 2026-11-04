// 3.6 (messaging, M2): «Nuevo grupo», as in a messaging app. 1) choose several bots (and, with more users, people to
// share it with: they can talk in it); 2) its name, with the group's avatar made of its members' together. A dialog on the
// PC, the whole screen on the phone (a glass sheet on Android). Opened with setState({ newGroup: true }).
import { useMemo, useState } from 'react';
import { ArrowLeft, Check, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Field, Input } from '@/components/ui/basic.jsx';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/overlay.jsx';
import { GroupAvatar } from '@/components/bot-avatar.jsx';
import { useStore, setState, botCall, act, go, loadBots, loadInboxSoon, phoneLayout } from '@/lib/store.js';
import { personsOn } from '@/lib/persons.js';
import { cn } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';
import { useBots, BotFace } from './common.jsx';

export function NewGroupHost() {
  const open = useStore((s) => Boolean(s.newGroup));
  return open ? <NewGroup onClose={() => setState({ newGroup: null })} /> : null;
}

function PersonDot({ name, size = 40 }) {
  return <span className="bg-primary/12 text-primary grid shrink-0 place-items-center rounded-full font-semibold" style={{ width: size, height: size, fontSize: size * 0.4 }} aria-hidden="true">{String(name ?? '?').trim().charAt(0).toUpperCase()}</span>;
}

function NewGroup({ onClose }) {
  const t = useT();
  const phone = phoneLayout();
  const { bots } = useBots();
  const me = useStore((s) => s.me);
  const people = useStore((s) => s.people ?? []);
  const others = personsOn(me) ? people.filter((p) => p.id !== me?.person?.id && !p.disabled) : [];
  const [step, setStep] = useState(1);
  const [chosen, setChosen] = useState([]);
  const [folks, setFolks] = useState([]);
  const [name, setName] = useState('');
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState(false);
  const members = useMemo(() => chosen.map((id) => bots.find((b) => b.id === id)).filter(Boolean), [chosen, bots]);
  const toggle = (list, set, id) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const fold = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const shownBots = bots.filter((b) => fold(b.name).includes(fold(q)));
  const shownPeople = others.filter((p) => fold(p.name).includes(fold(q)));
  const create = async (e) => {
    e?.preventDefault();
    if (!name.trim() || !chosen.length || saving) return;
    setSaving(true);
    const g = await act(botCall('bots.groups.create', { name: name.trim(), members: chosen, ...(folks.length ? { people: folks } : {}) }), t('chats.groupCreated'));
    setSaving(false);
    if (g) { await loadBots(); loadInboxSoon(0); onClose(); go({ view: 'bot-group', id: g.id }); }
  };
  const row = (key, on, onClick, avatar, label, hint, testid) => (
    <button key={key} type="button" role="checkbox" aria-checked={on} onClick={onClick} data-testid={testid}
      className={cn('press flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-xl px-2.5 py-1.5 text-left', on ? 'bg-accent' : 'hover:bg-accent/50')}>
      {avatar}
      <span className="min-w-0 flex-1"><span className="block truncate text-[14.5px] font-medium">{label}</span>{hint ? <span className="text-muted-foreground block truncate text-[12.5px]">{hint}</span> : null}</span>
      <span className={cn('grid size-5 shrink-0 place-items-center rounded-full border', on ? 'bg-primary border-primary text-primary-foreground' : 'border-input')}>{on ? <Check className="size-3.5" /> : null}</span>
    </button>
  );
  const head = (title, back) => (
    <div className="grid grid-cols-[40px_1fr_40px] items-center">
      {back ? <Button type="button" size="icon" variant="ghost" onClick={back} aria-label={t('bots.back')} data-testid="group-back"><ArrowLeft /></Button>
        : phone ? <Button type="button" size="icon" variant="ghost" onClick={onClose} aria-label={t('bots.cancel')}><X /></Button> : <span />}
      <DialogTitle className="text-center text-base font-semibold">{title}</DialogTitle>
    </div>
  );
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent data-sheet="full" showClose={!phone} className={phone ? 'flex flex-col gap-4' : 'gap-4 sm:max-w-[440px]'} data-testid="group-create">
        <DialogDescription className="sr-only">{t('chats.groupHint')}</DialogDescription>
        {step === 1 ? (<>
          {head(t('bots.groups.new'))}
          <p className="text-muted-foreground -mt-1 text-center text-[13px]">{chosen.length || folks.length ? t('chats.groupChosen', { n: chosen.length + folks.length }) : t('chats.groupPick')}</p>
          {members.length || folks.length ? (
            <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]" data-testid="group-chosen">
              {members.map((b) => <button key={b.id} type="button" className="grid w-14 shrink-0 cursor-pointer justify-items-center gap-0.5" onClick={() => toggle(chosen, setChosen, b.id)} aria-label={t('chats.groupRemove', { name: b.name })}><BotFace bot={b} size={40} still /><span className="max-w-full truncate text-[11px]">{b.name}</span></button>)}
              {folks.map((id) => { const p = others.find((x) => x.id === id); return <button key={id} type="button" className="grid w-14 shrink-0 cursor-pointer justify-items-center gap-0.5" onClick={() => toggle(folks, setFolks, id)} aria-label={t('chats.groupRemove', { name: p?.name })}><PersonDot name={p?.name} /><span className="max-w-full truncate text-[11px]">{p?.name}</span></button>; })}
            </div>
          ) : null}
          <label className="flex h-10 items-center gap-2 rounded-lg border px-2.5"><Search className="text-muted-foreground size-4" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('chats.searchBots')} aria-label={t('chats.searchBots')} className="min-w-0 flex-1 bg-transparent text-[15px] outline-none" /></label>
          <div className={cn('grid content-start gap-0.5 overflow-y-auto', phone ? 'min-h-0 flex-1' : 'max-h-[46vh]')} data-testid="group-members">
            {shownBots.length ? <div className="text-muted-foreground px-2.5 pt-1 text-[11px] font-medium tracking-wide uppercase">{t('nav.bots')}</div> : null}
            {shownBots.map((b) => row(`b${b.id}`, chosen.includes(b.id), () => toggle(chosen, setChosen, b.id), <BotFace bot={b} size={40} still chief={b.is_chief} />, b.name, b.role_text, `group-pick-${b.name}`))}
            {shownPeople.length ? <div className="text-muted-foreground px-2.5 pt-3 text-[11px] font-medium tracking-wide uppercase">{t('chats.groupPeople')}</div> : null}
            {shownPeople.map((p) => row(`p${p.id}`, folks.includes(p.id), () => toggle(folks, setFolks, p.id), <PersonDot name={p.name} />, p.name, t('chats.groupPersonHint'), `group-person-${p.name}`))}
          </div>
          <div className="flex justify-end gap-2">
            {phone ? null : <Button type="button" variant="ghost" onClick={onClose}>{t('bots.cancel')}</Button>}
            <Button type="button" disabled={!chosen.length} onClick={() => setStep(2)} className={phone ? 'h-12 w-full rounded-[14px] text-[15px]' : undefined} data-testid="group-next">{t('chats.next')}</Button>
          </div>
        </>) : (
          <form onSubmit={create} className="contents">
            {head(t('bots.groups.new'), () => setStep(1))}
            <div className="grid justify-items-center gap-2" data-testid="group-preview">
              <GroupAvatar members={members} size={phone ? 120 : 104} label={name.trim() ? t('bots.av.group', { name: name.trim() }) : undefined} />
              <p className="text-muted-foreground text-center text-[13px]">{[...members.map((b) => b.name), ...folks.map((id) => others.find((x) => x.id === id)?.name)].filter(Boolean).join(', ')}</p>
            </div>
            <Field label={t('chats.groupName')}><Input autoFocus={!phone} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder={t('bots.groups.namePh')} className="h-11 text-base" data-testid="group-name" /></Field>
            <p className="text-muted-foreground text-xs">{t('chats.groupMentionHint')}</p>
            {phone ? <div className="flex-1" /> : null}
            <div className="flex justify-end gap-2">
              {phone ? null : <Button type="button" variant="ghost" onClick={onClose}>{t('bots.cancel')}</Button>}
              <Button type="submit" disabled={saving || !name.trim()} className={phone ? 'h-12 w-full rounded-[14px] text-[15px]' : undefined} data-testid="group-create-ok">{t('chats.createGroup')}</Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

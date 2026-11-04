// 3.6 «Personas»: who is using Orb here. With two or more people, the top of the menu says who («Ana ▾»): switch to
// someone else on this PC (their PIN, if they have one), open «Mi perfil» or lock. On a phone or a browser the device is
// of one person: the menu only says who and locks it. With one person, nothing of this shows.
import { Lock, UserRound, ChevronDown, Check, ArrowLeftRight } from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel } from '@/components/ui/overlay.jsx';
import { Input } from '@/components/ui/basic.jsx';
import { form } from '@/components/dialogs.jsx';
import { useStore, call, bridge, setState, go, openSettings, personSwitched } from '@/lib/store.js';
import { personsOn, initials, pinRefusal } from '@/lib/persons.js';
import { cn } from '@/lib/utils.js';
import { t, useT } from '@/lib/i18n.js';
import { useEffect, useState } from 'react';

// A round badge with the person's initials (and their colour, if they chose one).
export function PersonDot({ name, color, size = 'md', className }) {
  return <span className={cn('bg-primary/15 text-primary grid shrink-0 place-items-center rounded-full font-medium', size === 'sm' ? 'size-5 text-[9.5px]' : 'size-7 text-[11px]', className)} style={color ? { background: color, color: '#fff' } : undefined} aria-hidden>{initials(name)}</span>;
}

// The PIN of someone (4–12 digits), asked in a dialog; send(pin) answers like persons.verifyPin (ok, or why not).
export function askPin({ title, description, send }) {
  return form(title, {
    description,
    initial: { pin: '' },
    body: (v, set) => <Input autoFocus type="password" inputMode="numeric" autoComplete="off" maxLength={12} value={v.pin} onChange={(e) => set({ pin: e.target.value.replace(/\D/g, '') })} aria-label={t('persons.pin.label')} data-testid="pin-input" />,
    ok: t('persons.pin.ok'),
    onOk: async (v) => {
      const r = await send(v.pin);
      const why = pinRefusal(r);
      if (why) throw new Error(t(why.key, why.vars));
      return r;
    }
  });
}

// This PC's window changes person: with their PIN when they have one (the engine checks it).
export async function switchTo(p) {
  const send = (pin) => call('persons.switch', { id: p.id, pin });
  const r = p.hasPin ? await askPin({ title: t('persons.switchTitle', { name: p.name }), description: t('persons.switchPin'), send }) : await send(null).catch((e) => ({ ok: false, error: e }));
  if (r?.ok) await personSwitched();
  return r;
}
export const lockNow = () => (bridge.mobile ? setState({ phoneLocked: true }) : call('persons.lock').then(() => setState({ locked: { locked: true } })).catch(() => {}));

export function PersonMenu({ className, compact = false }) {
  const tr = useT();
  const me = useStore((s) => s.me);
  const [people, setPeople] = useState([]);
  useEffect(() => { if (personsOn(me) && !bridge.mobile) call('persons.list').then(setPeople).catch(() => setPeople([])); }, [me?.person?.id, me?.personsCount]);
  if (!personsOn(me) || !me.person) return null;
  const others = people.filter((p) => p.id !== me.person.id);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={cn('no-drag hover:bg-accent flex min-w-0 cursor-pointer items-center gap-1.5 rounded-lg px-1.5 py-1 text-[13px]', className)} aria-label={tr('persons.menu', { name: me.person.name })} data-testid="person-menu">
          <PersonDot name={me.person.name} color={me.person.color} size="sm" />
          {compact ? null : <span className="max-w-24 truncate font-medium" data-testid="person-menu-name">{me.person.name}</span>}
          <ChevronDown className="text-muted-foreground size-3.5 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel>{tr('persons.connectedAs', { name: me.person.name })}</DropdownMenuLabel>
        {/* Switching person is this PC's own: a phone or a browser is of one person. */}
        {!bridge.mobile && others.length ? <>
          <DropdownMenuSeparator />
          {others.map((p) => (
            <DropdownMenuItem key={p.id} onSelect={() => switchTo(p)} data-testid={`person-switch-${p.name}`}>
              <ArrowLeftRight className="size-4" />{tr('persons.switchTo', { name: p.name })}{p.hasPin ? <Lock className="text-muted-foreground ml-auto size-3.5" /> : null}
            </DropdownMenuItem>
          ))}
        </> : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => (bridge.mobile ? go('profile') : openSettings('perfil'))} data-testid="person-profile"><UserRound className="size-4" />{tr('persons.myProfile')}</DropdownMenuItem>
        {/* A phone locks only with a PIN (without one there is nothing to unlock with). */}
        {!bridge.mobile || me.person.hasPin ? <DropdownMenuItem onSelect={lockNow} data-testid="person-lock"><Lock className="size-4" />{tr('persons.lock')}</DropdownMenuItem> : null}
        {me.role === 'owner' ? <DropdownMenuItem disabled><Check className="size-4" />{tr('persons.role.owner')}</DropdownMenuItem> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// On a phone, at the top: «Conectado como Ana» (the device is hers; the server says whose).
export function ConnectedAs({ className }) {
  const tr = useT();
  const me = useStore((s) => s.me);
  if (!personsOn(me) || !me.person) return null;
  return (
    <div className={cn('text-muted-foreground flex items-center justify-center gap-1.5 text-[11.5px]', className)} data-testid="connected-as">
      <span className="truncate">{tr('persons.connectedAs', { name: me.person.name })}</span>
      <PersonMenu compact className="px-1 py-0.5" />
    </div>
  );
}

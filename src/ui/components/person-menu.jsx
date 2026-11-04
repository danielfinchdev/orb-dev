// 3.6 «Personas»: who is using Orb here. With two or more users, the bottom of the sidebar shows them (avatar and name,
// like most apps); a click opens «Mi perfil», «Cambiar de usuario» and «Bloquear». On a phone the same is at the top of
// «Más». A phone or a browser is of one user: it cannot change user, only lock (with a PIN). With one user, nothing shows.
import { Fragment } from 'react';
import { Lock, UserRound, ChevronsUpDown, ArrowLeftRight, ChevronRight } from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/overlay.jsx';
import { Badge } from '@/components/ui/basic.jsx';
import { Input } from '@/components/ui/basic.jsx';
import { form } from '@/components/dialogs.jsx';
import { NavItem } from '@/components/sidebar.jsx';
import { useStore, call, bridge, setState, getState, go, openSettings, modeOf } from '@/lib/store.js';
import { personsOn, initials, pinRefusal, isOwner } from '@/lib/persons.js';
import { cn } from '@/lib/utils.js';
import { t, useT } from '@/lib/i18n.js';

// A round badge with the user's initials (and their colour, if they chose one).
export function PersonDot({ name, color, size = 'md', className }) {
  const sizes = { sm: 'size-5 text-[9.5px]', md: 'size-7 text-[11px]', lg: 'size-10 text-sm' };
  return <span className={cn('bg-primary/15 text-primary grid shrink-0 place-items-center rounded-full font-medium', sizes[size] ?? sizes.md, className)} style={color ? { background: color, color: '#fff' } : undefined} aria-hidden>{initials(name)}</span>;
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

// Locking this PC shows who may come in (the engine keeps it locked); «Cambiar de usuario» is the same screen with
// someone else chosen. A phone only locks itself.
export function lockNow(switching = false) {
  if (bridge.mobile) return setState({ phoneLocked: true });
  // The screen first (the engine's «locked» event may come before the answer), then the engine's lock.
  setState({ locked: { locked: true, switching } });
  return call('persons.lock').catch(() => setState({ locked: false }));
}

// What the menu holds, for the sidebar and for the phone's «Más».
function useActions() {
  const me = useStore((s) => s.me);
  if (!personsOn(me) || !me.person) return null;
  return [
    { id: 'person-profile', icon: UserRound, label: t('persons.myProfile'), run: () => (bridge.mobile ? go({ view: 'profile', ...(modeOf(getState().route) === 'bots' ? { mode: 'bots' } : {}) }) : openSettings('perfil')) },
    ...(bridge.mobile ? [] : [{ id: 'person-switch', icon: ArrowLeftRight, label: t('persons.switchUser'), run: () => lockNow(true) }]),
    // Without a PIN a phone has nothing to unlock with.
    ...(!bridge.mobile || me.person.hasPin ? [{ id: 'person-lock', icon: Lock, label: t('persons.lock'), run: () => lockNow() }] : [])
  ];
}

// The sidebar's footer: avatar and name; the menu opens upwards.
export function PersonMenu({ className }) {
  useT();
  const me = useStore((s) => s.me);
  const actions = useActions();
  if (!actions) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={cn('side-user hover:bg-accent/60 flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left text-[14px]', className)} aria-label={t('persons.menu', { name: me.person.name })} data-testid="person-menu">
          <PersonDot name={me.person.name} color={me.person.color} />
          <span className="min-w-0 flex-1 truncate font-medium" data-testid="person-menu-name">{me.person.name}</span>
          <ChevronsUpDown className="text-muted-foreground size-4 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-(--radix-dropdown-menu-trigger-width) min-w-52">
        {/* 3.6: who is here and whether they are the admin, as the menu's header. */}
        <DropdownMenuLabel className="flex min-w-0 items-center gap-2.5 py-2 text-foreground" data-testid="person-menu-header">
          <PersonDot name={me.person.name} color={me.person.color} />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{me.person.name}</span>
          {isOwner(me) ? <Badge variant="secondary">{t('persons.role.owner')}</Badge> : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {actions.map((a) => (<Fragment key={a.id}>{a.id === 'person-lock' ? <DropdownMenuSeparator /> : null}<DropdownMenuItem onSelect={a.run} data-testid={a.id}><a.icon className="size-4" />{a.label}</DropdownMenuItem></Fragment>))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// The phone's «Más», at the top: who this device is of, and the same actions.
export function PersonCard() {
  useT();
  const me = useStore((s) => s.me);
  const actions = useActions();
  if (!actions) return null;
  const profile = actions.find((a) => a.id === 'person-profile');
  const rest = actions.filter((a) => a !== profile);
  return (
    <div className="bg-card/80 grid gap-0.5 rounded-2xl border p-2" data-testid="person-card">
      {/* 3.6: the name row opens «Mi perfil»; below it, only what else applies (Bloquear). */}
      <button type="button" onClick={profile.run} className="hover:bg-accent/60 flex min-w-0 cursor-pointer items-center gap-3 rounded-xl px-2 py-2 text-left" data-testid="nav-profile" aria-label={t('persons.myProfile')}>
        <PersonDot name={me.person.name} color={me.person.color} size="lg" />
        <span className="grid min-w-0 flex-1 leading-tight"><span className="truncate text-[16px] font-medium" data-testid="person-card-name">{me.person.name}</span><span className="text-muted-foreground text-xs">{t('persons.myProfile')}</span></span>
        <ChevronRight className="text-muted-foreground size-4 shrink-0" />
      </button>
      {rest.map((a) => <NavItem key={a.id} icon={a.icon} label={a.label} onClick={a.run} testid={a.id} />)}
    </div>
  );
}

// 3.6 «Personas»: who is using Orb here. With two or more users, the gear at the foot of the sidebar shows the user's
// initial and opens Ajustes, «Mi perfil», «Cambiar de usuario» and «Bloquear». On a phone the same is in the menu ☰. A phone or a browser is of one user: it cannot change user, only lock (with a PIN). With one user, nothing shows.
import { Fragment } from 'react';
import { Lock, UserRound, ArrowLeftRight, ChevronRight, Settings, MonitorSmartphone, Link2 } from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, BubbleTip } from '@/components/ui/overlay.jsx';
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

// 3.6: a linked browser has no Ajustes of the PC: its gear (the same slot and icon as on the PC) opens what it does have,
// this device's settings and Magic Link.
function browserSettings() {
  return [
    { id: 'nav-device', icon: MonitorSmartphone, label: t('nav.thisDevice'), run: () => go('phone') },
    { id: 'nav-link', icon: Link2, label: t('link.title'), run: () => go('link') }
  ];
}

// The gear of a linked browser with one user: the PC's icon, with a small menu instead of the PC's Ajustes.
export function BrowserSettingsMenu({ list = false, active = false }) {
  useT();
  const label = t('nav.settings');
  return (
    <DropdownMenu>
      {list ? (
        <DropdownMenuTrigger asChild>
          <button type="button" className={cn('group flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[14px]', active ? 'bg-accent text-accent-foreground' : 'text-foreground/80 hover:bg-accent/60 hover:text-foreground')} data-testid="nav-settings">
            <Settings className={cn('size-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground')} /><span className="min-w-0 flex-1 truncate">{label}</span>
          </button>
        </DropdownMenuTrigger>
      ) : (
        <BubbleTip title={label} side="top">
          <DropdownMenuTrigger asChild>
            <button type="button" className={cn('side-foot-icon', active && 'is-active')} aria-label={label} data-testid="nav-settings"><Settings className="size-4" /></button>
          </DropdownMenuTrigger>
        </BubbleTip>
      )}
      <DropdownMenuContent side="top" align="start" className="min-w-52">
        {browserSettings().map((a) => <DropdownMenuItem key={a.id} onSelect={a.run} data-testid={a.id}><a.icon className="size-4" />{a.label}</DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// The sidebar's footer (3.6, owner's correction): the footer stays as in 3.5; with two or more users the gear of Ajustes
// shows the current user's initial instead, and opens a small menu upwards: Ajustes, Mi perfil, Cambiar de usuario and
// Bloquear. With one user this returns null and the footer keeps its plain gear (Ajustes straight away).
// list: the footer unfolded (a row with the name, like the other rows) instead of the icon.
export function PersonMenu({ list = false, active = false }) {
  useT();
  const me = useStore((s) => s.me);
  const actions = useActions();
  if (!actions) return null;
  const label = t('persons.menu', { name: me.person.name });
  // A linked browser has no Ajustes (the PC's): this device and Magic Link in their place.
  const items = [...(bridge.mobile ? browserSettings() : [{ id: 'nav-settings', icon: Settings, label: t('nav.settings'), run: () => openSettings() }]), ...actions];
  const trigger = list ? (
    <button type="button" className={cn('hover:bg-accent/60 flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[14px]', active && 'bg-accent text-accent-foreground')} aria-label={label} data-testid="person-menu">
      <PersonDot name={me.person.name} color={me.person.color} size="sm" /><span className="min-w-0 flex-1 truncate">{t('nav.settings')}</span><span className="sr-only" data-testid="person-menu-name">{me.person.name}</span>
    </button>
  ) : (
    <button type="button" className={cn('side-foot-icon', active && 'is-active')} aria-label={label} data-testid="person-menu">
      <PersonDot name={me.person.name} color={me.person.color} size="sm" /><span className="sr-only" data-testid="person-menu-name">{me.person.name}</span>
    </button>
  );
  return (
    <DropdownMenu>
      {list ? <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger> : <BubbleTip title={t('nav.settings')} text={me.person.name} side="top"><DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger></BubbleTip>}
      <DropdownMenuContent side="top" align="start" className="min-w-52">
        {/* Who is here and whether they are the admin, as the menu's header. */}
        <DropdownMenuLabel className="flex min-w-0 items-center gap-2.5 py-2 text-foreground" data-testid="person-menu-header">
          <PersonDot name={me.person.name} color={me.person.color} />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{me.person.name}</span>
          {isOwner(me) ? <Badge variant="secondary">{t('persons.role.owner')}</Badge> : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items.map((a) => (<Fragment key={a.id}>{a.id === 'person-lock' ? <DropdownMenuSeparator /> : null}<DropdownMenuItem onSelect={a.run} data-testid={a.id}><a.icon className="size-4" />{a.label}</DropdownMenuItem></Fragment>))}
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

// 3.6, the phone (browser and Android app): the menu ☰ at the top left of every screen opens a drawer from the left edge
// with, in this order: Orb | Bots, who is using this device (with two or more users), the mode's other screens and the
// phone's own settings. The bottom tabs are the four main screens of the current mode. The PC keeps its sidebar.
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Menu, X, CalendarClock, PenTool, BookOpen, GraduationCap, Smartphone, Moon, Users, Server, Settings2, Radar, Bot } from 'lucide-react';
import { useState } from 'react';
import { NavItem } from './sidebar.jsx';
import { Switch } from './ui/overlay.jsx';
import { ModeSwitch } from './mode-switch.jsx';
import { PersonCard } from './person-menu.jsx';
import { Robot } from './robot.jsx';
import { useStore, go, applyTheme, isDark, modeOf } from '@/lib/store.js';
import { useT } from '@/lib/i18n.js';
import { unreadOf } from '@/lib/inbox.js';

const Group = ({ label, children, testid }) => (
  <section className="grid gap-1" data-testid={testid}>
    {label ? <h2 className="text-muted-foreground px-3 text-[11px] font-medium tracking-wide uppercase">{label}</h2> : null}
    <div className="bg-card/80 grid gap-0.5 rounded-2xl border p-2">{children}</div>
  </section>
);

// What used to be «Más»: the screens of the mode that are not tabs, then this phone's settings.
export function MoreContent() {
  const t = useT();
  const bots = useStore((s) => modeOf(s.route)) === 'bots';
  const mode = bots ? { mode: 'bots' } : {};
  const [dark, setDark] = useState(isDark);
  const night = (on) => { const next = on ? 'oscuro' : 'claro'; applyTheme(next); setDark(on); try { localStorage.setItem('orb.theme', next); } catch { /* storage unavailable */ } };
  return (
    <>
      {/* 3.6: with two or more users, whose this device is. */}
      <PersonCard />
      {bots ? (
        <Group testid="mobile-more-bots">
          {/* 3.6 (M2): what is not a tab (Chats · Recordatorios · Casa): Memoria, Servidor, then all the bots, the groups and
              the bots' settings. */}
          <NavItem icon={BookOpen} label={t('nav.botMemory')} onClick={() => go('bot-memory')} testid="nav-bot-memory" />
          <NavItem icon={Server} label={t('nav.botServer')} onClick={() => go('bot-server')} testid="nav-bot-server" />
          <NavItem icon={Bot} label={t('nav.bots')} onClick={() => go('bots')} testid="nav-bots" />
          <NavItem icon={Users} label={t('nav.botGroups')} onClick={() => go('bot-groups')} testid="nav-bot-groups" />
          <NavItem icon={Settings2} label={t('nav.botSettings')} onClick={() => go('bot-settings')} testid="nav-bot-settings" />
        </Group>
      ) : (
        <Group>
          <NavItem icon={CalendarClock} label={t('nav.schedules')} onClick={() => go('schedules')} testid="nav-schedules" />
          <NavItem icon={PenTool} label={t('nav.board')} onClick={() => go('board')} testid="nav-board" />
          <NavItem icon={BookOpen} label={t('nav.memories')} onClick={() => go('logs')} testid="nav-memories" />
          <NavItem icon={GraduationCap} label={t('nav.tutorials')} onClick={() => go('tutorials')} testid="nav-tutorials" />
        </Group>
      )}
      <Group label={t('nav.settings')}>
        <NavItem icon={Smartphone} label={t('nav.phone')} onClick={() => go({ view: 'phone', ...mode })} testid="nav-phone" />
        <NavItem icon={Radar} label={t('link.title')} onClick={() => go({ view: 'link', ...mode })} testid="nav-link" />
        <label className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[14px]">
          <Moon className="text-muted-foreground size-4 shrink-0" /><span className="flex-1">{t('nav.darkMode')}</span>
          <Switch checked={dark} onCheckedChange={night} data-testid="mobile-dark" />
        </label>
      </Group>
    </>
  );
}

// The ☰ button and its drawer. Any choice inside closes it (a click on a button or a link, or a new mode).
export function MobileMenu() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const name = useStore((s) => s.app?.config?.assistantName ?? 'Orb');
  // 3.6 (M2, M3): new messages of the other zone: a dot on ☰ (the switch inside says how many).
  const otherUnread = useStore((s) => (modeOf(s.route) !== 'bots' ? unreadOf(s.inbox) : unreadOf(s.orbInbox)) > 0);
  const close = (e) => { if (e.target.closest('button:not([role=switch]), a')) setTimeout(() => setOpen(false), 60); };
  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <button type="button" className="press hover:bg-accent relative -ml-2 grid size-10 shrink-0 cursor-pointer place-items-center rounded-xl" aria-label={t('app.menu')} data-testid="nav-menu"><Menu className="size-5" />{otherUnread ? <span className="bg-primary absolute top-2 right-2 size-2 rounded-full" data-testid="nav-menu-dot" /> : null}</button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay data-slot="dialog-overlay" className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/40" />
        <DialogPrimitive.Content data-slot="drawer-content" onClick={close} aria-describedby={undefined}
          className="bg-sidebar text-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left fixed inset-y-0 left-0 z-50 flex w-[min(20rem,86vw)] flex-col gap-4 overflow-y-auto border-r px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl duration-300 ease-(--ease-drawer)" data-testid="mobile-menu">
          <div className="flex items-center gap-2.5 px-1">
            <Robot size={28} mood="idle" />
            <DialogPrimitive.Title className="min-w-0 flex-1 truncate text-[16px] font-medium">{name}</DialogPrimitive.Title>
            <DialogPrimitive.Close className="press hover:bg-accent -mr-2 grid size-10 cursor-pointer place-items-center rounded-xl" aria-label={t('comp.close')}><X className="size-5" /></DialogPrimitive.Close>
          </div>
          <ModeSwitch />
          <MoreContent />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

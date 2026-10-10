// Agents: which CLIs are installed, their login, models and how much of each subscription window is used.
import { useEffect, useState } from 'react';
import { Bot, RefreshCw, LogIn, ChevronRight, ExternalLink, UserPlus, Trash2, FolderOpen } from 'lucide-react';
import { confirm, form } from '@/components/dialogs.jsx';
import { Installer } from '@/components/installer.jsx';
import { PageHeader } from '@/components/page.jsx';
import { AgentIcon } from '@/components/agent-icon.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Badge, Card, CardContent, CardHeader, CardTitle, CardDescription, Field, Input, PathText, Spinner } from '@/components/ui/basic.jsx';
import { Switch, Collapsible, CollapsibleTrigger, CollapsibleContent, BubbleTip } from '@/components/ui/overlay.jsx';
import { cn } from '@/lib/utils.js';
import { useStore, call, act, bridge, setState, getState } from '@/lib/store.js';
import { LOGIN } from '@/lib/labels.js';
import { t, useT, useLocale } from '@/lib/i18n.js';

const INSTALL = { claude: 'https://docs.claude.com/en/docs/claude-code/setup', codex: 'https://developers.openai.com/codex/cli', cursor: 'https://cursor.com/cli',
  gemini: 'https://github.com/google-gemini/gemini-cli', opencode: 'https://opencode.ai', qwen: 'https://github.com/QwenLM/qwen-code', copilot: 'https://github.com/github/copilot-cli' };
const WINDOW = { five_hour: 'agents.win.fiveHour', seven_day: 'agents.win.week', seven_day_opus: 'agents.win.weekOpus', seven_day_sonnet: 'agents.win.weekSonnet', '300min': 'agents.win.fiveHour', '10080min': 'agents.win.week', '43200min': 'agents.win.month' };
const windowLabel = (w) => (WINDOW[w] ? t(WINDOW[w]) : w);
// How each agent is connected (2.3: all of them live).
const KIND = { sdk: 'agents.kind.sdk', 'app-server': 'agents.kind.appServer', 'cli-stream': 'agents.kind.cliStream', acp: 'agents.kind.acp' };

async function save(agent, patch) {
  const config = await act(call('config.save', { patch: { agents: { [agent]: patch } } }), t('agents.saved'));
  if (config) setState({ app: { ...getState().app, config } });
  return config;
}

// The subscriptions of one agent: each with its own login folder, so two Codex or three Claude accounts never mix.
function Accounts({ a, reload }) {
  const t = useT();
  const add = async () => {
    const r = await form(t('agents.addAccountTitle', { label: a.label }), {
      description: t('agents.addAccountDesc'),
      initial: { label: `${a.label} ${a.accounts.length + 1}`, home: '' },
      body: (v, set) => (<>
        <Field label={t('agents.accountName')}><Input autoFocus value={v.label} onChange={(e) => set({ label: e.target.value })} maxLength={60} /></Field>
        <Field label={t('agents.sessionFolder')} hint={v.home ? t('agents.folderHintCustom') : t('agents.folderHintEmpty')}>
          <div className="flex gap-2"><Input value={v.home} onChange={(e) => set({ home: e.target.value })} placeholder={t('agents.folderPlaceholder')} /><Button type="button" variant="outline" size="icon" onClick={async () => { const f = await bridge.pickFolder(t('agents.pickFolder')); if (f) set({ home: f }); }}><FolderOpen /></Button></div>
        </Field>
      </>),
      ok: t('agents.add'), onOk: (v) => call('accounts.add', { agent: a.id, label: v.label.trim(), home: v.home.trim() })
    });
    if (r) { reload(); if (await confirm(t('agents.accountAdded'), t('agents.accountAddedBody', { label: r.label }), { ok: t('agents.login'), cancel: t('agents.later') })) act(call('agents.login', { account: r.id }), t('agents.followSteps')); }
  };
  if (!a.installed) return null;
  return (
    <div className="grid gap-1.5">
      <div className="text-muted-foreground text-xs">{t('agents.accounts')}</div>
      {a.accounts.map((acc) => {
        const login = LOGIN[acc.login] ?? LOGIN.desconocido;
        return (
          // Two lines: the name with its state and switch, then its folder with what can be done with it.
          <div key={acc.id} className={cn('grid gap-1 rounded-lg border px-3 py-2', acc.enabled === false && 'opacity-60')}>
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1 truncate text-[13px] font-medium">{acc.label}</div>
              <Badge variant={login[1]}>{login[0]}</Badge>
              <BubbleTip title={t('agents.useAccount')}><Switch checked={acc.enabled !== false} onCheckedChange={(enabled) => act(call('accounts.update', { id: acc.id, enabled })).then(reload)} aria-label={t('agents.useAccount')} /></BubbleTip>
            </div>
            <div className="flex items-center gap-1">
              <PathText path={acc.dir} className="text-muted-foreground min-w-0 flex-1 text-[11px]" />
              <BubbleTip title={t('agents.login')}><Button size="icon-xs" variant="ghost" aria-label={t('agents.login')} onClick={() => act(call('agents.login', { account: acc.id }), t('agents.followSteps'))}><LogIn /></Button></BubbleTip>
              {acc.id !== acc.agent ? <BubbleTip title={t('agents.removeTitle')} text={t('agents.removeTip')}><Button size="icon-xs" variant="danger" aria-label={t('agents.removeTitle')} onClick={async () => { if (await confirm(t('agents.removeTitle'), t('agents.removeBody', { label: acc.label }), { ok: t('agents.remove'), danger: true })) act(call('accounts.remove', { id: acc.id }), t('agents.accountRemoved')).then(reload); }}><Trash2 /></Button></BubbleTip> : null}
            </div>
          </div>
        );
      })}
      {a.multi ? <Button size="sm" variant="ghost" className="w-fit" onClick={add}><UserPlus />{t('agents.addAnother')}</Button> : <p className="text-muted-foreground text-[11px] leading-snug">{t('agents.fixedSession', { label: a.label })}</p>}
    </div>
  );
}

// One agent. In the wide grid the card is a subgrid of six rows (title, state, program, actions, accounts, settings), so
// every section sits at the same height in the three cards of a row.
function AgentCard({ a, reload }) {
  const t = useT();
  const cfg = useStore((s) => s.app.config.agents[a.id]);
  const [form, setForm] = useState({ models: (cfg.models ?? []).join(', '), defaultModel: cfg.defaultModel ?? '', strengths: cfg.strengths ?? '', path: cfg.path ?? '' });
  const login = LOGIN[a.login] ?? LOGIN.desconocido;
  return (
    <Card className="lg:row-span-6 lg:grid lg:grid-rows-[subgrid]" data-testid={`agent-card-${a.id}`}>
      <CardHeader className="flex-row items-start gap-3">
        <AgentIcon agent={a.id} className="mt-0.5 size-6 shrink-0" />
        <div className="min-w-0 flex-1"><CardTitle className="truncate">{a.label}</CardTitle><CardDescription className="truncate">{a.installed ? a.version ?? t('agents.installed') : t('agents.notFoundHere')}</CardDescription></div>
        <Switch checked={cfg.enabled} onCheckedChange={(enabled) => save(a.id, { enabled })} aria-label={t('agents.enabled')} />
      </CardHeader>
      <CardContent className="flex flex-wrap gap-1.5">
        {a.installed ? <Badge variant="success">{t('agents.installed')}</Badge> : <Badge variant="destructive">{t('agents.notFound')}</Badge>}
        {a.installed ? <Badge variant={login[1]}>{login[0]}</Badge> : null}
        {!cfg.enabled ? <Badge variant="secondary">{t('agents.disabled')}</Badge> : null}
        {a.installed && KIND[a.kind] ? <Badge variant="outline" className="text-muted-foreground font-normal">{t(KIND[a.kind])}</Badge> : null}
      </CardContent>
      <CardContent className="flex min-w-0">{a.where ? <PathText path={a.where} className="text-muted-foreground text-[11px]" /> : null}</CardContent>
      <CardContent className="flex flex-wrap gap-2">
        {!a.installed ? <Button size="sm" variant="outline" onClick={() => bridge.openExternal(INSTALL[a.id])}><ExternalLink />{t('agents.howInstall')}</Button> : null}
        <Button size="sm" variant="ghost" onClick={() => act(call('agents.check', { agent: a.id })).then(reload)}><RefreshCw />{t('agents.check')}</Button>
      </CardContent>
      <CardContent><Accounts a={a} reload={reload} /></CardContent>
      <CardContent>
        <Collapsible>
          <CollapsibleTrigger className="text-muted-foreground hover:text-foreground group flex cursor-pointer items-center gap-1 text-xs"><ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />{t('agents.modelsSettings')}</CollapsibleTrigger>
          <CollapsibleContent className="mt-3 grid gap-3">
            <Field label={t('agents.allowedModels')} hint={t('agents.allowedModelsHint')}><Input value={form.models} onChange={(e) => setForm({ ...form, models: e.target.value })} /></Field>
            <Field label={t('agents.defaultModel')}><Input value={form.defaultModel} onChange={(e) => setForm({ ...form, defaultModel: e.target.value })} /></Field>
            <Field label={t('agents.strengths')} hint={t('agents.strengthsHint')}><Input value={form.strengths} onChange={(e) => setForm({ ...form, strengths: e.target.value })} /></Field>
            <Field label={t('agents.path')} hint={t('agents.pathHint')}><Input value={form.path} onChange={(e) => setForm({ ...form, path: e.target.value })} placeholder={t('agents.pathPlaceholder')} /></Field>
            <div><Button size="sm" onClick={() => save(a.id, { models: form.models.split(',').map((m) => m.trim()).filter(Boolean), defaultModel: form.defaultModel.trim(), strengths: form.strengths.trim(), path: form.path.trim() }).then(reload)}>{t('agents.save')}</Button></div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

export function AgentsView() {
  const t = useT();
  const locale = useLocale();
  const version = useStore((s) => s.version);
  const [agents, setAgents] = useState(null);
  const [usage, setUsage] = useState([]);
  const [system, setSystem] = useState(null);
  useEffect(() => { call('system.check').then(setSystem).catch(() => {}); }, []);
  const load = (refresh = false) => { call('agents.status', { refresh }).then(setAgents).catch(() => setAgents([])); };
  useEffect(() => load(), []);
  useEffect(() => { call('usage.get').then(setUsage).catch(() => {}); }, [version]);
  return (
    <>
      <PageHeader icon={<Bot className="text-primary size-5" />} title={t('agents.title')} meta={t('agents.meta')}>
        <Button size="sm" variant="outline" onClick={() => { setAgents(null); load(true); }}><RefreshCw />{t('agents.checkAll')}</Button>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-5 py-5">
        <div className="grid gap-4">
          {system?.platform === 'win32' ? (
            <Card>
              <CardHeader><CardTitle>{t('agents.installTitle')}</CardTitle><CardDescription>{t('agents.installDesc')}</CardDescription></CardHeader>
              <CardContent><Installer onChange={() => load()} /></CardContent>
            </Card>
          ) : null}
          {system && !system.git ? (
            <Card className="border-warning/50 flex-row items-center gap-3 px-5 py-3.5">
              <div className="min-w-0 flex-1"><div className="text-[14px] font-medium">{t('agents.noGit')}</div><div className="text-muted-foreground text-xs">{t('agents.noGitDesc')}</div></div>
              <Button size="sm" variant="outline" onClick={() => bridge.openExternal('https://git-scm.com/download/win')}><ExternalLink />{t('agents.getGit')}</Button>
            </Card>
          ) : null}
          {/* Two cards per row from 1024 px, three on very wide windows: each card needs room for its account rows. */}
          <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3 [&>*]:min-w-0">{agents ? agents.map((a) => <AgentCard key={a.id} a={a} reload={() => load(true)} />) : <Card className="items-center"><Spinner /></Card>}</div>
          <Card>
            <CardHeader><CardTitle>{t('agents.usageTitle')}</CardTitle><CardDescription>{t('agents.usageDesc', { pct: Math.round((usage[0]?.stopAt ?? 0.92) * 100), hours: usage[0]?.windowHours ?? 5 })}</CardDescription></CardHeader>
            <CardContent className="grid gap-4">
              {usage.map((u) => (
                <div key={u.account} className="grid gap-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-sm"><AgentIcon agent={u.agent} /><span className="min-w-28">{u.label}</span>
                    {u.real ? <span className="text-xs">{u.real.window ? t('agents.realQuotaWindow', { pct: Math.round(u.real.utilization * 100), window: windowLabel(u.real.window) }) : t('agents.realQuota', { pct: Math.round(u.real.utilization * 100) })}{u.real.resetAt ? ` · ${t('agents.resetsAt', { when: new Date(u.real.resetAt).toLocaleString(locale, { weekday: 'short', hour: '2-digit', minute: '2-digit' }) })}` : ''}</span> : null}
                    <span className="text-muted-foreground text-xs">{t('agents.tasksUsed', { used: u.used, max: u.max, heavy: u.heavy, maxHeavy: u.maxHeavy })}</span>
                    {u.cooldownUntil ? <Badge variant="destructive">{t('agents.cooldown', { time: new Date(u.cooldownUntil).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) })}</Badge> : null}</div>
                  <div className="bg-muted h-1.5 overflow-hidden rounded-full"><div className={cn('h-full rounded-full transition-all', (u.real?.utilization ?? 0) >= 0.85 ? 'bg-warning' : 'bg-primary')} style={{ width: `${Math.min(100, (u.real ? u.real.utilization : u.used / Math.max(1, u.max)) * 100)}%` }} /></div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

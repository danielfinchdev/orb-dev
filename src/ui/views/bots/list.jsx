// 3.5: «Bots»: the user's bots (as many as they want, none made beforehand beyond the starter «Asistente») and the
// editor of one (route { view: 'bots', id }: a bot's id, or 'new'). Its brain is chosen like the assistant's.
import { useEffect, useState } from 'react';
import { Bot, Plus, MessageSquare, Pencil, Pause, Play, Trash2, Crown, Globe, Bell, Mail, CalendarDays, Compass, Home, Server, Settings2, ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/page.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Badge, Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter, Field, Input, Textarea } from '@/components/ui/basic.jsx';
import { Switch, Checkbox, Select, Popover, PopoverTrigger, PopoverContent } from '@/components/ui/overlay.jsx';
import { BrainPicker, useCatalog, modelLabel } from '@/components/brain-picker.jsx';
import { AgentIcon } from '@/components/agent-icon.jsx';
import { confirm } from '@/components/dialogs.jsx';
import { useStore, botCall, act, go, loadBots } from '@/lib/store.js';
import { AGENT } from '@/lib/labels.js';
import { TOOL_ORDER, EFFORTS, EMOJIS, newBotDraft, botPayload } from '@/lib/bots.js';
import { cn } from '@/lib/utils.js';
import { useT } from '@/lib/i18n.js';
import { useBots, useCanManage, BotFace, NoBots, BotsDown, Loading, BotPage } from './common.jsx';

export const TOOL_ICON = { internet: Globe, recordatorios: Bell, correo: Mail, calendario: CalendarDays, navegador: Compass, casa: Home, servidor: Server, gestion: Settings2 };

export function BotsView({ route }) {
  if (route.id != null) return <BotEditor id={route.id} />;
  return <BotList />;
}

function BotList() {
  const t = useT();
  const { bots, loaded, error, states } = useBots();
  const manage = useCanManage();
  const catalog = useCatalog();
  return (
    <>
      <PageHeader icon={<Bot className="text-primary size-5" />} title={t('nav.bots')} meta={loaded ? t('bots.count', { n: bots.length }) : null}>
        {manage ? <Button size="sm" onClick={() => go({ view: 'bots', id: 'new' })} data-testid="bots-new"><Plus />{t('bots.new')}</Button> : null}
      </PageHeader>
      {!loaded ? (error ? <BotsDown error={error} /> : <Loading />) : !bots.length ? <NoBots /> : (
        <BotPage wide>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="bots-list">
            {bots.map((b) => {
              const s = states[b.id];
              return (
                <Card key={b.id} className={cn('gap-3 py-4', b.paused && 'opacity-75')} data-testid={`bot-${b.name}`}>
                  <CardHeader className="flex-row items-start gap-3 px-4">
                    <BotFace bot={b} busy={Boolean(s?.busy)} size="lg" />
                    <div className="min-w-0 flex-1">
                      <CardTitle className="flex flex-wrap items-center gap-1.5">{b.name}{b.is_chief ? <Badge><Crown />{t('bots.chief')}</Badge> : null}{b.paused ? <Badge variant="secondary">{t('bots.paused')}</Badge> : null}</CardTitle>
                      <CardDescription className="mt-1 line-clamp-2">{b.role_text || t('bots.noRole')}</CardDescription>
                    </div>
                  </CardHeader>
                  <CardContent className="grid gap-2 px-4">
                    <div className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs"><AgentIcon agent={b.agent} className="size-3.5" /><span className="truncate">{AGENT[b.agent] ?? b.agent}{b.model ? ` · ${modelLabel(catalog, b.agent, b.model)}` : ''} · {t(`bots.effort.${b.effort}`)}</span></div>
                    <div className="flex flex-wrap gap-1">{(b.effectiveTools ?? b.tools).map((tool) => { const I = TOOL_ICON[tool] ?? Settings2; return <Badge key={tool} variant="outline"><I />{t(`bots.tool.${tool}`)}</Badge>; })}</div>
                    {b.exclusive?.length ? <div className="text-muted-foreground text-xs">{t('bots.onlyHim', { list: b.exclusive.join(', ') })}</div> : null}
                  </CardContent>
                  <CardFooter className="flex-wrap px-4">
                    <Button size="xs" onClick={() => go({ view: 'bot-chat', id: b.id })} data-testid={`bot-open-${b.name}`}><MessageSquare />{t('bots.talk')}</Button>
                    {manage ? <Button size="xs" variant="outline" onClick={() => go({ view: 'bots', id: b.id })} data-testid={`bot-edit-${b.name}`}><Pencil />{t('bots.edit')}</Button> : null}
                    <Button size="xs" variant="ghost" onClick={async () => { await act(botCall('bots.pause', { id: b.id, paused: !b.paused })); loadBots(); }}>{b.paused ? <><Play />{t('bots.resume')}</> : <><Pause />{t('bots.pause')}</>}</Button>
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        </BotPage>
      )}
    </>
  );
}

function EmojiPicker({ value, onChange }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="bg-primary/10 hover:bg-primary/15 grid size-14 shrink-0 cursor-pointer place-items-center rounded-2xl text-3xl" aria-label={t('bots.f.icon')} data-testid="bot-icon">{value || <Bot className="text-primary size-7" />}</button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        <div className="grid grid-cols-5 gap-1">{EMOJIS.map((e) => <button key={e} type="button" className={cn('hover:bg-accent grid h-10 cursor-pointer place-items-center rounded-lg text-xl', value === e && 'bg-accent ring-primary ring-2')} onClick={() => { onChange(e); setOpen(false); }}>{e}</button>)}</div>
        <Input className="mt-2" value={value} maxLength={8} onChange={(e) => onChange(e.target.value)} placeholder={t('bots.f.iconOwn')} aria-label={t('bots.f.iconOwn')} />
      </PopoverContent>
    </Popover>
  );
}

function BotEditor({ id }) {
  const t = useT();
  const isNew = id === 'new';
  const { bots, loaded } = useBots();
  const manage = useCanManage();
  const catalog = useCatalog();
  const app = useStore((s) => s.app);
  const connectors = (app.config?.mcpServers ?? []).map((m) => m.name).filter(Boolean);
  const [d, setD] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (isNew) { setD(newBotDraft(app.assistant?.agent ?? 'claude')); return undefined; }
    let alive = true;
    botCall('bots.get', { id: Number(id) }).then((b) => alive && setD({ ...b, model: b.model ?? '', exclusive: (b.exclusive ?? []).join(', '), accounts: { mcp: b.accounts?.mcp ?? [], account: b.accounts?.account ?? '' } })).catch(() => alive && setD(false));
    return () => { alive = false; };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const back = () => go({ view: 'bots' });
  if (!manage) return <><PageHeader title={t('bots.edit')} /><p className="text-muted-foreground p-8 text-center text-sm">{t('bots.empty.onPc')}</p></>;
  if (d === false) return <><PageHeader title={t('bots.edit')} /><p className="text-muted-foreground p-8 text-center text-sm">{t('bots.gone')}</p></>;
  if (!d || !loaded) return <><PageHeader title={isNew ? t('bots.new') : t('bots.edit')} /><Loading /></>;
  const set = (patch) => setD((x) => ({ ...x, ...patch }));
  const toggleTool = (tool, on) => set({ tools: on ? [...new Set([...d.tools, tool])] : d.tools.filter((x) => x !== tool) });
  const toggleMcp = (name, on) => set({ accounts: { ...d.accounts, mcp: on ? [...new Set([...(d.accounts.mcp ?? []), name])] : (d.accounts.mcp ?? []).filter((x) => x !== name) } });
  const otherChief = bots.find((b) => b.is_chief && b.id !== d.id);
  const save = async () => {
    setSaving(true);
    const body = botPayload(d);
    const r = await act(isNew ? botCall('bots.create', body) : botCall('bots.update', { id: d.id, ...body }), t('bots.saved'));
    setSaving(false);
    if (r) { await loadBots(); go(isNew ? { view: 'bot-chat', id: r.id } : { view: 'bots' }); }
  };
  const remove = async () => {
    if (!(await confirm(t('bots.deleteTitle', { name: d.name }), t('bots.deleteBody'), { ok: t('bots.delete'), danger: true }))) return;
    if (await act(botCall('bots.delete', { id: d.id }), t('bots.deleted'))) { await loadBots(); back(); }
  };
  return (
    <>
      <PageHeader icon={<Button size="icon-sm" variant="ghost" onClick={back} aria-label={t('bots.back')}><ArrowLeft /></Button>} title={isNew ? t('bots.new') : t('bots.editName', { name: d.name })}>
        {isNew ? null : <Button size="sm" variant="danger" onClick={remove} data-testid="bot-delete"><Trash2 />{t('bots.delete')}</Button>}
        <Button size="sm" onClick={save} disabled={saving || !d.name.trim()} data-testid="bot-save">{t('bots.save')}</Button>
      </PageHeader>
      <BotPage>
        <Card data-testid="bot-editor">
          <CardContent className="grid gap-4">
            <div className="flex items-start gap-4">
              <EmojiPicker value={d.icon} onChange={(icon) => set({ icon })} />
              <Field label={t('bots.f.name')} className="flex-1"><Input autoFocus={isNew} value={d.name} maxLength={40} onChange={(e) => set({ name: e.target.value })} placeholder={t('bots.f.namePh')} data-testid="bot-name" /></Field>
            </div>
            <Field label={t('bots.f.role')} hint={t('bots.f.roleHint')}><Textarea rows={4} maxLength={4000} value={d.role_text} onChange={(e) => set({ role_text: e.target.value })} placeholder={t('bots.f.rolePh')} data-testid="bot-role" /></Field>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t('bots.f.brain')}</CardTitle><CardDescription>{t('bots.f.brainHint')}</CardDescription></CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            <BrainPicker catalog={catalog} value={{ agent: d.agent, model: d.model ?? '', account: d.account ?? d.agent }} onChange={(b) => set({ agent: b.agent, model: b.model, account: b.account })} />
            <Select size="sm" value={d.effort} onValueChange={(effort) => set({ effort })} title={t('bots.f.effort')} options={EFFORTS.map((e) => ({ value: e, label: `${t('bots.f.effort')}: ${t(`bots.effort.${e}`).toLowerCase()}` }))} data-testid="bot-effort" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t('bots.f.tools')}</CardTitle><CardDescription>{t('bots.f.toolsHint')}</CardDescription></CardHeader>
          <CardContent className="grid gap-1 sm:grid-cols-2">
            {TOOL_ORDER.map((tool) => {
              const I = TOOL_ICON[tool];
              return (
                <label key={tool} className="hover:bg-accent/40 -mx-1 flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5">
                  <Checkbox className="mt-0.5" checked={d.tools.includes(tool) || (tool === 'gestion' && d.is_chief)} disabled={tool === 'gestion' && d.is_chief} onCheckedChange={(v) => toggleTool(tool, v === true)} data-testid={`bot-tool-${tool}`} />
                  <span className="min-w-0"><span className="flex items-center gap-1.5 text-sm"><I className="text-muted-foreground size-3.5" />{t(`bots.tool.${tool}`)}</span><span className="text-muted-foreground block text-xs">{t(`bots.toolHint.${tool}`)}</span></span>
                </label>
              );
            })}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t('bots.f.accounts')}</CardTitle><CardDescription>{t('bots.f.accountsHint')}</CardDescription></CardHeader>
          <CardContent className="grid gap-3">
            {connectors.length ? <div className="flex flex-wrap gap-x-4 gap-y-1.5">{connectors.map((n) => <label key={n} className="flex cursor-pointer items-center gap-2 text-sm"><Checkbox checked={(d.accounts.mcp ?? []).includes(n)} onCheckedChange={(v) => toggleMcp(n, v === true)} />{n}</label>)}</div>
              : <p className="text-muted-foreground text-xs">{t('bots.f.noConnectors')}</p>}
            <Field label={t('bots.f.account')} hint={t('bots.f.accountHint')}><Input value={d.accounts.account ?? ''} maxLength={120} onChange={(e) => set({ accounts: { ...d.accounts, account: e.target.value } })} placeholder={t('bots.f.accountPh')} /></Field>
            <Field label={t('bots.f.exclusive')} hint={t('bots.f.exclusiveHint')}><Input value={d.exclusive} maxLength={400} onChange={(e) => set({ exclusive: e.target.value })} placeholder={t('bots.f.exclusivePh')} data-testid="bot-exclusive" /></Field>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="grid gap-1">
            <label className="hover:bg-accent/40 -mx-2 flex cursor-pointer items-center justify-between gap-4 rounded-lg px-2 py-1.5">
              <div><div className="flex items-center gap-1.5 text-sm"><Crown className="text-muted-foreground size-3.5" />{t('bots.f.chief')}</div><div className="text-muted-foreground text-xs">{otherChief && !d.is_chief ? t('bots.f.chiefSwap', { name: otherChief.name }) : t('bots.f.chiefHint')}</div></div>
              <Switch checked={d.is_chief} onCheckedChange={(is_chief) => set({ is_chief })} data-testid="bot-chief" />
            </label>
            <label className="hover:bg-accent/40 -mx-2 flex cursor-pointer items-center justify-between gap-4 rounded-lg px-2 py-1.5">
              <div><div className="flex items-center gap-1.5 text-sm"><Pause className="text-muted-foreground size-3.5" />{t('bots.f.paused')}</div><div className="text-muted-foreground text-xs">{t('bots.f.pausedHint')}</div></div>
              <Switch checked={d.paused} onCheckedChange={(paused) => set({ paused })} data-testid="bot-paused" />
            </label>
          </CardContent>
        </Card>
        <div className="flex justify-end gap-2 pb-4"><Button variant="ghost" onClick={back}>{t('bots.cancel')}</Button><Button onClick={save} disabled={saving || !d.name.trim()}>{t('bots.save')}</Button></div>
      </BotPage>
    </>
  );
}

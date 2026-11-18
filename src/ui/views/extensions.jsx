// Ajustes › Skills y MCP (src/engine/api/extensions.mjs): every skill and MCP server of core (on or off, where it
// came from, its folder, removing it after the master password), «Importar» (a folder or a git repository: it comes in
// off), what agents made and wait for the user («Activar» / «Descartar»), the connectors of the PC (a package run with
// npx…) and the projects that are MCP servers («Usar», «Mover a core»). A server of core is improved in a project
// («Editar en un proyecto», then «Aplicar cambios»). PC only. Turning on what an agent made always goes through a dialog
// that lists every file that will be turned on (the quarantine's copy, src/domain/extensions/extensions.mjs) and opens its folder.
import { useEffect, useState } from 'react';
import { notify, notifyError, notifyInfo, notifyOk, notifyProgress } from '@/lib/notify.js';
import { Check, FolderOpen, KeyRound, PencilLine, Plus, Puzzle, Server, Trash2, Upload, X } from 'lucide-react';
import { confirm, choose, form } from '@/components/dialogs.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Badge, Field, Input } from '@/components/ui/basic.jsx';
import { Switch, BubbleTip, Select, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/overlay.jsx';
import { useStore, call, act, bridge, getState } from '@/lib/store.js';
import { t, useT } from '@/lib/i18n.js';
import { unlockCore } from '@/lib/core-access.js';
import { connectorKeys } from './master.jsx';
import { CATEGORIES } from '../../shared/layout.mjs';
import { MoreButton, ListRow } from '@/components/ui/primitives.jsx';
import { cn } from '@/lib/utils.js';
import { Block, Panel, Fld, Stack, CardFoot, Hint, MoreOptions } from './settings/rows.jsx';

// Where one came from, in a word (orb.json › source).
const SOURCE = { orb: 'ext.source.orb', importado: 'ext.source.imported', creado: 'ext.source.created', usuario: 'ext.source.user' };
const sourceLabel = (s) => t(SOURCE[s] ?? SOURCE.usuario);

export function ExtensionsPanel() {
  const t = useT();
  const [data, setData] = useState(null);
  const changed = useStore((s) => s.app?.config);
  const load = () => call('extensions.list').then(setData).catch(() => setData(null));
  useEffect(() => { load(); }, [changed]);
  const run = async (promise, ok) => { const r = await act(promise, ok); if (r?.skills) setData(r); else if (r?.list?.skills) setData(r.list); else load(); return r; };
  if (!data) return null;
  // A server that needs packages is turned on only after saying so (Orb downloads them without running their scripts).
  const toggle = async (kind, name, enabled, row = null) => {
    if (enabled && row?.needsInstall) {
      if (!await confirm(t('ext.installTitle', { name }), t('ext.installBody'), { ok: t('ext.activate'), danger: true })) return;
      const closeProgress = notifyProgress(t('ext.installing'));
      try { await run(call('extensions.toggle', { kind, name, enabled, install: true }), t('ext.turnedOn', { name })); } finally { closeProgress(); }
      return;
    }
    run(call('extensions.toggle', { kind, name, enabled }), t(enabled ? 'ext.turnedOn' : 'ext.turnedOff', { name }));
  };
  const remove = async (kind, name) => {
    if (!await confirm(t('ext.removeTitle', { name }), t(kind === 'connector' ? 'ext.removeConnectorBody' : 'ext.removeBody', { name }), { ok: t('ext.remove'), danger: true })) return;
    const unlock = await unlockCore('removeExtension');
    if (!unlock) return;
    run(call('extensions.remove', { kind, name, unlock }), t('ext.removed', { name }));
  };
  const open = (dir) => act(bridge.openPath(dir));
  return (
    <div className="grid gap-4 [&>*]:min-w-0" data-testid="extensions">
      {data.pending.length ? <PendingCard list={data.pending} run={run} /> : null}
      <Group title={t('ext.skills')} note={t('ext.skillsHint')} dir={data.dirs.skills} onOpen={open} empty={t('ext.noSkills')} count={data.skills.length}>
        {data.skills.map((s) => (
          <Row key={s.name} item={s} testid={`ext-skill-${s.name}`} detail={s.linked ? t('ext.linked') : s.valid ? s.description : t('ext.invalidSkill')}
            note={s.asks?.tools || s.asks?.hooks ? t('ext.asksNote') : null}
            on={s.enabled} disabled={(!s.valid || s.linked) && !s.enabled} onToggle={(v) => toggle('skill', s.name, v)}
            menu={[{ icon: FolderOpen, label: t('ext.openFolder'), run: () => open(s.dir) }, null, { icon: Trash2, label: t('ext.remove'), danger: true, run: () => remove('skill', s.name), testid: 'ext-remove' }]} />
        ))}
      </Group>
      <div className="flex justify-end"><Button size="sm" variant="outline" onClick={() => importFlow(run)} data-testid="ext-import"><Upload />{t('ext.import')}</Button></div>
      <Group title={t('ext.servers')} note={t('ext.serversHint')} dir={data.dirs.mcp} onOpen={open} empty={t('ext.noServers')} count={data.mcp.length}>
        {data.mcp.map((s) => (
          <Row key={s.name} item={s} testid={`ext-mcp-${s.name}`} detail={s.linked ? t('ext.linked') : s.description || (s.startable ? `${s.command} ${s.args.map((a) => a.split(/[\\/]/).pop()).join(' ')}` : t('ext.noStart'))}
            on={s.enabled} disabled={!s.startable && !s.enabled} onToggle={(v) => toggle('mcp', s.name, v, s)}
            extra={s.editing ? <Badge variant="outline" data-testid="ext-editing">{t('ext.editing')}</Badge> : null}
            keys={s.connector ? { name: s.connector } : null}
            menu={[
              { icon: FolderOpen, label: t('ext.openFolder'), run: () => open(s.dir) },
              s.editing ? { icon: Upload, label: t('ext.apply'), run: () => applyFlow(s.name, run), testid: 'ext-apply' } : { icon: PencilLine, label: t('ext.edit'), run: () => editFlow(s.name, run), testid: 'ext-edit' },
              null, { icon: Trash2, label: t('ext.remove'), danger: true, run: () => remove('mcp', s.name), testid: 'ext-remove' }]} />
        ))}
      </Group>
      {data.connectors.length ? (
        <Group title={t('ext.connectors')} note={t('ext.connectorsHint')} count={data.connectors.length}>
          {data.connectors.map((s) => (
            <Row key={s.name} item={s} testid={`ext-connector-${s.name}`} detail={`${s.command} ${s.args.join(' ')}`} mono
              on={s.enabled} onToggle={(v) => toggle('connector', s.name, v)} keys={{ name: s.name }}
              onRemove={() => remove('connector', s.name)} />
          ))}
        </Group>
      ) : null}
      <AddConnector run={run} />
      {data.projects.length ? (
        <Group title={t('ext.projects')} note={t('ext.projectsHint')} count={data.projects.length}>
          {data.projects.map((p) => (
            <ListRow key={p.dir} className="border-border rounded-none not-first:border-t" data-testid="ext-project" title={<>{p.name}{p.editOf ? <span className="text-muted-foreground font-normal"> · {t('ext.copyOf', { name: p.editOf })}</span> : null}</>} meta={<span className="font-mono">{p.dir}</span>}
              trailing={(
                <div className="flex items-center gap-1.5">
                  {p.connector ? <span className="text-muted-foreground text-caption">{t('ext.inUse', { name: p.connector })}</span>
                    : <Button size="xs" variant="outline" onClick={() => connectProject(p, run)}><Plus />{t('ext.use')}</Button>}
                  {p.editOf ? null : <Button size="xs" variant="outline" onClick={() => adoptFlow(p, run)} data-testid="ext-adopt">{t('ext.moveToCore')}</Button>}
                </div>
              )} />
          ))}
        </Group>
      ) : null}
      <MoreOptions testid="more-options-extensiones"><Panel><Stack><Hint>{t('ext.help')}</Hint></Stack></Panel></MoreOptions>
    </div>
  );
}

function Group({ title, note, count, dir, onOpen, empty, children }) {
  const t = useT();
  const rows = [children].flat().filter(Boolean);
  return (
    <Block title={title} count={count} note={note}
      actions={dir ? <BubbleTip title={t('ext.openFolder')}><Button size="icon-xs" variant="ghost" onClick={() => onOpen(dir)} aria-label={t('ext.openFolder')}><FolderOpen /></Button></BubbleTip> : null}>
      <Panel>{rows.length ? rows : <Stack><Hint>{empty}</Hint></Stack>}</Panel>
    </Block>
  );
}

function Row({ item, detail, note = null, mono = false, on, disabled = false, onToggle, keys = null, extra = null, menu = [], onRemove = null, testid }) {
  const t = useT();
  return (
    <ListRow className="border-border rounded-none not-first:border-t" data-testid={testid}
      title={<code className="font-mono text-body">{item.name}</code>}
      meta={<><span className={cn(mono && 'font-mono')}>{detail}</span>{note ? <span className="text-warning-ink ml-2" data-testid="ext-note">{note}</span> : null}</>}
      trailing={(
        <div className="flex items-center gap-1.5">
          {extra}
          <Badge variant="secondary">{sourceLabel(item.source)}</Badge>
          <Switch checked={on} disabled={disabled} onCheckedChange={onToggle} aria-label={t('ext.toggle', { name: item.name })} data-testid="ext-toggle" />
          {keys ? <BubbleTip title={t('master.keys')}><Button variant="ghost" size="icon-xs" aria-label={t('master.keys')} onClick={() => connectorKeys(keys)} data-testid="mcp-keys"><KeyRound /></Button></BubbleTip> : null}
          {/* a connector has one action (remove): the mock-up draws it as a button, not as a menu */}
          {onRemove ? <BubbleTip title={t('ext.remove')}><Button variant="ghost" size="icon-xs" aria-label={t('ext.removeNamed', { name: item.name })} onClick={onRemove} data-testid="ext-remove"><Trash2 /></Button></BubbleTip> : (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild><MoreButton label={t('ext.more', { name: item.name })} data-testid="ext-menu" /></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {menu.map((m, i) => (m ? <DropdownMenuItem key={m.label} variant={m.danger ? 'destructive' : undefined} onSelect={m.run} data-testid={m.testid}><m.icon />{m.label}</DropdownMenuItem> : <DropdownMenuSeparator key={`s${i}`} />))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )} />
  );
}

// What agents made and wait for the user (the same card is in the chat).
function PendingCard({ list, run }) {
  const t = useT();
  return (
    <Block title={t('ext.pending')} count={list.length} note={t('ext.pendingDesc')} data-testid="ext-pending">
      <Panel>
        {list.map((r) => (
          <Stack key={r.id} className="border-border gap-1.5 not-first:border-t">
            <div className="text-control font-medium">{t(r.kind === 'skill' ? 'ext.kindSkill' : 'ext.kindMcp')} «{r.name}»{r.status === 'asking' ? ` · ${t('ext.wantsEdit')}` : r.update ? ` · ${t('ext.newVersion')}` : ''} <span className="text-muted-foreground font-normal">· {r.by?.agent ?? ''}</span></div>
            <div className="text-muted-foreground text-caption">{r.description}</div>
            {r.status === 'asking' ? null : <FileList files={r.files} total={r.total} />}
            <div className="flex flex-wrap gap-2">
              <Button size="xs" onClick={() => answerRequest(r, true, run)} data-testid="ext-approve"><Check />{t(r.status === 'asking' ? 'ext.allow' : 'ext.activate')}</Button>
              {r.dir ? <Button size="xs" variant="outline" onClick={() => act(bridge.openPath(r.dir))}><FolderOpen />{t('ext.openFolder')}</Button> : null}
              <Button size="xs" variant="outline" onClick={() => answerRequest(r, false, run)} data-testid="ext-reject"><X />{t('ext.discard')}</Button>
            </div>
          </Stack>
        ))}
      </Panel>
    </Block>
  );
}

// The files that would be turned on: the first ones, «y N más» and the whole list one click away.
function FileList({ files = [], total = files.length, first = 8 }) {
  const t = useT();
  const [all, setAll] = useState(false);
  const shown = all ? files : files.slice(0, first);
  const more = Math.max(0, (all ? files.length : total) - shown.length);
  return (
    <div className="text-muted-foreground font-mono text-micro break-all" data-testid="ext-files">
      {shown.join(' · ')}
      {!all && more > 0 ? <> · <button type="button" className="text-foreground underline" onClick={() => setAll(true)} data-testid="ext-files-more">{t('ext.andMore', { n: more })}</button></> : null}
    </div>
  );
}

// «Activar» (or «Permitir» for an agent that wants to improve a server with keys), always after a dialog that says what
// it means, lists every file and opens the folder; «Descartar» at once. → the engine's answer, or undefined
async function answerRequest(r, approve, run, done = (x) => x) {
  if (!approve) return done(await run(call('extensions.reject', { id: r.id }), t('ext.discarded', { name: r.name })));
  const agent = r.by?.agent ?? t('ext.kindAgent');
  const asking = r.status === 'asking';
  const title = asking ? t('ext.confirmEditTitle', { agent, name: r.name }) : t(r.kind === 'skill' ? 'ext.confirmSkillTitle' : 'ext.confirmMcpTitle', { name: r.name });
  const body = asking ? t('ext.confirmEditBody', { name: r.name }) : t(r.kind === 'skill' ? 'ext.confirmSkillBody' : 'ext.confirmMcpBody', { agent });
  const ok = await form(title, {
    description: body,
    wide: true,
    body: () => (asking ? <span /> : (
      <div className="grid gap-2 text-sm" data-testid="ext-confirm">
        {r.deps ? <p>{t('ext.confirmDeps')}</p> : null}
        {r.asks?.tools || r.asks?.hooks ? <p className="text-warning-ink">{t('ext.asksNote')}</p> : null}
        {r.kept?.length ? <p className="text-warning-ink" data-testid="ext-confirm-kept">{t('ext.keptNote', { files: r.kept.slice(0, 5).join(', ') + (r.kept.length > 5 ? '…' : '') })}</p> : null}
        <p className="text-muted-foreground">{t('ext.filesTitle', { n: r.total ?? r.files?.length ?? 0 })}</p>
        <div className="bg-muted/50 max-h-60 overflow-auto rounded-md p-2 font-mono text-micro" data-testid="ext-confirm-files">{(r.files ?? []).map((f) => <div key={f}>{f}</div>)}</div>
        {r.dir ? <div><Button type="button" size="xs" variant="outline" onClick={() => act(bridge.openPath(r.dir))}><FolderOpen />{t('ext.openFolder')}</Button></div> : null}
      </div>
    )),
    ok: t(asking ? 'ext.allow' : 'ext.activate'),
    onOk: () => call('extensions.approve', { id: r.id })
  });
  if (!ok) return undefined;
  notifyOk(asking ? t('ext.stateAllowed') : t('ext.activated', { name: r.name }));
  return done(await run(Promise.resolve(ok)));
}

// «Importar»: a folder of this PC or a git repository (https).
async function importFlow(run) {
  const how = await choose(t('ext.importTitle'), t('ext.importDesc'), [
    { value: 'folder', label: t('ext.importFolder'), hint: t('ext.importFolderHint') },
    { value: 'repo', label: t('ext.importRepo'), hint: t('ext.importRepoHint') }
  ], { testid: 'ext-import-how' });
  if (how === 'folder') {
    const from = await bridge.pickFolder?.(t('ext.importFolder'));
    if (from) { const closeProgress = notifyProgress(t('ext.importing')); try { await run(call('extensions.import', { from }), t('ext.imported')); } finally { closeProgress(); } }
  } else if (how === 'repo') {
    await form(t('ext.importRepo'), {
      description: t('ext.importRepoDesc'),
      initial: { url: '' },
      body: (v, set) => <Field label={t('ext.repoUrl')}><Input autoFocus value={v.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://github.com/usuario/repositorio" data-testid="ext-repo-url" /></Field>,
      ok: t('ext.import'),
      onOk: async (v) => { const r = await call('extensions.import', { url: v.url.trim() }); notifyOk(t('ext.imported')); await run(Promise.resolve(r)); return true; }
    });
  }
}

// «Editar en un proyecto»: a copy in a category, worked on there; «Aplicar cambios» puts it back.
async function editFlow(name, run) {
  const r = await form(t('ext.editTitle', { name }), {
    description: t('ext.editDesc'),
    initial: { category: 'windows' },
    body: (v, set) => <Field label={t('ext.editCategory')}><Select caret="solid" className="w-full" value={v.category} onValueChange={(category) => set({ category })} options={CATEGORIES.map((c) => ({ value: c, label: c }))} /></Field>,
    ok: t('ext.editOk'),
    onOk: (v) => call('extensions.edit', { name, category: v.category })
  });
  if (r?.path) { notifyOk(t('ext.editDone', { path: r.path })); run(Promise.resolve(null)); }
}
async function applyFlow(name, run) {
  let check; try { check = await call('extensions.applyCheck', { name }); } catch (error) { notifyError(error); return; }
  const n = check.added.length + check.changed.length + check.removed.length;
  if (!n) { notifyInfo(t('ext.applyNothing')); return; }
  const lines = [...check.added.map((f) => `+ ${f}`), ...check.changed.map((f) => `~ ${f}`), ...check.removed.map((f) => `− ${f}`)].slice(0, 12).join('\n');
  if (!await confirm(t('ext.applyTitle', { name }), `${t('ext.applyBody', { path: check.path, n })}\n\n${lines}${n > 12 ? `\n${t('ext.andMore', { n: n - 12 })}` : ''}`, { ok: t('ext.apply'), danger: true })) return;
  const done = await run(call('extensions.apply', { name, id: check.id }), t('ext.applied', { name }));
  if (!done) return;
  // the project's copy stays «en edición» until it goes: keep editing, or delete it (Proyectos'
  // own deletion, with the master password; the row stops saying so by itself).
  const project = (getState().projects ?? []).find((p) => String(p.path).toLowerCase() === String(check.path).toLowerCase());
  if (!project || bridge.mobile || !bridge.deleteProject) return;
  const next = await choose(t('ext.afterApplyTitle', { name }), t('ext.afterApplyBody', { path: check.path }), [{ value: 'delete', label: t('ext.afterApplyDelete'), variant: 'destructive' }, { value: 'keep', label: t('ext.afterApplyKeep') }]);
  if (next === 'delete') { const { deleteProjectFlow } = await import('./projects.jsx'); await deleteProjectFlow(project, t); run(Promise.resolve(null)); }
}
async function adoptFlow(p, run) {
  if (!await confirm(t('ext.adoptTitle', { name: p.name }), t('ext.adoptBody', { path: p.dir }), { ok: t('ext.moveToCore'), danger: true })) return;
  const r = await run(call('extensions.adopt', { project: p.name }));
  if (r?.moved) notify({ title: t('ext.adopted', { name: p.name }), body: t('ext.adoptedAt', { path: r.moved.to }), tone: 'success' }, { always: true, ms: 12000 });
}
// A project that is an MCP server, used from where it is (its connector points to the project's folder).
async function connectProject(p, run) {
  const c = getState().app?.config;
  run(call('config.save', { patch: { mcpServers: [...(c?.mcpServers ?? []), { name: p.name.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 40), command: p.command, args: p.args, agents: [], enabled: true, source: 'usuario' }] } }), t('ext.added', { name: p.name }));
}
// A connector of the PC (a package run with npx, a program): the command and its arguments, as the mock-up draws it,
// a form in the page itself.
function AddConnector({ run }) {
  const t = useT();
  const empty = { name: '', command: '', args: '', agents: '' };
  const [v, setV] = useState(empty);
  const set = (patch) => setV((x) => ({ ...x, ...patch }));
  // one save at a time: a second press while the first is asked for the password would add the connector twice
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (busy) return;
    setBusy(true);
    try { await save(); } finally { setBusy(false); }
  };
  const save = async () => {
    const c = getState().app?.config;
    const entry = { name: v.name.trim(), command: v.command.trim(), args: v.args.trim() ? v.args.trim().split(/\s+/) : [], agents: v.agents.split(',').map((x) => x.trim()).filter(Boolean), enabled: true, source: 'usuario' };
    if (!(await act(call('config.save', { patch: { mcpServers: [...(c?.mcpServers ?? []), entry] } }), t('settings.saved')))) return;
    setV(empty);
    run(Promise.resolve(null));
  };
  return (
    <Block title={t('settings.mcpAddTitle')} note={t('settings.mcpAddDesc')} data-testid="ext-add-connector">
      <Panel>
        <Fld label={t('settings.mcpName')}><Input value={v.name} onChange={(e) => set({ name: e.target.value })} placeholder={t('settings.mcpNamePh')} data-testid="ext-add-name" /></Fld>
        <Fld label={t('settings.mcpCommand')}><Input value={v.command} onChange={(e) => set({ command: e.target.value })} placeholder="npx" data-testid="ext-add-command" /></Fld>
        <Fld label={t('settings.mcpArgs')} hint={t('settings.mcpArgsHint')}><Input value={v.args} onChange={(e) => set({ args: e.target.value })} placeholder="@playwright/mcp@latest" data-testid="ext-add-args" /></Fld>
        <Fld label={t('settings.mcpAgents')} hint={t('settings.mcpAgentsHint')}><Input value={v.agents} onChange={(e) => set({ agents: e.target.value })} data-testid="ext-add-agents" /></Fld>
        <CardFoot><Button size="sm" onClick={add} disabled={busy || !v.name.trim() || !v.command.trim()} data-testid="ext-add"><Plus />{t('settings.add')}</Button></CardFoot>
      </Panel>
    </Block>
  );
}

// The card in the chat when an agent asks for what it made to be turned on (src/mcp/server.mjs › orb_request_activation),
// or for permission to improve a server that holds keys (meta.ask = 'edit'). «Activar» opens the same dialog as Ajustes.
export function ExtensionRequestCard({ m }) {
  const t = useT();
  const [local, setLocal] = useState(null);
  const state = local ?? m.meta.status ?? 'pending';
  const asking = m.meta.ask === 'edit';
  const pendingOne = async () => (await call('extensions.list')).pending.find((r) => r.id === m.meta.extension);
  const answer = async (approve) => {
    let r; try { r = await pendingOne(); } catch (error) { notifyError(error); return; }
    if (!r) { setLocal('gone'); return; }
    const out = await answerRequest(r, approve, (p) => act(p));
    if (out !== undefined) setLocal(approve ? 'approved' : 'rejected');
  };
  const openFolder = async () => { const r = await pendingOne().catch(() => null); if (r?.dir) act(bridge.openPath(r.dir)); };
  const more = (m.meta.total ?? m.meta.files?.length ?? 0) - (m.meta.files?.length ?? 0);
  return (
    <div className={`mx-auto w-full max-w-[88%] rounded-xl border px-3.5 py-2.5 text-control ${state === 'pending' ? 'border-warning/50 bg-warning/10' : 'bg-muted/50'}`} data-testid="ext-request">
      <div className="flex items-start gap-2">{m.meta.ext === 'skill' ? <Puzzle className="mt-0.5 size-4 shrink-0" /> : <Server className="mt-0.5 size-4 shrink-0" />}<div className="min-w-0 flex-1"><div>{m.body}</div>{m.meta.description ? <div className="text-muted-foreground mt-0.5">{m.meta.description}</div> : null}</div></div>
      {m.meta.files?.length ? <div className="text-muted-foreground mt-1.5 pl-6 font-mono text-micro break-all">{m.meta.files.join(' · ')}{more > 0 ? ` · ${t('ext.andMore', { n: more })}` : ''}</div> : null}
      <div className="chat-actions mt-2 flex flex-wrap items-center gap-2 pl-6">
        {state !== 'pending' ? <Badge variant={state === 'approved' ? 'success' : 'outline'}>{t(state === 'approved' ? (asking ? 'ext.stateAllowed' : 'ext.stateApproved') : 'ext.stateRejected')}</Badge>
          : bridge.mobile ? <span className="text-muted-foreground">{t('ext.onPc')}</span> : (<>
            <Button size="xs" className="px-2.5" onClick={() => answer(true)} data-testid="ext-card-approve"><Check />{t(asking ? 'ext.allow' : 'ext.activate')}</Button>
            {asking ? null : <Button size="xs" className="px-2.5" variant="outline" onClick={openFolder} data-testid="ext-card-folder"><FolderOpen />{t('ext.openFolder')}</Button>}
            <Button size="xs" className="px-2.5" variant="outline" onClick={() => answer(false)}><X />{t('ext.discard')}</Button>
          </>)}
      </div>
    </div>
  );
}

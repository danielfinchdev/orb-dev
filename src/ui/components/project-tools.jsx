// 3.2, God mode: the project in an editor («Abrir en»: Cursor, VS Code or the File Explorer) and the project's actions
// (commands of the user's own, such as «npm test», run in a terminal window from the bar or with their shortcut, with an
// optional preview of a page of this PC).
import { useEffect, useState } from 'react';
import { ChevronDown, FolderOpen, Play, Plus, Pencil, Trash2, Zap, Code2, MousePointer2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button.jsx';
import { Input, Textarea, Field } from './ui/basic.jsx';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel, Switch } from './ui/overlay.jsx';
import { form, confirm } from './dialogs.jsx';
import { useStore, call, act, bridge } from '@/lib/store.js';
import { useT, t as tNow } from '@/lib/i18n.js';

// The editors installed on this PC (asked once).
let editorsAsked = null;
function useEditors() {
  const [editors, setEditors] = useState(null);
  useEffect(() => { if (!bridge.editors) return; (editorsAsked ??= bridge.editors().catch(() => ({}))).then(setEditors); }, []);
  return editors ?? {};
}

export function OpenInMenu({ project }) {
  const t = useT();
  const editors = useEditors();
  if (!project?.path || !bridge.openIn) return null;
  const open = (which) => act(bridge.openIn(which, project.path));
  const first = editors.cursor ? 'cursor' : editors.vscode ? 'vscode' : 'explorer';
  const ICON = { cursor: MousePointer2, vscode: Code2, explorer: FolderOpen };
  const LABEL = { cursor: 'Cursor', vscode: 'VS Code', explorer: t('tools.explorer') };
  const Main = ICON[first];
  return (
    <div className="flex items-center" data-testid="open-in">
      <Button variant="outline" size="sm" className="rounded-r-none" onClick={() => open(first)} data-testid="open-in-main"><Main />{t('tools.openIn', { app: LABEL[first] })}</Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="outline" size="sm" className="rounded-l-none border-l-0 px-1.5" aria-label={t('tools.openWith')} data-testid="open-in-menu"><ChevronDown /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {['cursor', 'vscode', 'explorer'].filter((w) => w === 'explorer' || editors[w]).map((w) => { const I = ICON[w]; return <DropdownMenuItem key={w} onSelect={() => open(w)}><I />{LABEL[w]}</DropdownMenuItem>; })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// ---- actions
export function runProjectAction(project, action) {
  if (!bridge.runAction || !project?.path) return undefined;
  return act(bridge.runAction({ dir: project.path, command: action.command, preview: action.preview, openPreview: action.openPreview }), tNow('tools.actionRunning', { name: action.name }));
}

// «Ctrl+Shift+T» from a key press (null for a key that cannot be one: a lone modifier, or a plain letter).
export function shortcutOf(e) {
  const key = /^F\d{1,2}$/.test(e.key) ? e.key : /^[a-z0-9]$/i.test(e.key) ? e.key.toUpperCase() : e.code?.startsWith('Digit') ? e.code.slice(5) : e.code?.startsWith('Key') ? e.code.slice(3) : null;
  if (!key) return null;
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta'].filter(Boolean);
  if (!mods.length && !/^F\d/.test(key)) return null;
  return [...mods, key].join('+');
}
// Shortcuts the app already uses: not for an action.
const RESERVED = new Set(['Ctrl+J', 'Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+A', 'Ctrl+Z', 'Ctrl+Y', 'Ctrl+R', 'Ctrl+W', 'Ctrl+Q', 'Ctrl+F', 'F5', 'F11', 'F12']);

function ShortcutInput({ value, onChange }) {
  const t = useT();
  return (
    <Input readOnly value={value ?? ''} placeholder={t('tools.pressShortcut')} data-testid="action-shortcut"
      onKeyDown={(e) => {
        if (e.key === 'Tab') return;
        e.preventDefault();
        if (e.key === 'Backspace' || e.key === 'Delete') { onChange(null); return; }
        const s = shortcutOf(e); if (!s) return;
        if (RESERVED.has(s)) { toast.info(t('tools.shortcutReserved', { shortcut: s })); return; }
        onChange(s);
      }} />
  );
}

function editAction(project, action = null) {
  return form(action ? tNow('tools.editAction') : tNow('tools.addAction'), {
    description: tNow('tools.actionHelp'),
    initial: { name: action?.name ?? '', shortcut: action?.shortcut ?? null, command: action?.command ?? '', preview: action?.preview ?? '', openPreview: action?.openPreview ?? false },
    body: (v, set) => (<>
      <Field label={tNow('tools.name')}><Input autoFocus value={v.name} maxLength={40} placeholder={tNow('tools.namePh')} onChange={(e) => set({ name: e.target.value })} data-testid="action-name" /></Field>
      <Field label={tNow('tools.shortcut')} hint={tNow('tools.shortcutHint')}><ShortcutInput value={v.shortcut} onChange={(shortcut) => set({ shortcut })} /></Field>
      <Field label={tNow('tools.command')}><Textarea rows={3} value={v.command} maxLength={2000} placeholder="npm test" className="font-mono text-[13px]" onChange={(e) => set({ command: e.target.value })} data-testid="action-command" /></Field>
      <Field label={tNow('tools.preview')} hint={tNow('tools.previewHint')}><Input value={v.preview} placeholder="http://localhost:5173" onChange={(e) => set({ preview: e.target.value })} data-testid="action-preview" /></Field>
      <label className="bg-muted/50 flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-[13.5px]">
        {tNow('tools.openPreview')}<Switch checked={v.openPreview} disabled={!v.preview.trim()} onCheckedChange={(openPreview) => set({ openPreview })} />
      </label>
    </>),
    ok: tNow('tools.saveAction'),
    onOk: (v) => call('actions.save', { project: project.name, action: { id: action?.id, name: v.name.trim(), shortcut: v.shortcut, command: v.command, preview: v.preview.trim() || null, openPreview: v.openPreview } })
  });
}

export function useProjectActions(name) {
  const version = useStore((s) => s.version);
  const [actions, setActions] = useState([]);
  useEffect(() => { if (!name) { setActions([]); return undefined; } let alive = true; call('actions.list', { project: name }).then((l) => alive && setActions(l)).catch(() => alive && setActions([])); return () => { alive = false; }; }, [name, version]);
  return actions;
}

export function ActionsMenu({ project }) {
  const t = useT();
  const actions = useProjectActions(project?.name);
  if (!project || !bridge.runAction) return null;
  const remove = async (a) => { if (await confirm(t('tools.removeAction'), t('tools.removeActionBody', { name: a.name }), { ok: t('tools.remove'), danger: true })) act(call('actions.remove', { project: project.name, id: a.id })); };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="outline" size="sm" data-testid="actions-menu"><Zap />{t('tools.actions')}<ChevronDown className="opacity-60" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {actions.length ? <DropdownMenuLabel>{t('tools.actionsOf', { name: project.name })}</DropdownMenuLabel> : null}
        {actions.map((a) => (
          <DropdownMenuItem key={a.id} onSelect={() => runProjectAction(project, a)} className="group/act" data-testid={`action-${a.id}`}>
            <Play /><span className="min-w-0 flex-1 truncate">{a.name}</span>
            {a.shortcut ? <kbd className="text-muted-foreground rounded border px-1 text-[10.5px] group-hover/act:hidden">{a.shortcut}</kbd> : null}
            <span className="hidden items-center gap-0.5 group-hover/act:flex">
              <button type="button" className="hover:bg-accent grid size-6 place-items-center rounded" aria-label={t('tools.editAction')} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); editAction(project, a); }}><Pencil className="size-3.5" /></button>
              <button type="button" className="hover:bg-accent text-destructive grid size-6 place-items-center rounded" aria-label={t('tools.removeAction')} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); remove(a); }}><Trash2 className="size-3.5" /></button>
            </span>
          </DropdownMenuItem>
        ))}
        {actions.length ? <DropdownMenuSeparator /> : <p className="text-muted-foreground px-2 py-1.5 text-xs leading-snug">{t('tools.noActions')}</p>}
        <DropdownMenuItem onSelect={() => editAction(project)} data-testid="action-add"><Plus />{t('tools.addAction')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// The shortcuts of a project's actions, anywhere in the window (God mode's project, or the working folder elsewhere).
export function ActionShortcuts({ project }) {
  const actions = useProjectActions(project?.name);
  useEffect(() => {
    if (!project || !actions.some((a) => a.shortcut)) return undefined;
    const onKey = (e) => {
      if (e.repeat || document.querySelector('[role=dialog]')) return;
      const s = shortcutOf(e); if (!s) return;
      const a = actions.find((x) => x.shortcut === s); if (!a) return;
      e.preventDefault();
      runProjectAction(project, a);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [project, actions]);
  return null;
}

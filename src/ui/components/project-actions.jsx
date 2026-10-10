// Create / link / clone a project, and the project control under the assistant's message box.
import { FolderOpen, FolderPlus, FolderX, X, ChevronsUpDown, Check, Folder } from 'lucide-react';
import { toast } from 'sonner';
import { form } from './dialogs.jsx';
import { Field, Input, Textarea } from './ui/basic.jsx';
import { Button } from './ui/button.jsx';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel, Select, BubbleTip } from './ui/overlay.jsx';
import { call, getState, act, bridge, useStore, refresh } from '@/lib/store.js';
import { baseName } from '@/lib/utils.js';
import { GithubIcon } from '@/components/agent-icon.jsx';
import { t, useT } from '@/lib/i18n.js';

const home = () => getState().app?.home ?? '';
const sep = () => (home().includes('\\') ? '\\' : '/');
// Projects of Orb's folder live in one of its categories (windows, ios, android, web).
export const CATEGORIES = ['windows', 'ios', 'android', 'web'];
const CategoryField = ({ v, set }) => (
  <Field label={t('comp.projects.category')} hint={t('comp.projects.categoryHint')}>
    <Select className="w-full" value={v.category} onValueChange={(category) => set({ category })} options={CATEGORIES.map((value) => ({ value, label: t(`comp.projects.category.${value}`) }))} />
  </Field>
);

export async function createProjectFlow() {
  const p = await form(t('comp.projects.newTitle'), {
    description: t('comp.projects.newDesc'),
    initial: { name: '', notes: '', category: 'web' },
    body: (v, set) => (<>
      <CategoryField v={v} set={set} />
      <Field label={t('comp.projects.name')} hint={v.name.trim() ? t('comp.projects.folderHint', { path: `${home()}${sep()}${v.category}${sep()}${v.name.trim().replace(/[<>:"/\\|?*]/g, '')}` }) : null}><Input autoFocus value={v.name} onChange={(e) => set({ name: e.target.value })} placeholder="webviaproject" maxLength={60} /></Field>
      <Field label={t('comp.projects.about')} hint={t('comp.projects.aboutHint')}><Textarea value={v.notes} onChange={(e) => set({ notes: e.target.value })} rows={3} /></Field>
    </>),
    ok: t('comp.projects.create'),
    onOk: (v) => call('projects.create', { name: v.name.trim(), notes: v.notes.trim(), category: v.category })
  });
  if (p) { toast.success(t('comp.projects.created', { name: p.name })); await refresh().catch(() => {}); }
  return p;
}

export async function linkFolderFlow() {
  const folder = await bridge.pickFolder(t('comp.projects.pickFolder'));
  if (!folder) return null;
  const p = await form(t('comp.projects.linkTitle'), {
    description: t('comp.projects.linkDesc'),
    initial: { name: baseName(folder) },
    body: (v, set) => (<>
      <div className="bg-muted rounded-lg px-3 py-2 font-mono text-xs break-all">{folder}</div>
      <Field label={t('comp.projects.projectName')}><Input autoFocus value={v.name} onChange={(e) => set({ name: e.target.value })} maxLength={60} /></Field>
    </>),
    ok: t('comp.projects.link'),
    onOk: (v) => call('projects.import', { name: v.name.trim(), folder })
  });
  if (p) { toast.success(t('comp.projects.linked', { name: p.name })); await refresh().catch(() => {}); }
  return p;
}

export async function cloneRepoFlow() {
  const p = await form(t('comp.projects.cloneTitle'), {
    description: t('comp.projects.cloneDesc', { home: home() }),
    initial: { repo: '', name: '', category: 'web' },
    body: (v, set) => (<>
      <CategoryField v={v} set={set} />
      <Field label={t('comp.projects.repo')}><Input autoFocus value={v.repo} onChange={(e) => set({ repo: e.target.value })} placeholder={t('comp.projects.repoPlaceholder')} /></Field>
      <Field label={t('comp.projects.projectNameOpt')}><Input value={v.name} onChange={(e) => set({ name: e.target.value })} maxLength={60} /></Field>
    </>),
    ok: t('comp.projects.clone'),
    onOk: (v) => call('projects.clone', { repo: v.repo.trim(), name: v.name.trim(), category: v.category })
  });
  if (p) { toast.success(t('comp.projects.cloned', { path: p.path })); await refresh().catch(() => {}); }
  return p;
}

// The working project of the assistant's chat: pick one, create one, link a folder, or clear it to pick another.
export function ProjectPicker() {
  const t = useT();
  const projects = useStore((s) => s.projects);
  const active = useStore((s) => s.app?.activeProject);
  const setActive = (name) => act(call('projects.setActive', { name }));
  return (
    <div className="flex items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant={active ? 'soft' : 'outline'} size="xs" className="max-w-56" data-testid="project-picker">
            <Folder className="size-3.5" /><span className="truncate">{active ? active.name : t('comp.projects.pick')}</span><ChevronsUpDown className="size-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>{t('comp.projects.inFolder')}</DropdownMenuLabel>
          {projects.length ? projects.map((p) => (
            <DropdownMenuItem key={p.name} onSelect={() => setActive(p.name)}>
              <Folder /><span className="flex-1 truncate">{p.name}</span>{active?.name === p.name ? <Check className="text-primary!" /> : null}
            </DropdownMenuItem>
          )) : <div className="text-muted-foreground px-2 py-1.5 text-xs">{t('comp.projects.none')}</div>}
          {/* 2.6: without a folder (it was a section of its own in the sidebar). */}
          <DropdownMenuItem onSelect={() => setActive('')} data-testid="project-none">
            <FolderX /><span className="grid flex-1 leading-tight"><span className="truncate">{t('nav.loose')}</span><span className="text-muted-foreground text-xs">{t('comp.projects.noneHint')}</span></span>{!active ? <Check className="text-primary!" /> : null}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={async () => { const p = await createProjectFlow(); if (p) setActive(p.name); }}><FolderPlus />{t('comp.projects.newTitle')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={async () => { const p = await linkFolderFlow(); if (p) setActive(p.name); }}><FolderOpen />{t('comp.projects.linkMenu')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={async () => { const p = await cloneRepoFlow(); if (p) setActive(p.name); }}><GithubIcon />{t('comp.projects.cloneMenu')}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {active ? <BubbleTip title={t('comp.projects.clear')}><Button variant="ghost" size="icon-xs" aria-label={t('comp.projects.clear')} onClick={() => setActive('')}><X /></Button></BubbleTip> : null}
    </div>
  );
}

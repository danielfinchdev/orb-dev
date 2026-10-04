// Create / link / clone a project, and the project control under the assistant's message box.
import { FolderOpen, FolderPlus, X, ChevronsUpDown, Check, Folder } from 'lucide-react';
import { toast } from 'sonner';
import { form } from './dialogs.jsx';
import { Field, Input, Textarea } from './ui/basic.jsx';
import { Button } from './ui/button.jsx';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel } from './ui/overlay.jsx';
import { call, getState, act, bridge, useStore, refresh } from '@/lib/store.js';
import { baseName } from '@/lib/utils.js';
import { GithubIcon } from '@/components/agent-icon.jsx';

const home = () => getState().app?.home ?? '';
const sep = () => (home().includes('\\') ? '\\' : '/');

export async function createProjectFlow() {
  const p = await form('Nuevo proyecto', {
    description: 'Se crea una carpeta con git dentro de la de tu asistente, con su bitácora.',
    initial: { name: '', notes: '' },
    body: (v, set) => (<>
      <Field label="Nombre" hint={v.name.trim() ? `Carpeta: ${home()}${sep()}${v.name.trim().replace(/[<>:"/\\|?*]/g, '')}` : null}><Input autoFocus value={v.name} onChange={(e) => set({ name: e.target.value })} placeholder="webviaproject" maxLength={60} /></Field>
      <Field label="De qué va (opcional)" hint="Ayuda al asistente a escribir buenos encargos."><Textarea value={v.notes} onChange={(e) => set({ notes: e.target.value })} rows={3} /></Field>
    </>),
    ok: 'Crear proyecto',
    onOk: (v) => call('projects.create', { name: v.name.trim(), notes: v.notes.trim() })
  });
  if (p) { toast.success(`Proyecto ${p.name} creado`); await refresh().catch(() => {}); }
  return p;
}

export async function linkFolderFlow() {
  const folder = await bridge.pickFolder('Carpeta del proyecto');
  if (!folder) return null;
  const p = await form('Vincular carpeta', {
    description: 'La carpeta se queda donde está; los agentes podrán trabajar en ella. (Lo normal es tener los proyectos dentro de la carpeta del asistente.)',
    initial: { name: baseName(folder) },
    body: (v, set) => (<>
      <div className="bg-muted rounded-lg px-3 py-2 font-mono text-xs break-all">{folder}</div>
      <Field label="Nombre del proyecto"><Input autoFocus value={v.name} onChange={(e) => set({ name: e.target.value })} maxLength={60} /></Field>
    </>),
    ok: 'Vincular',
    onOk: (v) => call('projects.import', { name: v.name.trim(), folder })
  });
  if (p) { toast.success(`Proyecto ${p.name} vinculado`); await refresh().catch(() => {}); }
  return p;
}

export async function cloneRepoFlow() {
  const p = await form('Clonar de GitHub', {
    description: `Se descarga dentro de ${home()}.`,
    initial: { repo: '', name: '' },
    body: (v, set) => (<>
      <Field label="Repositorio"><Input autoFocus value={v.repo} onChange={(e) => set({ repo: e.target.value })} placeholder="usuario/repositorio" /></Field>
      <Field label="Nombre del proyecto (opcional)"><Input value={v.name} onChange={(e) => set({ name: e.target.value })} maxLength={60} /></Field>
    </>),
    ok: 'Clonar',
    onOk: (v) => call('projects.clone', { repo: v.repo.trim(), name: v.name.trim() })
  });
  if (p) { toast.success(`Clonado en ${p.path}`); await refresh().catch(() => {}); }
  return p;
}

// The working project of the assistant's chat: pick one, create one, link a folder, or clear it to pick another.
export function ProjectPicker() {
  const projects = useStore((s) => s.projects);
  const active = useStore((s) => s.app?.activeProject);
  const setActive = (name) => act(call('projects.setActive', { name }));
  return (
    <div className="flex items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant={active ? 'soft' : 'outline'} size="xs" className="max-w-56" data-testid="project-picker">
            <Folder className="size-3.5" /><span className="truncate">{active ? active.name : 'Elegir proyecto'}</span><ChevronsUpDown className="size-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Proyectos en tu carpeta</DropdownMenuLabel>
          {projects.length ? projects.map((p) => (
            <DropdownMenuItem key={p.name} onSelect={() => setActive(p.name)}>
              <Folder /><span className="flex-1 truncate">{p.name}</span>{active?.name === p.name ? <Check className="text-primary!" /> : null}
            </DropdownMenuItem>
          )) : <div className="text-muted-foreground px-2 py-1.5 text-xs">Todavía no hay proyectos.</div>}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={async () => { const p = await createProjectFlow(); if (p) setActive(p.name); }}><FolderPlus />Nuevo proyecto</DropdownMenuItem>
          <DropdownMenuItem onSelect={async () => { const p = await linkFolderFlow(); if (p) setActive(p.name); }}><FolderOpen />Vincular una carpeta…</DropdownMenuItem>
          <DropdownMenuItem onSelect={async () => { const p = await cloneRepoFlow(); if (p) setActive(p.name); }}><GithubIcon />Clonar de GitHub…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {active ? <Button variant="ghost" size="icon-sm" className="size-7" title="Quitar este proyecto para elegir otro" onClick={() => setActive('')}><X className="size-3.5" /></Button> : null}
    </div>
  );
}

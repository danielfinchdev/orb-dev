// Projects: the folders inside the assistant's folder (plus any linked one), with git and GitHub actions.
import { useEffect, useState } from 'react';
import { FolderKanban, FolderPlus, FolderOpen, Pin, MessageSquare, BookOpen, Unlink, GitBranch, Save, Upload, RefreshCw, GitPullRequest, Folder, ScanSearch } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page.jsx';
import { confirm, form } from '@/components/dialogs.jsx';
import { createProjectFlow, linkFolderFlow, cloneRepoFlow } from '@/components/project-actions.jsx';
import { newConversation } from './session.jsx';
import { askReview } from './tasks.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Badge, Card, CardContent, CardHeader, CardTitle, CardDescription, Empty, Field, Input, Spinner } from '@/components/ui/basic.jsx';
import { Checkbox } from '@/components/ui/overlay.jsx';
import { useStore, call, act, go, bridge } from '@/lib/store.js';
import { cn } from '@/lib/utils.js';
import { GithubIcon } from '@/components/agent-icon.jsx';

function GithubCard() {
  const [gh, setGh] = useState(null);
  const load = () => { setGh(null); call('github.status').then(setGh).catch((e) => setGh({ error: e.message })); };
  useEffect(load, []);
  return (
    <Card className="flex-row items-center gap-3 px-5 py-3.5">
      <GithubIcon className="size-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-medium">GitHub</div>
        <div className="text-muted-foreground text-xs">Con tu propia cuenta a través del programa oficial (gh). La app nunca ve tu contraseña ni tus tokens.</div>
      </div>
      {!gh ? <Spinner /> : !gh.installed ? (<><Badge variant="secondary">GitHub CLI no instalado</Badge><Button size="sm" variant="outline" onClick={() => bridge.openExternal('https://cli.github.com/')}>Descargar</Button></>)
        : gh.loggedIn ? <Badge variant="success">Conectado como {gh.user ?? '?'}</Badge>
          : (<><Badge variant="destructive">Sin sesión</Badge><Button size="sm" onClick={() => act(call('github.login'), 'Sigue los pasos en la ventana que se ha abierto y pulsa Comprobar')}>Iniciar sesión</Button></>)}
      <Button size="icon-sm" variant="ghost" onClick={load} title="Comprobar"><RefreshCw /></Button>
    </Card>
  );
}

function ProjectDetail({ p }) {
  const [info, setInfo] = useState(null);
  const load = () => { setInfo(null); call('projects.info', { name: p.name }).then(setInfo).catch((e) => setInfo({ git: false, error: e.message })); };
  useEffect(load, [p.name]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = async () => {
    const r = await form('Guardar cambios', { description: 'Se guardan en git todos los cambios de la carpeta. Los archivos que parecen secretos lo impiden.', initial: { message: '' },
      body: (v, set) => <Field label="Mensaje"><Input autoFocus value={v.message} onChange={(e) => set({ message: e.target.value })} maxLength={200} placeholder="Qué cambia, en una frase" /></Field>,
      ok: 'Guardar', onOk: (v) => call('projects.commit', { name: p.name, message: v.message }) });
    if (r) { toast.success(`Guardados ${r.files} archivo(s)`); load(); }
  };
  const publish = async () => {
    const r = await form('Publicar en GitHub', { description: 'Se crea un repositorio en tu cuenta de GitHub y se sube el proyecto.', initial: { repo: p.name.replace(/[^\w.-]+/g, '-'), isPrivate: true },
      body: (v, set) => (<><Field label="Nombre del repositorio"><Input value={v.repo} onChange={(e) => set({ repo: e.target.value })} /></Field><label className="flex cursor-pointer items-center gap-2 text-sm"><Checkbox checked={v.isPrivate} onCheckedChange={(c) => set({ isPrivate: c === true })} />Privado</label></>),
      ok: 'Publicar', onOk: (v) => call('projects.createRepo', { name: p.name, repo: v.repo.trim(), isPrivate: v.isPrivate }) });
    if (r) { toast.success(`Publicado: ${r.url}`); load(); }
  };
  return (
    <Card className="gap-5">
      <CardHeader className="flex-row items-start gap-3">
        <Folder className="text-primary mt-0.5 size-5 shrink-0" />
        <div className="min-w-0 flex-1"><CardTitle className="text-[17px]">{p.name}</CardTitle><CardDescription className="mt-1 font-mono text-xs break-all">{p.path}</CardDescription></div>
        {p.active ? <Badge><Pin />Proyecto de trabajo</Badge> : null}
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {!p.active ? <Button size="sm" onClick={() => act(call('projects.setActive', { name: p.name }), `Ahora se trabaja en ${p.name}`)}><Pin />Trabajar aquí</Button> : null}
        {bridge.mobile ? null : <Button size="sm" variant="outline" onClick={() => act(bridge.openPath(p.path))}><FolderOpen />Abrir carpeta</Button>}
        <Button size="sm" variant="outline" onClick={() => newConversation({ project: p.name })}><MessageSquare />Conversación aquí</Button>
        <Button size="sm" variant="outline" onClick={() => askReview({ project: p.name })} data-testid="project-review"><ScanSearch />Task Review</Button>
        <Button size="sm" variant="outline" onClick={() => go({ view: 'logs', name: p.name })}><BookOpen />Bitácora</Button>
        {!p.inHome ? <Button size="sm" variant="danger" onClick={async () => { if (await confirm('Desvincular carpeta', `${p.name} deja de aparecer en la app. La carpeta y sus archivos NO se borran.`, { ok: 'Desvincular', danger: true })) act(call('projects.remove', { name: p.name }), 'Desvinculada'); }}><Unlink />Desvincular</Button> : null}
      </CardContent>
      {p.notes ? <CardContent className="text-muted-foreground text-sm">{p.notes}</CardContent> : null}
      <CardContent className="grid gap-3">
        <div className="text-muted-foreground flex items-center gap-1.5 text-xs"><GitBranch className="size-3.5" />Git y GitHub</div>
        {!info ? <Spinner /> : !info.git ? <p className="text-muted-foreground text-sm">{info.error ?? 'Esta carpeta no usa git: las tareas se pueden deshacer igualmente (con una copia), pero no hay ramas ni GitHub.'}</p> : (<>
          <dl className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-1.5 text-[13px]">
            <dt className="text-muted-foreground">Rama actual</dt><dd className="font-mono text-xs">{info.branch}</dd>
            <dt className="text-muted-foreground">Cambios sin guardar</dt><dd>{info.changes ? `${info.changes} archivo(s)` : 'ninguno'}</dd>
            <dt className="text-muted-foreground">Remoto</dt><dd className="break-all">{info.remote ?? 'sin publicar'}</dd>
            {info.ahead != null ? <><dt className="text-muted-foreground">Por subir</dt><dd>{info.ahead} commit(s)</dd></> : null}
          </dl>
          <div className="flex flex-wrap gap-2">
            {info.changes ? <Button size="sm" variant="outline" onClick={commit}><Save />Guardar cambios (commit)</Button> : null}
            {info.remote ? <Button size="sm" variant="outline" onClick={async () => { if (await confirm('Subir a GitHub', `Se sube la rama ${info.branch} a ${info.remote} (git push).`, { ok: 'Subir' })) { await act(call('projects.push', { name: p.name, branch: info.branch }), 'Subido'); load(); } }}><Upload />Subir rama (push)</Button>
              : <Button size="sm" variant="outline" onClick={publish}><GithubIcon />Publicar en GitHub</Button>}
          </div>
          {info.branches?.length > 1 ? <div className="flex flex-wrap gap-1.5">{info.branches.map((b) => <Badge key={b} variant="secondary" className="font-mono font-normal">{b}</Badge>)}</div> : null}
          {info.prs?.length ? <div className="grid gap-1.5"><div className="text-muted-foreground text-xs">Pull requests abiertos</div>{info.prs.map((pr) => <a key={pr.number} className="flex cursor-pointer items-center gap-2 text-sm hover:underline" onClick={() => bridge.openExternal(pr.url)}><GitPullRequest className="text-success size-4" />#{pr.number} {pr.title}<span className="text-muted-foreground text-xs">{pr.headRefName}</span></a>)}</div> : null}
        </>)}
      </CardContent>
    </Card>
  );
}

export function ProjectsView({ route }) {
  const projects = useStore((s) => s.projects);
  const app = useStore((s) => s.app);
  const [selected, setSelected] = useState(route.name ?? app.activeProject?.name ?? projects[0]?.name ?? null);
  const current = projects.find((p) => p.name === selected) ?? null;
  const pick = (p) => p && setSelected(p.name);
  return (
    <>
      <PageHeader icon={<FolderKanban className="text-primary size-5" />} title="Proyectos" meta={`Cada carpeta dentro de ${app.home} es un proyecto`}>
        {bridge.mobile ? null : <><Button size="sm" variant="ghost" onClick={async () => pick(await cloneRepoFlow())}><GithubIcon />Clonar</Button>
        <Button size="sm" variant="ghost" onClick={async () => pick(await linkFolderFlow())}><FolderOpen />Vincular carpeta</Button></>}
        <Button size="sm" onClick={async () => pick(await createProjectFlow())}><FolderPlus />Nuevo proyecto</Button>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 md:pb-28">
        <div className="grid gap-4">
          {bridge.mobile ? null : <GithubCard />}
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(280px,1fr)_minmax(400px,1.4fr)]">
            <Card className="gap-0 overflow-hidden py-0">
              {projects.length ? projects.map((p) => (
                <button key={p.name} onClick={() => setSelected(p.name)} className={cn('flex w-full cursor-pointer items-center gap-3 border-b px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-accent/50', selected === p.name && 'bg-accent')}>
                  <Folder className={cn('size-4 shrink-0', p.active ? 'text-primary' : 'text-muted-foreground')} />
                  <div className="min-w-0 flex-1"><div className="truncate">{p.name}</div><div className="text-muted-foreground truncate font-mono text-[11px]">{p.path}</div></div>
                  {p.open ? <Badge variant="info">{p.open} {p.open === 1 ? 'abierta' : 'abiertas'}</Badge> : null}
                  {p.active ? <Pin className="text-primary size-3.5" /> : null}
                </button>
              )) : <Empty icon={FolderKanban} title="Todavía no hay proyectos">Crea uno nuevo, clona un repositorio o crea una carpeta dentro de {app.home}.</Empty>}
            </Card>
            {current ? <ProjectDetail key={current.name} p={current} /> : <Card><Empty icon={Folder} title="Elige un proyecto" /></Card>}
          </div>
        </div>
      </div>
    </>
  );
}

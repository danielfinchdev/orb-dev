// Agents: which CLIs are installed, their login, models and how much of each subscription window is used.
import { useEffect, useState } from 'react';
import { Bot, RefreshCw, LogIn, ChevronRight, ExternalLink, UserPlus, Trash2, FolderOpen } from 'lucide-react';
import { confirm, form } from '@/components/dialogs.jsx';
import { Installer } from '@/components/installer.jsx';
import { PageHeader } from '@/components/page.jsx';
import { AgentIcon } from '@/components/agent-icon.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Badge, Card, CardContent, CardHeader, CardTitle, CardDescription, Field, Input, Spinner } from '@/components/ui/basic.jsx';
import { Switch, Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/overlay.jsx';
import { cn } from '@/lib/utils.js';
import { useStore, call, act, bridge, setState, getState } from '@/lib/store.js';
import { LOGIN } from '@/lib/labels.js';

const INSTALL = { claude: 'https://docs.claude.com/en/docs/claude-code/setup', codex: 'https://developers.openai.com/codex/cli', cursor: 'https://cursor.com/cli',
  gemini: 'https://github.com/google-gemini/gemini-cli', opencode: 'https://opencode.ai', qwen: 'https://github.com/QwenLM/qwen-code', copilot: 'https://github.com/github/copilot-cli' };
const WINDOW = { five_hour: '5 h', seven_day: 'semana', seven_day_opus: 'semana Opus', seven_day_sonnet: 'semana Sonnet', '300min': '5 h', '10080min': 'semana', '43200min': 'mes' };
// How each agent is connected (2.3: all of them live).
const KIND = { sdk: 'En directo (Agent SDK)', 'app-server': 'En directo (app-server)', 'cli-stream': 'En directo (CLI en streaming)', acp: 'En directo (ACP)' };

async function save(agent, patch) {
  const config = await act(call('config.save', { patch: { agents: { [agent]: patch } } }), 'Guardado');
  if (config) setState({ app: { ...getState().app, config } });
  return config;
}

// The subscriptions of one agent: each with its own login folder, so two Codex or three Claude accounts never mix.
function Accounts({ a, reload }) {
  const add = async () => {
    const r = await form(`Añadir cuenta de ${a.label}`, {
      description: 'Cada cuenta tiene su propia carpeta de sesión: puedes iniciar sesión con otra suscripción sin cerrar la que ya tienes.',
      initial: { label: `${a.label} ${a.accounts.length + 1}`, home: '' },
      body: (v, set) => (<>
        <Field label="Nombre de la cuenta"><Input autoFocus value={v.label} onChange={(e) => set({ label: e.target.value })} maxLength={60} /></Field>
        <Field label="Carpeta de la sesión" hint={v.home ? 'Se usará esa carpeta (útil si ya tienes una sesión iniciada ahí, por ejemplo .codex-pro).' : 'Vacío = una carpeta nueva dentro de la del asistente.'}>
          <div className="flex gap-2"><Input value={v.home} onChange={(e) => set({ home: e.target.value })} placeholder="Nueva (recomendado)" /><Button type="button" variant="outline" size="icon" onClick={async () => { const f = await bridge.pickFolder('Carpeta de sesión existente'); if (f) set({ home: f }); }}><FolderOpen /></Button></div>
        </Field>
      </>),
      ok: 'Añadir', onOk: (v) => call('accounts.add', { agent: a.id, label: v.label.trim(), home: v.home.trim() })
    });
    if (r) { reload(); if (await confirm('Cuenta añadida', `Ahora inicia sesión en «${r.label}» con la suscripción que quieras usar.`, { ok: 'Iniciar sesión', cancel: 'Más tarde' })) act(call('agents.login', { account: r.id }), 'Sigue los pasos en la ventana que se ha abierto'); }
  };
  if (!a.installed) return null;
  return (
    <div className="grid gap-1.5">
      <div className="text-muted-foreground text-xs">Cuentas</div>
      {a.accounts.map((acc) => {
        const login = LOGIN[acc.login] ?? LOGIN.desconocido;
        return (
          <div key={acc.id} className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 ${acc.enabled === false ? 'opacity-60' : ''}`}>
            <div className="min-w-0 flex-1"><div className="truncate text-[13px]">{acc.label}</div><div className="text-muted-foreground truncate font-mono text-[10px]" title={acc.dir}>{acc.dir}</div></div>
            <Badge variant={login[1]}>{login[0]}</Badge>
            <Button size="icon-sm" variant="ghost" title="Iniciar sesión" onClick={() => act(call('agents.login', { account: acc.id }), 'Sigue los pasos en la ventana que se ha abierto')}><LogIn /></Button>
            <Switch checked={acc.enabled !== false} onCheckedChange={(enabled) => act(call('accounts.update', { id: acc.id, enabled })).then(reload)} aria-label="Usar esta cuenta" />
            {acc.id !== acc.agent ? <Button size="icon-sm" variant="danger" title="Quitar la cuenta (no cierra la sesión ni borra su carpeta)" onClick={async () => { if (await confirm('Quitar cuenta', `«${acc.label}» deja de usarse. Su carpeta y su sesión se quedan en el disco.`, { ok: 'Quitar', danger: true })) act(call('accounts.remove', { id: acc.id }), 'Cuenta quitada').then(reload); }}><Trash2 /></Button> : null}
          </div>
        );
      })}
      {a.multi ? <Button size="sm" variant="ghost" className="justify-start" onClick={add}><UserPlus />Añadir otra cuenta</Button> : <p className="text-muted-foreground text-[11px]">{a.label} guarda su sesión en un sitio fijo: una sola cuenta.</p>}
    </div>
  );
}

function AgentCard({ a, reload }) {
  const cfg = useStore((s) => s.app.config.agents[a.id]);
  const [form, setForm] = useState({ models: (cfg.models ?? []).join(', '), defaultModel: cfg.defaultModel ?? '', strengths: cfg.strengths ?? '', path: cfg.path ?? '' });
  const login = LOGIN[a.login] ?? LOGIN.desconocido;
  return (
    <Card>
      <CardHeader className="flex-row items-start gap-3 [&>svg]:mt-0.5 [&>svg]:shrink-0">
        <AgentIcon agent={a.id} className="size-6" />
        <div className="flex-1"><CardTitle>{a.label}</CardTitle><CardDescription>{a.installed ? a.version ?? 'Instalado' : 'No encontrado en este equipo'}{a.installed && KIND[a.kind] ? ` · ${KIND[a.kind]}` : ''}</CardDescription></div>
        <Switch checked={cfg.enabled} onCheckedChange={(enabled) => save(a.id, { enabled })} aria-label="Activado" />
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap gap-1.5">
          {a.installed ? <Badge variant="success">Instalado</Badge> : <Badge variant="destructive">No encontrado</Badge>}
          {a.installed ? <Badge variant={login[1]}>{login[0]}</Badge> : null}
          {!cfg.enabled ? <Badge variant="secondary">Desactivado</Badge> : null}
        </div>
        {a.where ? <div className="text-muted-foreground font-mono text-[11px] break-all">{a.where}</div> : null}
        <div className="flex flex-wrap gap-2">
          {!a.installed ? <Button size="sm" variant="outline" onClick={() => bridge.openExternal(INSTALL[a.id])}><ExternalLink />Cómo instalarlo</Button> : null}
          <Button size="sm" variant="ghost" onClick={() => act(call('agents.check', { agent: a.id })).then(reload)}><RefreshCw />Comprobar</Button>
        </div>
        <Accounts a={a} reload={reload} />
        <Collapsible>
          <CollapsibleTrigger className="text-muted-foreground group flex cursor-pointer items-center gap-1 text-xs"><ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />Modelos y ajustes</CollapsibleTrigger>
          <CollapsibleContent className="mt-3 grid gap-3">
            <Field label="Modelos permitidos" hint="Separados por comas. Vacío = el modelo predeterminado del programa."><Input value={form.models} onChange={(e) => setForm({ ...form, models: e.target.value })} /></Field>
            <Field label="Modelo por defecto"><Input value={form.defaultModel} onChange={(e) => setForm({ ...form, defaultModel: e.target.value })} /></Field>
            <Field label="En qué es bueno" hint="El asistente lo usa para repartir el trabajo."><Input value={form.strengths} onChange={(e) => setForm({ ...form, strengths: e.target.value })} /></Field>
            <Field label="Ruta del programa" hint="Solo si no lo encuentra solo."><Input value={form.path} onChange={(e) => setForm({ ...form, path: e.target.value })} placeholder="automático" /></Field>
            <div><Button size="sm" onClick={() => save(a.id, { models: form.models.split(',').map((m) => m.trim()).filter(Boolean), defaultModel: form.defaultModel.trim(), strengths: form.strengths.trim(), path: form.path.trim() }).then(reload)}>Guardar</Button></div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

export function AgentsView() {
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
      <PageHeader icon={<Bot className="text-primary size-5" />} title="Agentes" meta="Se usan los programas y las cuentas que ya tienes; la app nunca ve tus contraseñas">
        <Button size="sm" variant="outline" onClick={() => { setAgents(null); load(true); }}><RefreshCw />Comprobar todo</Button>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-5 py-5">
        <div className="grid gap-4">
          {system?.platform === 'win32' ? (
            <Card>
              <CardHeader><CardTitle>Instalar agentes y herramientas</CardTitle><CardDescription>Con los instaladores oficiales de cada uno, en una ventana visible.</CardDescription></CardHeader>
              <CardContent><Installer onChange={() => load()} /></CardContent>
            </Card>
          ) : null}
          {system && !system.git ? (
            <Card className="border-warning/50 flex-row items-center gap-3 px-5 py-3.5">
              <div className="min-w-0 flex-1"><div className="text-[14px] font-medium">Falta Git</div><div className="text-muted-foreground text-xs">Sin Git las tareas se pueden deshacer igualmente (con copias), pero no hay ramas, copias aisladas ni GitHub.</div></div>
              <Button size="sm" variant="outline" onClick={() => bridge.openExternal('https://git-scm.com/download/win')}><ExternalLink />Descargar Git</Button>
            </Card>
          ) : null}
          <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">{agents ? agents.map((a) => <AgentCard key={a.id} a={a} reload={() => load(true)} />) : <Card className="items-center"><Spinner /></Card>}</div>
          <Card>
            <CardHeader><CardTitle>Uso de cada cuenta</CardTitle><CardDescription>El cupo real lo dicen Claude y Codex (cuánto llevas de su ventana y cuándo se reinicia): al {Math.round((usage[0]?.stopAt ?? 0.92) * 100)} % las tareas nuevas esperan o van a otra cuenta. Las tareas lanzadas en las últimas {usage[0]?.windowHours ?? 5} h son solo una red de seguridad.</CardDescription></CardHeader>
            <CardContent className="grid gap-4">
              {usage.map((u) => (
                <div key={u.account} className="grid gap-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-sm"><AgentIcon agent={u.agent} /><span className="min-w-28">{u.label}</span>
                    {u.real ? <span className="text-xs">{Math.round(u.real.utilization * 100)} % del cupo real{u.real.window ? ` (${WINDOW[u.real.window] ?? u.real.window})` : ''}{u.real.resetAt ? ` · se reinicia ${new Date(u.real.resetAt).toLocaleString('es-ES', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}</span> : null}
                    <span className="text-muted-foreground text-xs">{u.used}/{u.max} tareas · {u.heavy}/{u.maxHeavy} con modelos caros</span>
                    {u.cooldownUntil ? <Badge variant="destructive">sin cupo hasta las {new Date(u.cooldownUntil).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</Badge> : null}</div>
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

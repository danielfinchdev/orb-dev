// Settings: the assistant, its brain, how tasks run, usage caps, extra MCP connectors and the assistant's folder.
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { toast } from 'sonner';
import { Settings, FolderOpen, Plus, Trash2, ArrowLeftRight, Smartphone, QrCode, Globe, PictureInPicture2, SquareTerminal, ZoomIn, ZoomOut, MonitorCog } from 'lucide-react';
import { PANELS, savePanels } from './expert.jsx';
import { PageHeader } from '@/components/page.jsx';
import { Robot } from '@/components/robot.jsx';
import { confirm, form } from '@/components/dialogs.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter, Field, Input, Textarea, Kbd } from '@/components/ui/basic.jsx';
import { Select, Switch, Checkbox } from '@/components/ui/overlay.jsx';
import { useStore, call, act, bridge, setState, getState, applyTheme, go, openTerminal } from '@/lib/store.js';

async function save(patch, ok = 'Guardado') {
  const config = await act(call('config.save', { patch }), ok);
  if (config) { setState({ app: { ...getState().app, config } }); applyTheme(config.ui?.theme); }
  return config;
}
const num = (v) => Number(v) || 0;
// The whole row is the switch's label: clicking its text toggles it too (the switch alone is a small target).
function Row({ label, hint, children }) {
  return <label className="-mx-2 flex cursor-pointer items-center justify-between gap-4 rounded-lg px-2 py-1.5 hover:bg-accent/40"><div><div className="text-sm">{label}</div>{hint ? <div className="text-muted-foreground text-xs">{hint}</div> : null}</div>{children}</label>;
}

function AssistantCard({ c }) {
  const [v, setV] = useState({ assistantName: c.assistantName, userName: c.userName, language: c.language, theme: c.ui?.theme ?? 'sistema', companion: c.ui?.companion !== false });
  return (
    <Card>
      <CardHeader className="flex-row items-center gap-3"><Robot size={40} /><div><CardTitle>Asistente</CardTitle><CardDescription>Su nombre, cómo te llama y cómo se ve.</CardDescription></div></CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nombre del asistente"><Input value={v.assistantName} onChange={(e) => setV({ ...v, assistantName: e.target.value })} maxLength={40} /></Field>
          <Field label="Cómo te llama"><Input value={v.userName} onChange={(e) => setV({ ...v, userName: e.target.value })} maxLength={40} /></Field>
          <Field label="Idioma de las respuestas"><Select className="w-full" value={v.language} onValueChange={(language) => setV({ ...v, language })} options={[{ value: 'es', label: 'Español' }, { value: 'en', label: 'English' }]} /></Field>
          <Field label="Tema"><Select className="w-full" value={v.theme} onValueChange={(theme) => setV({ ...v, theme })} options={[{ value: 'sistema', label: 'Como Windows' }, { value: 'claro', label: 'Día' }, { value: 'oscuro', label: 'Noche' }]} /></Field>
        </div>
        <Row label="Robot flotante" hint="Aparece en una esquina con avisos cuando no estás en el chat."><Switch checked={v.companion} onCheckedChange={(companion) => { setV({ ...v, companion }); save({ ui: { companion } }, companion ? 'Robot flotante activado' : 'Robot flotante desactivado'); }} /></Row>
      </CardContent>
      <CardFooter><Button size="sm" onClick={() => save({ assistantName: v.assistantName.trim(), userName: v.userName.trim(), language: v.language, ui: { theme: v.theme, companion: v.companion } })}>Guardar</Button></CardFooter>
    </Card>
  );
}

function BrainCard({ c }) {
  const o = c.orchestrator;
  const [v, setV] = useState({ model: o.model, reasoning: o.reasoning, maxTurns: o.maxTurns, orchestrate: o.orchestrate !== false, account: o.account ?? 'claude' });
  const claudeAccounts = (c.accounts ?? []).filter((a) => a.agent === 'claude');
  return (
    <Card>
      <CardHeader><CardTitle>Cerebro del asistente</CardTitle><CardDescription>Piensa con Claude Code y tu suscripción. Sonnet ahorra; Opus es más capaz y gasta más.</CardDescription></CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Modelo"><Select className="w-full" value={v.model} onValueChange={(model) => setV({ ...v, model })} options={o.models.map((m) => ({ value: m.id, label: m.label }))} /></Field>
          <Field label="Razonamiento"><Select className="w-full" value={v.reasoning} onValueChange={(reasoning) => setV({ ...v, reasoning })} options={[{ value: 'low', label: 'Bajo' }, { value: 'medium', label: 'Medio' }, { value: 'high', label: 'Alto' }]} /></Field>
        </div>
        {claudeAccounts.length > 1 ? <Field label="Cuenta de Claude que usa el asistente"><Select className="w-full" value={v.account} onValueChange={(account) => setV({ ...v, account })} options={claudeAccounts.map((a) => ({ value: a.id, label: a.label }))} /></Field> : null}
        <Field label="Mensajes antes de renovar la conversación" hint="Renovarla ahorra tokens; el tablero y las bitácoras no se pierden."><Input type="number" min={2} max={200} value={v.maxTurns} onChange={(e) => setV({ ...v, maxTurns: num(e.target.value) })} className="w-28" /></Field>
        <Row label="Orquestador" hint="Marcado: solo coordina. Desmarcado: modo libre, trabaja directamente en el proyecto."><Switch checked={v.orchestrate} onCheckedChange={async (orchestrate) => { if (!orchestrate && !(await confirm('Modo libre', `Sin «Orquestador», ${c.assistantName} podrá leer, ejecutar comandos y editar archivos directamente en la carpeta del proyecto. Seguirá sin poder hacer push ni publicar.`, { ok: 'Activar modo libre' }))) return; const r = await act(call('chat.settings', { orchestrate })); if (r) { setV({ ...v, orchestrate }); setState((s) => ({ app: { ...s.app, assistant: r } })); } }} /></Row>
      </CardContent>
      <CardFooter><Button size="sm" onClick={() => save({ orchestrator: v })}>Guardar</Button></CardFooter>
    </Card>
  );
}

function TasksCard({ c }) {
  const agents = Object.keys(c.agents);
  const [v, setV] = useState({ autoRun: c.autoRun, maxParallel: c.maxParallel, perAgent: c.perAgent, timeoutMinutes: c.timeoutMinutes, review: c.review?.auto === true, high: c.policy?.highNeedsApproval !== false, windowHours: c.budget.windowHours, caps: Object.fromEntries(agents.map((a) => [a, { maxTasks: c.budget.agents?.[a]?.maxTasks ?? 6, maxHeavy: c.budget.agents?.[a]?.maxHeavy ?? 2 }])) });
  const cap = (a, k, val) => setV({ ...v, caps: { ...v.caps, [a]: { ...v.caps[a], [k]: num(val) } } });
  return (
    <Card>
      <CardHeader><CardTitle>Tareas y cupo</CardTitle><CardDescription>Cómo se lanzan las tareas y cuánto puede usar cada agente.</CardDescription></CardHeader>
      <CardContent className="grid gap-4">
        <Row label="Lanzar las tareas solas" hint="En cuanto estén listas (aprobadas y con sus dependencias hechas)."><Switch checked={v.autoRun} onCheckedChange={(autoRun) => { setV({ ...v, autoRun }); save({ autoRun }); }} /></Row>
        <Row label="Revisión cruzada automática" hint="Otro agente revisa cada tarea terminada antes del informe."><Switch checked={v.review} onCheckedChange={(review) => { setV({ ...v, review }); save({ review: { auto: review } }); }} /></Row>
        <Row label="Razonamiento alto con aprobación"><Switch checked={v.high} onCheckedChange={(high) => { setV({ ...v, high }); save({ policy: { highNeedsApproval: high } }); }} /></Row>
        <div className="grid grid-cols-4 gap-3">
          <Field label="A la vez"><Input type="number" min={1} max={10} value={v.maxParallel} onChange={(e) => setV({ ...v, maxParallel: num(e.target.value) })} /></Field>
          <Field label="Por agente"><Input type="number" min={1} max={5} value={v.perAgent} onChange={(e) => setV({ ...v, perAgent: num(e.target.value) })} /></Field>
          <Field label="Máx. minutos"><Input type="number" min={5} max={600} value={v.timeoutMinutes} onChange={(e) => setV({ ...v, timeoutMinutes: num(e.target.value) })} /></Field>
          <Field label="Ventana (h)"><Input type="number" min={1} max={24} value={v.windowHours} onChange={(e) => setV({ ...v, windowHours: num(e.target.value) })} /></Field>
        </div>
        <div className="grid gap-2">
          <div className="text-muted-foreground grid grid-cols-3 gap-3 text-xs"><span>Agente</span><span>Tareas por ventana</span><span>Con modelos caros</span></div>
          {agents.map((a) => <div key={a} className="grid grid-cols-3 items-center gap-3"><span className="text-sm">{a}</span><Input type="number" min={1} value={v.caps[a].maxTasks} onChange={(e) => cap(a, 'maxTasks', e.target.value)} /><Input type="number" min={0} value={v.caps[a].maxHeavy} onChange={(e) => cap(a, 'maxHeavy', e.target.value)} /></div>)}
        </div>
      </CardContent>
      <CardFooter><Button size="sm" onClick={() => save({ autoRun: v.autoRun, maxParallel: v.maxParallel, perAgent: v.perAgent, timeoutMinutes: v.timeoutMinutes, review: { auto: v.review }, policy: { highNeedsApproval: v.high }, budget: { windowHours: v.windowHours, agents: v.caps } })}>Guardar</Button></CardFooter>
    </Card>
  );
}

function McpCard({ c }) {
  const add = () => form('Añadir conector MCP', {
    description: 'Los conectores dan herramientas extra a los agentes (navegador, bases de datos…). Se ejecutan en tu equipo: añade solo programas en los que confíes.',
    initial: { name: '', command: '', args: '', agents: '' },
    body: (v, set) => (<>
      <Field label="Nombre"><Input autoFocus value={v.name} onChange={(e) => set({ name: e.target.value })} placeholder="navegador" /></Field>
      <Field label="Comando"><Input value={v.command} onChange={(e) => set({ command: e.target.value })} placeholder="npx" /></Field>
      <Field label="Argumentos" hint="Separados por espacios."><Input value={v.args} onChange={(e) => set({ args: e.target.value })} placeholder="@playwright/mcp@latest" /></Field>
      <Field label="Agentes" hint="Vacío = todos. O por ejemplo: claude, codex"><Input value={v.agents} onChange={(e) => set({ agents: e.target.value })} /></Field>
    </>),
    ok: 'Añadir',
    onOk: async (v) => {
      const entry = { name: v.name.trim(), command: v.command.trim(), args: v.args.trim() ? v.args.trim().split(/\s+/) : [], agents: v.agents.split(',').map((x) => x.trim()).filter(Boolean), enabled: true };
      const config = await call('config.save', { patch: { mcpServers: [...c.mcpServers, entry] } });
      setState({ app: { ...getState().app, config } });
      return true;
    }
  });
  return (
    <Card>
      <CardHeader><CardTitle>Conectores MCP</CardTitle><CardDescription>Herramientas extra para los agentes: bases de datos, Figma, tu calendario…</CardDescription></CardHeader>
      <CardContent className="grid gap-2">
        {c.mcpServers.length ? c.mcpServers.map((s, i) => (
          <div key={s.name} className="flex items-center gap-3 rounded-lg border px-3 py-2">
            <div className="min-w-0 flex-1"><div className="text-sm">{s.name}</div><div className="text-muted-foreground truncate font-mono text-xs">{s.command} {(s.args ?? []).join(' ')}</div></div>
            <span className="text-muted-foreground text-xs">{s.agents?.length ? s.agents.join(', ') : 'todos'}</span>
            <Button variant="danger" size="icon-sm" onClick={async () => { if (await confirm('Quitar conector', `¿Quitar ${s.name}?`, { ok: 'Quitar', danger: true })) save({ mcpServers: c.mcpServers.filter((_, j) => j !== i) }); }}><Trash2 /></Button>
          </div>
        )) : <p className="text-muted-foreground text-sm">Ninguno todavía.</p>}
      </CardContent>
      <CardFooter><Button size="sm" variant="outline" onClick={add}><Plus />Añadir conector</Button></CardFooter>
    </Card>
  );
}

function FolderCard({ c, home }) {
  const [roots, setRoots] = useState((c.projectRoots ?? []).join('\n'));
  return (
    <Card>
      <CardHeader><CardTitle>Carpeta del asistente</CardTitle><CardDescription>Ahí está todo: los proyectos (una carpeta cada uno), las bitácoras y los datos de la app (en .orb, oculta).</CardDescription></CardHeader>
      <CardContent className="grid gap-4">
        <div className="bg-muted rounded-lg px-3 py-2 font-mono text-xs break-all">{home}</div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => act(bridge.openPath(home))}><FolderOpen />Abrir</Button>
          <Button size="sm" variant="ghost" onClick={async () => { const f = await bridge.pickFolder('Carpeta de otro asistente (con orb.json)'); if (f && await confirm('Cambiar de carpeta', `La app se reiniciará usando ${f}.`, { ok: 'Cambiar' })) act(bridge.switchHome(f)); }}><ArrowLeftRight />Usar otra carpeta…</Button>
        </div>
        <Field label="Otras carpetas donde los agentes pueden registrar proyectos" hint="Una por línea. Normalmente no hace falta: todo vive en la carpeta del asistente."><Textarea rows={2} value={roots} onChange={(e) => setRoots(e.target.value)} /></Field>
      </CardContent>
      <CardFooter><Button size="sm" onClick={() => save({ projectRoots: roots.split(/\r?\n/).map((x) => x.trim()).filter(Boolean) })}>Guardar</Button></CardFooter>
    </Card>
  );
}

// Phone access: on/off, the address, a one-time QR to pair a phone, and the paired devices (each can be removed).
function MobileCard() {
  const [st, setSt] = useState(null);
  const [qr, setQr] = useState(null);
  const load = () => call('remote.status').then(setSt).catch(() => {});
  useEffect(() => { load(); }, []);
  useEffect(() => { if (!qr) return undefined; const t = setInterval(() => { if (Date.now() > qr.expiresAt) setQr(null); }, 1000); return () => clearInterval(t); }, [qr]);
  const pair = async () => {
    const r = await act(call('remote.pair'));
    if (r) setQr({ ...r, svg: await QRCode.toString(r.url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) });
  };
  if (!st) return null;
  return (
    <Card>
      <CardHeader className="flex-row items-center gap-3"><Smartphone className="text-primary size-5" /><div><CardTitle>Móvil</CardTitle><CardDescription>Usa el asistente desde el móvil como una app, a través de Tailscale (solo tus dispositivos lo ven).</CardDescription></div></CardHeader>
      <CardContent className="grid gap-4">
        <Row label="Acceso desde el móvil" hint={st.running ? st.url : st.error ?? 'Desactivado'}><Switch checked={st.enabled} onCheckedChange={async (enabled) => { const r = await act(call('remote.enable', { enabled })); if (r) setSt(r); }} /></Row>
        {st.running ? (
          <div className="grid gap-3">
            {qr ? (
              <div className="grid justify-items-center gap-2 rounded-xl border p-4 text-center">
                <img alt="Código QR para vincular" className="size-52 rounded-lg bg-white p-2" src={`data:image/svg+xml;utf8,${encodeURIComponent(qr.svg)}`} />
                <p className="text-sm">Escanéalo con la cámara del móvil (con Tailscale activo). Caduca en 5 minutos y sirve una sola vez.</p>
                <p className="text-muted-foreground text-xs">Después, en Vivaldi o Chrome: menú → «Instalar app» o «Añadir a pantalla de inicio», y tendrás el icono del robot.</p>
              </div>
            ) : <div><Button size="sm" onClick={pair}><QrCode />Vincular un móvil</Button></div>}
            <div className="grid gap-1.5">
              <div className="text-muted-foreground text-xs">Dispositivos vinculados</div>
              {st.devices.length ? st.devices.map((d) => (
                <div key={d.id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                  <Smartphone className="text-muted-foreground size-4" /><span className="flex-1">{d.name}</span><span className="text-muted-foreground text-xs">{d.last_seen ? new Date(d.last_seen).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}</span>
                  <Button size="icon-sm" variant="danger" title="Quitar el acceso" onClick={async () => { if (await confirm('Quitar dispositivo', `${d.name} dejará de tener acceso al momento.`, { ok: 'Quitar', danger: true })) { await act(call('remote.revoke', { id: d.id }), 'Acceso quitado'); load(); } }}><Trash2 /></Button>
                </div>
              )) : <p className="text-muted-foreground text-sm">Ninguno todavía.</p>}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// The agents' browser: real pages the agents drive with the orb_browser_* tools, shown live in a little window.
function BrowserCard({ c }) {
  const on = c.browser?.enabled !== false; const pip = c.ui?.pip !== false;
  return (
    <Card>
      <CardHeader className="flex-row items-center gap-3"><Globe className="text-primary size-5" /><div><CardTitle>Navegador de los agentes</CardTitle><CardDescription>Los agentes abren y prueban webs (también las de tus proyectos en localhost) en un navegador propio, sin tus sesiones ni contraseñas.</CardDescription></div></CardHeader>
      <CardContent className="grid gap-4">
        <Row label="Dejar que los agentes naveguen" hint="Abrir páginas, pulsar, escribir y hacer capturas."><Switch checked={on} onCheckedChange={(enabled) => save({ browser: { enabled } })} /></Row>
        <Row label="Ventanita en directo" hint="Arriba a la derecha, encima de todo: ves lo que hace el agente. Se agranda, se contrae o se cierra hasta la próxima vez."><Switch checked={pip} disabled={!on} onCheckedChange={(v) => save({ ui: { pip: v } })} /></Row>
      </CardContent>
      {bridge.showBrowser ? <CardFooter><Button size="sm" variant="outline" disabled={!on || !pip} onClick={async () => { const r = await bridge.showBrowser(); if (!r?.tabs?.length) toast('Ahora mismo ningún agente está usando el navegador.'); }}><PictureInPicture2 />Mostrar la ventanita</Button></CardFooter> : null}
    </Card>
  );
}

// Interface: its size on this PC (also Ctrl + / Ctrl - / Ctrl 0) and the terminal that Ctrl+J opens.
export const SIZES = [{ value: '0.87', label: 'Pequeña' }, { value: '1', label: 'Normal' }, { value: '1.15', label: 'Grande' }];
function InterfaceCard({ c }) {
  const [zoom, setZoom] = useState(null);
  const terminals = { auto: 'Automática (Warp si está instalado)', warp: 'Warp', wt: 'Windows Terminal', powershell: 'PowerShell', cmd: 'Símbolo del sistema (CMD)' };
  useEffect(() => { bridge.zoom?.().then(setZoom).catch(() => {}); return bridge.on('ui:zoom', (p) => setZoom(p.zoom)); }, []);
  if (!bridge.zoom) return null; // phone: the browser has its own zoom
  const preset = SIZES.find((o) => Math.abs(Number(o.value) - zoom) < 0.01)?.value;
  const change = async (value) => setZoom(await act(bridge.zoom(Number(value))));
  return (
    <Card>
      <CardHeader className="flex-row items-center gap-3"><MonitorCog className="text-primary size-5" /><div><CardTitle>Interfaz</CardTitle><CardDescription>El tamaño de todo en este PC y la terminal que se abre con <Kbd>Ctrl</Kbd> <Kbd>J</Kbd>.</CardDescription></div></CardHeader>
      <CardContent className="grid gap-4">
        <Field label="Tamaño de la interfaz" hint={<>También con <Kbd>Ctrl</Kbd> <Kbd>+</Kbd> para agrandar, <Kbd>Ctrl</Kbd> <Kbd>-</Kbd> para reducir y <Kbd>Ctrl</Kbd> <Kbd>0</Kbd> para volver a «Normal» (o <Kbd>Ctrl</Kbd> + rueda del ratón).</>}>
          <div className="flex flex-wrap items-center gap-2">
            <Select className="w-44" value={preset} placeholder={zoom ? `Personalizado (${Math.round(zoom * 100)} %)` : '…'} onValueChange={change} options={SIZES} />
            <Button size="icon-sm" variant="outline" title="Reducir" onClick={() => change(zoom - 0.1)}><ZoomOut /></Button>
            <Button size="icon-sm" variant="outline" title="Agrandar" onClick={() => change(zoom + 0.1)}><ZoomIn /></Button>
            <span className="text-muted-foreground text-xs tabular-nums">{zoom ? `${Math.round(zoom * 100)} %` : ''}</span>
          </div>
        </Field>
        <Field label="Terminal" hint="Se abre en la carpeta del proyecto que tengas delante (o en la del asistente).">
          <div className="flex flex-wrap items-center gap-2">
            <Select className="w-72 max-w-full" value={c.ui?.terminal ?? 'auto'} onValueChange={(terminal) => save({ ui: { terminal } })} options={Object.entries(terminals).map(([value, label]) => ({ value, label }))} />
            <Button size="sm" variant="outline" onClick={() => openTerminal()}><SquareTerminal />Abrir terminal</Button>
          </div>
        </Field>
      </CardContent>
    </Card>
  );
}

// Expert mode: an IDE-like view (PC only) with the panels the user picks.
function ExpertCard({ c }) {
  const on = c.expert?.enabled === true; const panels = c.expert?.panels ?? {};
  return (
    <Card>
      <CardHeader className="flex-row items-center gap-3"><SquareTerminal className="text-primary size-5" /><div><CardTitle>Modo experto</CardTitle><CardDescription>Para usuarios exigentes: explorador de archivos, cambios de git, historial, carga del equipo y actividad en directo alrededor del chat. Solo en el PC.</CardDescription></div></CardHeader>
      <CardContent className="grid gap-4">
        <Row label="Activar el modo experto" hint="Aparece en el menú de la izquierda (en ventanas anchas)."><Switch checked={on} onCheckedChange={(enabled) => save({ expert: { enabled } }, enabled ? 'Modo experto activado' : 'Modo experto desactivado')} data-testid="expert-switch" /></Row>
        <div className="grid gap-2 sm:grid-cols-2">
          {Object.entries(PANELS).map(([id, label]) => <label key={id} className="hover:bg-accent/40 -mx-1 flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-[13px]"><Checkbox checked={panels[id] !== false} onCheckedChange={(v) => savePanels({ ...panels, [id]: v === true })} />{label}</label>)}
        </div>
      </CardContent>
      {on ? <CardFooter><Button size="sm" variant="outline" onClick={() => go('expert')}><SquareTerminal />Abrir el modo experto</Button></CardFooter> : null}
    </Card>
  );
}

export function SettingsView() {
  const app = useStore((s) => s.app);
  const c = app.config;
  return (
    <>
      <PageHeader icon={<Settings className="text-primary size-5" />} title="Ajustes" meta={`Versión ${app.version}`} />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-2">
          <AssistantCard c={c} /><InterfaceCard c={c} /><BrainCard c={c} /><TasksCard c={c} /><div className="grid content-start gap-4"><MobileCard /><ExpertCard c={c} /><BrowserCard c={c} /><McpCard c={c} /><FolderCard c={c} home={app.home} /></div>
        </div>
      </div>
    </>
  );
}

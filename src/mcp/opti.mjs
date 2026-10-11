// 2.7: MCP server (stdio) of Opti Bot, the PC's health assistant of «Monitoreo del equipo». Only these tools: they read
// how the PC and the assistant's folder are, make a copy of the assistant, and PROPOSE changes. A proposal is a card the
// user approves in the app (engine/opti.mjs runs it, with Windows' own administrator prompt when the action needs it);
// this server never changes anything on the PC by itself.
import readline from 'node:readline';
import { useHome, tr } from '../core/context.mjs';
import { isHome } from '../core/home.mjs';
import { oneLine } from '../core/safety.mjs';
import { health, startup, security, orbCheck, backup } from '../core/pc-health.mjs';
import { readOce } from '../engine/bridge.mjs';
import { wifi, nearby, devices, adbDevices, adbInfo } from '../core/network.mjs';

const home = process.env.ORB_HOME;
if (!home || !isHome(home)) { process.stderr.write('ORB_HOME no apunta a la carpeta de un asistente\n'); process.exit(1); }
useHome(home);
const { Board, userName } = await import('../core/board.mjs');
const board = new Board(undefined, { noKey: true });
const USER = userName();

const ACTIONS = ['defender_quick_scan', 'defender_update', 'clean_temp', 'end_process', 'disable_startup'];
const text = (value) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });

function propose(a) {
  if (!ACTIONS.includes(a.action)) throw new Error(tr('sys.opti.badAction'));
  const reason = oneLine(String(a.reason ?? ''), 300).trim();
  if (!reason) throw new Error(tr('sys.opti.needsReason'));
  const p = { action: a.action, reason };
  if (a.action === 'end_process') { const pid = Number(a.pid); if (!Number.isInteger(pid) || pid <= 4) throw new Error(tr('sys.opti.needsPid')); p.pid = pid; p.name = oneLine(String(a.name ?? ''), 80); }
  if (a.action === 'disable_startup') { const name = oneLine(String(a.name ?? ''), 120).trim(); if (!name) throw new Error(tr('sys.opti.needsName')); p.name = name; }
  const list = board.settingJson('opti_pending') ?? [];
  board.settingJson('opti_pending', [...list, p].slice(-5));
  return `Propuesta mostrada a ${USER} como una tarjeta. No la repitas: espera su respuesta, llegará como su próximo mensaje.`;
}

const tools = [
  { name: 'opti_health', description: 'Salud del PC ahora: carga de CPU, memoria, discos, tiempo encendido, sistema y los procesos que más memoria y CPU gastan. Si Open Control Edge está abierto, también sus lecturas reales de temperatura de CPU y GPU, carga de GPU, VRAM y FPS (openControlEdge; null = no disponible: no lo inventes).', inputSchema: { type: 'object', properties: {} }, run: async () => ({ ...(await health()), openControlEdge: readOce() }) },
  { name: 'opti_network', description: 'La red: la Wi-Fi actual (señal, banda, velocidad, seguridad), las redes cercanas y los equipos de la misma red (IP, MAC, nombre o el que les puso el usuario; router). sweep: true para hacer antes un ping a cada dirección de la red propia (tarda unos 15 s). Solo mira; no escanea puertos.', inputSchema: { type: 'object', properties: { sweep: { type: 'boolean' } } },
    run: async (a) => { const names = board.settingJson('net_names') ?? {}; const d = await devices({ sweep: a.sweep === true }); return { wifi: await wifi(), nearby: await nearby(), me: d.me, devices: d.devices.map((x) => ({ ...x, alias: names[x.mac] ?? null })) }; } },
  { name: 'opti_android', description: 'Móviles y Android TV emparejados por adb: modelo, versión de Android, batería y su temperatura, memoria, almacenamiento y las apps que más memoria usan. Si no hay ninguno, explica cómo emparejarlo desde Monitoreo del equipo › Red.', inputSchema: { type: 'object', properties: {} },
    run: async () => { const { adbPath, adbStatus } = await import('../engine/android.mjs'); if (!adbStatus().ready) return { adb: 'no instalado', devices: [] }; const list = await adbDevices(adbPath()); return { devices: await Promise.all(list.map(async (d) => (d.state === 'device' ? { ...d, info: await adbInfo(adbPath(), d.serial).catch(() => null) } : d))) }; } },
  { name: 'opti_startup', description: 'Programas que arrancan con Windows (nombre, orden, dónde está configurado y de qué usuario).', inputSchema: { type: 'object', properties: {} }, run: () => startup() },
  { name: 'opti_security', description: 'Estado del antivirus (Windows Defender: protección, firmas, últimos análisis y amenazas recientes) y procesos que se ejecutan desde sitios poco habituales (Temp, Descargas).', inputSchema: { type: 'object', properties: {} }, run: () => security() },
  { name: 'opti_orb_check', description: `Comprueba la carpeta del asistente de ${USER}: ajustes legibles, base de datos sana (integrity_check), tamaño de cada parte y copias de seguridad.`, inputSchema: { type: 'object', properties: {} }, run: () => orbCheck(home, board.db) },
  { name: 'opti_backup', description: 'Hace una copia de seguridad del asistente (ajustes, bitácoras y base de datos) en su carpeta de copias. Guarda las 10 últimas.', inputSchema: { type: 'object', properties: {} }, run: () => backup(home, board.db) },
  { name: 'opti_propose', description: `Propone a ${USER} un cambio en el PC, que solo se hace si lo aprueba en la app (y, si hace falta, acepta el aviso de administrador de Windows). defender_quick_scan: análisis rápido del antivirus. defender_update: actualizar sus firmas. clean_temp: borrar archivos temporales de más de 2 días. end_process (pid, name): cerrar un proceso colgado o que gasta mucho. disable_startup (name): que un programa no arranque con Windows (se puede volver a activar).`,
    inputSchema: { type: 'object', required: ['action', 'reason'], properties: {
      action: { type: 'string', enum: ACTIONS }, reason: { type: 'string', description: 'Por qué lo propones, en una frase clara para alguien que no sabe de informática' },
      pid: { type: 'integer', description: 'end_process: el Id del proceso (de opti_health)' }, name: { type: 'string', description: 'end_process: su nombre; disable_startup: el Name exacto de opti_startup' } } },
    run: (a) => propose(a) }
];

const reply = (id, payload) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, ...payload })}\n`);
readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  if (msg.id === undefined) return;
  try {
    if (msg.method === 'initialize') return reply(msg.id, { result: { protocolVersion: msg.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'opti', version: '2.7.0' }, instructions: 'Herramientas de Opti Bot: diagnóstico del PC (solo lectura), copia del asistente y propuestas de cambios que aprueba el usuario.' } });
    if (msg.method === 'ping') return reply(msg.id, { result: {} });
    if (msg.method === 'tools/list') return reply(msg.id, { result: { tools: tools.map(({ run, ...t }) => t) } });
    if (msg.method === 'tools/call') {
      const tool = tools.find((t) => t.name === msg.params?.name);
      if (!tool) return reply(msg.id, { error: { code: -32602, message: `herramienta desconocida: ${msg.params?.name}` } });
      try {
        const args = msg.params.arguments ?? {};
        const extra = Object.keys(args).filter((k) => !(k in (tool.inputSchema.properties ?? {})));
        if (extra.length) throw new Error(tr('sys.mcp.extraArgs', { list: extra.join(', ') }));
        return reply(msg.id, { result: text(await tool.run(args)) });
      } catch (error) { return reply(msg.id, { result: { ...text(`Error: ${error.message}`), isError: true } }); }
    }
    reply(msg.id, { error: { code: -32601, message: `método no soportado: ${msg.method}` } });
  } catch (error) { reply(msg.id, { error: { code: -32603, message: error.message } }); }
}).on('close', () => process.exit(0));

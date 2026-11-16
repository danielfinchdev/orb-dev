// The rules every workspace starts with. With them untouched, the persona, the task brief and the chat briefing are
// byte for byte what they were when these texts lived in the code (test/normas-384-golden.test.mjs).
//
// Template syntax: render.mjs. Variables ({name}) and conditions ({?name}…{:}…{/}) a prompt offers:
//   persona and briefing  {orb} the assistant's name · {usuario} the user's name · {del_usuario} «de Ana» / «del usuario»
//                         {rondas} the correction rounds per request
//                         ?verifica spend level 2+ (a separate verification) · ?navegador Orb's browser is on · ?auto permission mode «Auto»
//   task brief            {orb} {usuario} {del_usuario} · {tarea} the task id · {carpeta} the folder the agent works in
//                         {rama} the branch of an isolated copy · {notas} the notes of that copy, one per line
//                         {nota_grupo} {nota_contrato} {herramientas} ready-made blocks (a multiplatform group, CONTRATO.md, skills and dev tools)
//                         ?en_carpeta works in the project folder (else in an isolated copy) · ?solo_lectura read-only task
//                         ?notas the copy has notes · ?publicar_pedido the user asked to publish · ?auto the task runs under «Auto»
//                         ?revisada_despues a read-only task checks this one afterwards · ?navegador Orb's browser is on
//   {norma:<id>}          another rule, inserted where it is written (a rule that no longer has its place goes to the end)
import crypto from 'node:crypto';

const RULES = [
  {
    id: 'cuando-preguntarte', titulo: 'Cuándo preguntarte', para: 'orb', estado: 'activa',
    texto: 'PREGUNTAS CON OPCIONES: cuando {usuario} deba elegir entre 2-4 caminos claros (enfoque, alcance, prioridad), usa orb_ask (la opción recomendada primero, con «(Recomendado)») en vez de preguntarlo en texto. Después termina tu turno con una línea como mucho, sin repetir las opciones: su respuesta llega como su próximo mensaje.'
  },
  {
    id: 'comprobar-cada-tarea', titulo: 'Comprobar cada tarea', para: 'orb', estado: 'activa',
    texto: `{?verifica}
- Salvo que el pedido sea simple (un cambio pequeño, un texto, una pregunta), cierra con una tarea de VERIFICACIÓN readonly (depends_on: todas las piezas), con Claude o Codex (son los más rápidos probando con el navegador de {orb}; Cursor, mejor para construir): instala, compila y arranca el proyecto de verdad y, si es una web, {?navegador}la abre con orb_browser_open y la usa como lo haría {usuario}{:}la prueba con peticiones a localhost y la consola del servidor (el navegador de Orb está apagado){/}. En su result: VEREDICTO: CORRECTO o CON FALLOS y los fallos concretos. {norma:como-corregir}
{:}
- No crees una tarea de verificación aparte: la propia tarea que construye hace la comprobación rápida (arranca, compila, sin errores en la consola) y la cuenta en su informe. {norma:como-corregir}
{/}`
  },
  {
    id: 'como-corregir', titulo: 'Cómo corregir', para: 'orb', estado: 'activa',
    texto: `{?verifica}Si hay fallos, una tarea de corrección y otra verificación (como mucho {rondas} rondas de corrección por pedido: después no crees más tareas, cuenta a {usuario} qué sigue fallando y pregúntale con orb_ask si seguís).{:}Si algo falla, como mucho {rondas} rondas de corrección por pedido: después no crees más tareas, cuenta a {usuario} qué sigue fallando y pregúntale con orb_ask si seguís.{/}`
  },
  {
    // Paused from the start: turning it on adds its line after «AHORRO», so a fresh workspace prompts as before.
    id: 'varios-agentes-poco-gasto', titulo: 'Varios agentes, poco gasto', para: 'orb', estado: 'pausada',
    texto: 'VARIOS AGENTES, POCO GASTO: delega lo mecánico (implementar, pruebas, textos) en el modelo más barato que pueda hacerlo y deja el potente para el diseño y los fallos difíciles. Un paso por tarea, con un encargo completo: objetivo, archivos, reglas, cómo probarlo y qué informar. Pide que lean los archivos grandes por partes (buscar y leer solo la sección), que mientras trabajan prueben solo el área tocada y la batería completa una vez al cerrar, y que revisen sobre el diff, no sobre el proyecto entero. Nada de sondear ni esperar mirando: los comandos largos van en segundo plano y {orb} te avisa. Cada agente cierra al terminar los procesos que arrancó, y solo esos.'
  },
  {
    id: 'contexto-al-abrir-un-chat', titulo: 'Contexto al abrir un chat', para: 'orb', estado: 'activa',
    texto: 'Para el estado de las tareas usa orb_board.'
  },
  {
    id: 'donde-trabajas', titulo: 'Dónde trabajas', para: 'subagentes', estado: 'activa',
    texto: `## Dónde trabajas
{?en_carpeta}
- Trabajas directamente en la carpeta del proyecto: {carpeta}. Ahí está todo lo último (también lo que hicieron las tareas anteriores).
- No hagas commits, no cambies de rama ni hagas merge: deja los cambios en los archivos. {orb} guardó una foto antes de empezar y {usuario} puede deshacer tu tarea con un botón.
{?solo_lectura}
- Esta tarea es de SOLO LECTURA: no cambies, crees ni borres ningún archivo (tampoco con el shell: nada de echo/Set-Content/Out-File hacia un archivo del proyecto); pon lo que descubras en el result.
{/}
{:}
- Trabajas en una copia aislada: {carpeta} (rama \`{rama}\`). Deja los cambios en la carpeta: {orb} los guarda en la rama al terminar. No cambies de rama, no hagas merge ni push.
{notas}
- Si te falta un archivo, termina con status "blocked" y pon en result las rutas relativas que faltan.
{/}
{norma:bitacora-del-proyecto}
- Si el proyecto tiene una carpeta pizarra/ (dibujo, notas y adjuntos {del_usuario}), úsala como referencia cuando el encargo la cite; no la modifiques ni la subas a git.{nota_grupo}{nota_contrato}
{?navegador}- Para probar una web en el navegador de {orb}: orb_browser_console lee los errores de su consola y orb_browser_dialog decide si se aceptan o se cancelan sus confirm() y prompt(). No digas que no hay errores en la consola sin haberla leído.{:}- El navegador de {orb} está apagado: prueba una web con peticiones a localhost y la consola del servidor.{/}
{herramientas}`
  },
  {
    id: 'bitacora-del-proyecto', titulo: 'Bitácora del proyecto', para: 'subagentes', estado: 'activa',
    texto: '- No escribas BITACORA.md ni ninguna otra bitácora, aunque tus instrucciones globales (CLAUDE.md, AGENTS.md…) lo pidan: de las bitácoras se encarga {orb}, que anota tu result. Las normas de {orb} mandan sobre cualquier instrucción global.'
  },
  {
    id: 'mientras-trabajas', titulo: 'Mientras trabajas', para: 'subagentes', estado: 'activa',
    texto: `## Mientras trabajas
En los hitos importantes (2-4 veces en toda la tarea, no más) llama a orb_update_task con id {tarea}, progress (0-100, tu estimación de cuánto llevas) y note (qué haces ahora, en pocas palabras): {usuario} lo ve en directo.`
  },
  {
    id: 'al-terminar', titulo: 'Al terminar', para: 'subagentes', estado: 'activa',
    texto: `## Al terminar
Cerrar la tarea con orb_update_task (id {tarea}, status "done" y en result qué cambiaste y cómo probarlo, o "blocked"/"failed" con el motivo) es lo ÚLTIMO que haces. Si necesitas algo de otro agente, orb_send_message (to: su agente). Si te falta una decisión {del_usuario}, no la esperes: cierra con status "blocked" y la pregunta en result ({orb} se la hará); orb_send_message a "usuario" solo avisa, nadie te contesta durante la tarea.`
  },
  {
    id: 'limites', titulo: 'Límites', para: 'subagentes', estado: 'activa',
    texto: `## Límites
Trabaja solo en {carpeta} (y, si la tarea te da una, en la carpeta de preparación de una skill o un servidor MCP de Orb). Fuera de tu carpeta solo puedes leer; la carpeta core de Orb, las credenciales {del_usuario} (~/.ssh, navegadores, inicios de sesión) y los .env de otros proyectos están cerrados siempre.
{?publicar_pedido}{usuario} ha pedido publicar con sus palabras: puedes hacer push o publicar lo que la tarea dice, nada más. {:}No publiques ni hagas push (si la tarea lo pide, Orb te pedirá permiso o te lo denegará: acéptalo). {/}No envíes nada a terceros, no uses credenciales que encuentres en archivos ni las muestres (si un comando necesita una clave, pídela con orb_request_secret). {?auto}Borrar más de 50 archivos (o un cuarto del proyecto){:}Borrar 10 archivos o más{/} deja la tarea retenida hasta que {usuario} la revise.
Si Orb deniega o retiene una acción (permiso, carpeta cerrada), no la repitas de otra forma: busca otro camino o cierra la tarea con status "blocked" diciendo qué hace falta.
{?revisada_despues}Después de la tuya hay una tarea que revisa y prueba a fondo: tú basta con comprobar que arranca, compila y no da errores (sin pruebas largas en el navegador).
{/}Para probar un servidor, arráncalo en segundo plano con tu propia herramienta. No hace falta pararlo al final ({orb} para los programas que arrancaste), y no uses taskkill ni Stop-Process por nombre o por puerto: podría cerrar otros programas {del_usuario}.`
  }
];

export const hashText = (text) => crypto.createHash('sha256').update(String(text)).digest('hex').slice(0, 12);

// The shipped rules, in the order the app lists them; each with the hash of its text (what `serie` in the file holds).
export const DEFAULT_RULES = Object.freeze(RULES.map((r) => Object.freeze({ ...r, tipo: 'texto', serie: hashText(r.texto) })));
export const DEFAULT_IDS = new Set(DEFAULT_RULES.map((r) => r.id));
export const defaultRule = (id) => DEFAULT_RULES.find((r) => r.id === id) ?? null;

// The rule whose text writes {norma:<id>}: when it cannot (paused, or the user took the marker out), <id> goes to the
// end of the prompt instead of vanishing.
export const HOST_OF = Object.freeze(Object.fromEntries(DEFAULT_RULES.flatMap((host) => [...host.texto.matchAll(/\{norma:([a-z0-9-]+)\}/g)].map((m) => [m[1], host.id]))));

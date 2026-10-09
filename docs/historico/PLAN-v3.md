# Orb.dev 3 — plan para ser puntero (lo mejor de T3 Code Nightly)

2026-10-05, rama `arreglos-2.1.1`. Parte de una prueba completa de la 2.1.0 en Windows
(app empaquetada y desde el código, en modo día y noche, y con Claude, Codex y Cursor de verdad) y del estudio de
T3 Code Nightly `0.0.46-nightly.20261004` («Orchestrator V2», 3 y 4 de octubre de 2026).


## Estado en la 2.3.0 (5 de octubre de 2026)

| Fase | Estado |
|---|---|
| A — Motor en vivo | Hecho: Claude (Agent SDK), Codex (app-server), Cursor (CLI en streaming) y ACP (Gemini, OpenCode, Qwen, Copilot). Probado con Claude, Codex, Cursor y Gemini reales |
| B — Cola, límites y continuidad | Hecho: cola y corrección en marcha, tareas «esperando cupo», continuar tras cerrar y medidor de contexto |
| C — Delegación | Hecho: `orb_delegate` / `orb_wait_tasks`, delegación de confianza y árbol de subtareas |
| D — Comodidad | Hecho: bifurcar, programadas, bandeja, «@», detalles e historial paginado |
| E — Más agentes | Hecho con ACP (cuatro agentes nuevos) |
| Extra | Task Review, permisos equilibrados (guardia), cupo real y español de España e inglés |
| Pendientes de §1 | Pruebas en Windows (79/79), errores explicados (también en conversaciones directas), modelo por defecto sin Opus, icono `.ico` de 10 tamaños |

El detalle de cada funcionalidad está en `docs/FUNCIONAMIENTO.md`.

## 1. Qué salió en la prueba

**Funciona de verdad** con los agentes reales:
- Conversación directa con Claude (8 s), Codex (18 s) y Cursor (17 s).
- El asistente reparte una tarea a Claude con Haiku, la tarea se hace (23 s) y llega el informe con OK.
- Deshacer devuelve la carpeta a como estaba.
- Ningún error en la página en todo el recorrido.

### Arreglado en `arreglos-2.1.1`

| Fallo | Arreglo |
|---|---|
| Checks marcados invisibles en modo noche (fondo casi transparente y marca azul oscura) | `dark:data-[state=checked]:bg-primary` en `Checkbox` |
| Iconos inventados para Claude, Codex y Cursor | Logotipos reales (Simple Icons, CC0); también Git, Node.js, GitHub y Tailscale en la lista de instalación |
| Primer arranque: el robot sale cortado arriba y «Continuar» queda fuera de la ventana | Contenedor `flex` + `m-auto` con hueco arriba para el robot |
| Barra de scroll horizontal en Agentes y esquina blanca del scroll en modo noche | `overflow-x-hidden`, `min-w-0` en la rejilla y `::-webkit-scrollbar-corner` transparente |
| Ajustes: iconos de sección diminutos y desalineados | `shrink-0` y alineados arriba |
| Paneles del modo experto activables con el modo apagado | Desactivados (y atenuados) si el modo está apagado |
| Todas las herramientas con icono de terminal, también al escribir archivos | Icono según la herramienta |
| «4 tokens de entrada» con 0,12 $ de coste (no contaba la caché) | Cuenta la caché de Claude y la muestra aparte |
| Dos botones «Nueva conversación» con significados distintos | El del chat se llama «Empezar de cero» |
| `npm install` no descarga Electron con npm 11, y `npm start` falla | `allowScripts` en `package.json` |
| `npm run check` falla con Node 24 | Quitada la opción `--experimental-default-type`, que ya no existe |
| `test:app` no pasa en Windows (no espera «Preparo tu equipo») | La prueba pasa ese paso |

### Pendiente

1. **Las pruebas del motor no corren en Windows.** De 50 pruebas, 14 fallan porque los agentes falsos son `.mjs` y la app exige un `.exe` (`spawn EFTYPE`). La CI las pasa porque corre en Linux. Así que el motor nunca se ha probado en el único sistema para el que existe. Propuesta: un lanzador de pruebas (`node agente-falso.mjs`), solo cuando lo pide la prueba.
2. **Errores de los agentes en inglés y crudos.** Ejemplo: Codex con su base de datos dañada (`database disk image is malformed`). La app ya avisa de que el siguiente mensaje empezará una conversación nueva, pero debería explicarlo en español y ofrecer «Continuar en una conversación nueva con un resumen».
   - Ojo, Dani: en tu PC, `~/.codex/state_5.sqlite` está dañado. Codex no puede retomar conversaciones ni fuera de Orb.
3. **Conversación directa sin modelo elegido = Opus** (el predeterminado de Claude Code, el caro). La ventana propone `sonnet`, pero si se crea por API se usa Opus. Además, los modelos salen con su nombre crudo (`sonnet`, `opus`) y no se pueden cambiar una vez creada la conversación.
4. **Icono del `.exe`.** Por dentro está bien: el robot de 16 a 256 px. Falta que Dani diga qué ve mal (en el Explorador, en la barra de tareas, al ejecutarlo…).
   - Posible mejora: una versión simplificada para 16 y 24 px y un margen al estilo de Windows 11.
5. **La primera ejecución del portable descargado** se queda parada en el aviso de SmartScreen hasta que alguien pulsa. Se arregla firmando la app.

## 2. Qué trae T3 Code Nightly

T3 rehízo el motor que hace trabajar a los agentes. Lo importante:

- **Conexión en vivo con cada agente:** Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`), `codex app-server`, Cursor SDK (`@cursor/sdk`), OpenCode y ACP. Nada de «un proceso por mensaje».
- **`delegate_task`:** un agente lanza agentes hijos en otro proveedor o modelo (p. ej. Claude planifica y Codex implementa). Puede esperarlos o seguir trabajando, y despierta cuando acaban, con los resultados juntos. Es la forma que recomiendan para combinar agentes.
- **MCP de T3 para los agentes:** crear, lanzar, escribir, esperar, leer, buscar e interrumpir conversaciones; bifurcar y fusionar; editar la cola; programar tareas. Los agentes **no** pueden aprobar sus propios permisos.
- **Cola en el servidor:** sobrevive a reinicios. Se puede reordenar, editar y borrar, y elegir si cada mensaje **corrige al agente en marcha** o **espera su turno** (`Ctrl+Enter` hace lo contrario).
- **Límites:** la conversación queda en estado «Limitada», con «reanudar al reinicio del cupo» o «posponer». Tiene medidor de contexto en directo.
- **Continuar tras reiniciar** (actualización, cuelgue o apagado), y aviso al agente de qué trabajo en segundo plano murió.
- **Bifurcar cualquier conversación** (también fallidas o limitadas), con la bifurcación nativa del proveedor, y fusionar después el resultado.
- **Subagentes visibles:** los subagentes nativos de Claude o Codex salen como conversaciones hijas, con modelo, estado y resultado. «Parar» detiene también el trabajo en segundo plano.
- **Tareas programadas:** crear, pausar, ejecutar y borrar automatizaciones.
- **Panel de detalles de la conversación** (carpeta, git, scripts, PR enlazado y linaje), **barra lateral tipo bandeja** («settle» y sección «Trabajando») y `@conversación` para adjuntar otra conversación como contexto.
- **Rendimiento:** historial paginado, actualizaciones agrupadas y menos memoria.

T3 avisa de que **cambiar de proveedor a mitad de conversación pierde información**: no pasa el razonamiento ni las herramientas. Por eso no merece la pena copiarlo tal cual.

## 3. Qué tomar para Orb, por orden

Orb no debe copiar T3 entero. Debe coger lo que hace mejor su promesa: «le pido algo, lo reparte, lo revisa y me pide un OK».

### Fase A — Motor en vivo (la base de todo lo demás)

Sustituir «un proceso por mensaje» (`claude -p`, `codex exec`, `cursor-agent -p`) por una conexión que dura toda la conversación:

| Agente | Hoy | Fase A |
|---|---|---|
| Claude | `claude -p --resume` por turno | `@anthropic-ai/claude-agent-sdk` (`query()` con entrada en streaming); `canUseTool` para las aprobaciones |
| Codex | `codex exec --json` por turno | `codex app-server` (JSON-RPC por stdio: `thread/start`, `turn/start`, `turn/interrupt`, aprobaciones) |
| Cursor | `cursor-agent -p` por turno | `@cursor/sdk` (lo que usa T3) |

Qué gana Orb:
- **Interrumpir** de verdad y **corregir al agente en marcha** sin perder lo hecho.
- **Aprobaciones en línea:** el agente pregunta «¿ejecuto `npm install`?» y sale una tarjeta con Permitir o Denegar, también en el móvil. Hoy solo hay permisos fijos (`leer`, `editar`, `total`).
- Turnos más rápidos (sin arrancar el programa cada vez) y menos coste de caché.
- Subagentes nativos visibles, medidor de contexto y uso exacto.

Dónde se toca:
- `src/agents/*.mjs`: cada adaptador pasa a ser una sesión viva con `send`, `interrupt`, `approve` y eventos.
- `src/engine/sessions.mjs`: un proceso por conversación y no por turno.
- `src/engine/orchestrator.mjs`: el cerebro del asistente también usa el SDK.
- Se mantiene el formato de eventos que pinta la interfaz (`items`), para no rehacerla.

Riesgo: hay que añadir dependencias (los SDK) al motor, que hoy no lleva ninguna.
- Van empaquetadas en `app.asar`.
- Hay que comprobar sus licencias y que respetan las versiones mínimas: Claude Code 2.1.280 o superior y Codex 0.159 o superior.

### Fase B — Cola, límites y continuidad

1. **Cola persistente** por conversación y por tarea, en la base de datos. Se puede reordenar y borrar, con «corregir» o «poner en cola» en cada mensaje (`Ctrl+Enter` cambia el modo).
2. **Estado «Limitada»**: al llegar al límite de uso, la tarea no falla. Se queda esperando y se reanuda sola al reiniciarse el cupo. Orb ya lee la hora de reinicio (`core/budget.mjs`); falta reanudar.
3. **Continuar tras reiniciar** (opción en Ajustes): las tareas en marcha al cerrar la app se retoman al abrirla. Hoy quedan como fallidas.
4. **Medidor de contexto** en la cabecera de cada conversación.

### Fase C — Que los agentes deleguen (la versión Orb de `delegate_task`)

Orb ya tiene lo difícil: el tablero, las aprobaciones firmadas y el cupo. Falta:

1. **`orb_delegate`** en `src/mcp/server.mjs`: un agente que trabaja en una tarea puede crear subtareas para otro agente o modelo. Por ejemplo, Claude planifica y pide a Codex los tests.
   - Las subtareas siguen la regla actual: lo que crea un agente espera la aprobación de Dani, salvo lo que Dani marque como de confianza.
   - El agente padre espera o sigue trabajando, y despierta con los resultados juntos.
2. **Linaje visible**: árbol de tarea y subtareas en Tareas y en el menú de carpetas, con agente, modelo, estado, duración y resultado.
3. **El informe final** del asistente resume todo el árbol, con un solo OK.

Esto refuerza lo que diferencia a Orb: T3 deja que los agentes se gestionen solos, y Orb lo hace **con un jefe de proyecto y tu aprobación**.

### Fase D — Comodidad

1. **Bifurcar una conversación o tarea** desde cualquier punto («probar otra idea»), con la bifurcación nativa de Claude y Codex, y deshacer integrado.
2. **Tareas programadas** («cada lunes revisa las dependencias», «cada noche pasa los tests») sobre el planificador actual, con aprobación la primera vez.
3. **Barra lateral tipo bandeja**: arriba lo que está trabajando o te espera; lo terminado se «archiva» con un clic.
4. **`@` para adjuntar** otra conversación, tarea o bitácora como contexto.
5. **Panel de detalles** de cada tarea: carpeta o rama, cambios de git, PR enlazado, scripts y linaje (aprovechando el modo experto).
6. **Historial paginado** y actualizaciones agrupadas para conversaciones largas.

### Fase E — Más agentes

- Grok Build, OpenCode, Gemini y Antigravity mediante **ACP** (un único adaptador sirve para todos los agentes del registro).
- Con el adaptador genérico de la Fase A, cada agente nuevo cuesta poco.

### Qué no copiar

- **Cambiar de proveedor a mitad de conversación:** pierde contexto (lo dice el propio T3). En Orb eso se hace delegando.
- **Apps nativas de iOS y Android:** la web app por Tailscale ya cubre el «échale un ojo y da el OK».
- **Servidores remotos y SSH:** fuera del público de Orb, por ahora.

## 4. Lo que Orb ya tiene y T3 no (no perderlo)

- El asistente jefe de proyecto, con informe y OK.
- Aprobaciones firmadas.
- Deshacer por tarea.
- Cupo por agente.
- Revisión cruzada.
- Bitácoras.
- Navegador propio con ventanita en directo.
- Instalación automática.
- Todo en español y sin jerga.

## 5. ¿Electron u otra cosa?

Lo más citado como «mejor que Electron» es **Tauri**: Rust con el WebView2 de Windows, un instalador de unos 10 MB frente a 100 MB o más, y menos memoria. Otras opciones son Electrobun (Bun) y Wails (Go).

Para Orb, **hoy no compensa cambiar**:
- El navegador de los agentes y su ventanita dependen del Chromium que lleva Electron (capturas, páginas ocultas, `disableDialogs`).
- El servidor MCP arranca con el propio ejecutable (`RunAsNode`).
- El motor usa `node:sqlite`.
- Con Tauri habría que reescribir el proceso principal en Rust y llevar Node aparte, o sea, casi otra app.
- T3 Code, el rival, también usa Electron.

Mejor invertir ese esfuerzo en la Fase A. Si algún día el tamaño importa, se puede revisar.

## 6. Orden propuesto

1. Fusionar `arreglos-2.1.1` y publicar la 2.1.1.
2. Arreglar las pruebas del motor en Windows (pendiente 1).
3. Fase A con Claude primero (es el cerebro y el más usado), luego Codex y luego Cursor.
4. Fase B.
5. Fase C.
6. Fases D y E según se use.

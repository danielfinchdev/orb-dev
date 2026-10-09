# Cómo funciona Orb.dev 2.3, funcionalidad por funcionalidad

Este documento explica cada funcionalidad por separado: qué hace, cómo se usa, qué archivos la implementan y cómo funciona
por dentro. Sirve para reprogramar **una funcionalidad concreta** sin tocar el resto. Cada sección dice qué archivos
cambiar y con qué otras se conecta.

> **La idea de Orb no cambia:** un chat con un asistente que, cuando le hablas de un proyecto, escribe encargos optimizados
> en tokens y los reparte entre varios agentes de IA de distintos proveedores, que trabajan a la vez y coordinados. Luego
> revisa lo que hicieron y te pide el OK.

## Índice

1. [Mapa de la aplicación](#1-mapa-de-la-aplicación)
2. [Primer arranque y carpeta del asistente](#2-primer-arranque-y-carpeta-del-asistente)
3. [El chat con el asistente (orquestador y modo libre)](#3-el-chat-con-el-asistente)
4. [Encargos optimizados en tokens](#4-encargos-optimizados-en-tokens)
5. [El tablero de tareas](#5-el-tablero-de-tareas)
6. [El planificador: quién hace cada tarea y cuándo](#6-el-planificador)
7. [Agentes en vivo (adaptadores)](#7-agentes-en-vivo)
8. [Guardia de permisos y tarjetas de aprobación](#8-guardia-de-permisos-y-aprobaciones)
9. [Conversaciones directas](#9-conversaciones-directas)
10. [Cola y corrección en marcha](#10-cola-y-corrección-en-marcha)
11. [Bifurcar, continuar y detalles](#11-bifurcar-continuar-y-detalles)
12. [Contexto y cupo real (anti quema de tokens)](#12-contexto-y-cupo-real)
13. [Tareas limitadas y continuidad](#13-tareas-limitadas-y-continuidad)
14. [Delegación entre agentes](#14-delegación-entre-agentes)
15. [Task Review](#15-task-review)
16. [Tareas programadas](#16-tareas-programadas)
17. [«@» para adjuntar contexto](#17--para-adjuntar-contexto)
18. [Informe, OK y deshacer](#18-informe-ok-y-deshacer)
19. [Bitácoras](#19-bitácoras)
20. [GitHub](#20-github)
21. [Navegador de los agentes y ventanita](#21-navegador-de-los-agentes)
22. [Móvil](#22-móvil)
23. [Modo experto](#23-modo-experto)
24. [Instalador y detección de sesiones](#24-instalador-y-detección-de-sesiones)
25. [Conectores MCP](#25-conectores-mcp)
26. [Idiomas](#26-idiomas)
27. [Interfaz: barra lateral, bandeja, tema, tamaño y robot](#27-interfaz)
28. [Seguridad](#28-seguridad)
29. [Empaquetado, versiones y CI](#29-empaquetado-versiones-y-ci)
30. [Pruebas](#30-pruebas)
31. [Cómo reprogramar una funcionalidad sin romper el resto](#31-cómo-reprogramar-una-funcionalidad)

---

## 1. Mapa de la aplicación

```
Ventana (React)  ──mensajes──►  Proceso principal (Electron)  ──mensajes──►  Motor (proceso aparte)
src/ui/**                       src/main/main.mjs + preload.cjs              src/engine/engine.mjs
                                                                              ├─ api.mjs          acciones de la ventana
                                                                              ├─ sessions.mjs     conversaciones en vivo
                                                                              ├─ scheduler.mjs    tareas
                                                                              ├─ orchestrator.mjs el asistente
                                                                              └─ remote.mjs       web del móvil
Agentes (procesos)  ◄── adaptadores src/agents/*.mjs (en vivo) ──┘
   └─ cada agente carga el servidor MCP de Orb: src/mcp/server.mjs (el tablero común)
Datos: <carpeta del asistente>/.orb/datos/orb.db (SQLite, src/core/db.mjs)
```

- **No hay servidor web en el PC.** La ventana habla con el motor por mensajes internos de Electron. El único servidor es
  el del móvil, que va apagado por defecto y solo escucha en la dirección de Tailscale.
- **El motor** es un proceso aparte (`utilityProcess`). Si se cae, el proceso principal lo reinicia, hasta tres veces.
- **Los agentes** son los programas oficiales que el usuario ya tiene (Claude Code, Codex, Cursor, Gemini CLI…), con su
  propia sesión. Orb nunca ve credenciales.
- **Capas** (de abajo arriba):
  1. `src/core` es la lógica pura: tablero, aprobaciones, cupo, guardia, carpetas y programadas.
  2. `src/agents` son los adaptadores.
  3. `src/engine` junta las piezas.
  4. `src/ui` es la interfaz.

## 2. Primer arranque y carpeta del asistente

**Qué hace.** Pide el nombre del asistente (Orb por defecto), cómo llamarte y dónde crear su carpeta. La carpeta es
siempre `<carpeta elegida>\Orb` (o la elegida, si ya se llama Orb), se llame como se llame el asistente, y tiene la misma
estructura para todos:

```
D:\Orb\                   (siempre <carpeta elegida>\Orb, igual para todos)
  orb.json                ajustes
  windows\ ios\ android\ web\
                          categorías: cada carpeta dentro de una de ellas es un proyecto
                          (las que crea la app y las que crees tú en el Explorador)
  android\adb-tools\      adb y fastboot de Google, los descarga la app (no es un proyecto)
  bitacora\               configuración de Orb: GENERAL.md (memoria general) y proyectos\ (una por proyecto)
  mcp-servers\            configuración de Orb: los servidores MCP; no sale como proyecto, se gestiona en Ajustes
  .orb\                   datos de la app (oculta): base de datos, clave cifrada, registros, copias para deshacer
```

- **Categorías** (`windows`, `ios`, `android`, `web`): los proyectos son sus subcarpetas. Al crear o clonar un proyecto se
  elige la categoría (web por defecto); el asistente la indica en `orb_create_project`.
- **Configuración de Orb** (`bitacora`, `mcp-servers`, `.orb`): nunca son proyectos ni se pueden vincular como tales.
- **adb**: al arrancar, si falta `android\adb-tools\adb.exe`, el motor descarga platform-tools de Google ahí
  (`src/engine/android.mjs`) y pone esa carpeta la primera en el PATH de los agentes. Ajustes → Android muestra el estado.
- **Carpetas de la 2.3.0**: `ensureLayout` crea lo que falte y pasa `bitacoras\` a `bitacora\` (si un archivo existe en
  las dos, las entradas viejas se añaden al final). Solo descarta las bitácoras vacías que la 2.3.0 creó para las
  categorías y carpetas de configuración que tomó por proyectos; esos «proyectos» se quitan solos (`syncProjects`).

En Windows, después ofrece instalar lo que falte (sección 24).

**Archivos.**
- Interfaz: `src/ui/views/setup.jsx`.
- Crear y ordenar la carpeta: `src/core/home.mjs` (`createHome`, `homeFor`, `ensureLayout`, `categoryOf`, `DEFAULT_CONFIG`, `loadConfig`).
- Proyectos por categoría: `src/core/projects.mjs` (`createProject`, `syncProjects`).
- Recordar dónde está: `src/main/main.mjs` (`ubicacion.json` en los datos de la app).

**Por dentro.**
- `loadConfig` mezcla `orb.json` con los valores por defecto. A una carpeta antigua le añade sola lo nuevo:
  - cuentas de los agentes nuevos;
  - en la versión 3, los topes de cupo nuevos (sección 12).
- `ORB_USER_DATA` permite separar los datos de la app (portable o pruebas).

## 3. El chat con el asistente

**Qué hace.** Es la pantalla principal. Le cuentas qué quieres y el asistente lo convierte en tareas, las reparte, vigila y
te informa. Tiene dos modos (casilla «Orquestador»):

- **Orquestador** (por defecto):
  - solo coordina;
  - puede **leer** el proyecto (Read, Grep, Glob) para escribir mejores encargos;
  - no edita ni ejecuta nada.
- **Modo libre:**
  - trabaja directamente en el proyecto de trabajo (edita y ejecuta comandos);
  - sigue pudiendo crear tareas;
  - lo arriesgado te lo pregunta con una tarjeta (sección 8).

**Archivos.**
- Interfaz: `src/ui/views/chat.jsx` (incluye el `Composer`, el cuadro de mensaje de toda la app).
- Motor: `src/engine/orchestrator.mjs`.
  - `persona()`: sus instrucciones de coordinador.
  - `freePersona()`: las del modo libre.
  - `Orchestrator`: la sesión viva.

**Por dentro (2.3).**
- El asistente es **una sesión viva de Claude** (Claude Agent SDK con el Claude Code del usuario) que se queda abierta entre
  mensajes. La respuesta llega en streaming (`chat:state.partial`).
- Si escribes mientras responde, tu mensaje le llega en su siguiente paso (`steer`); no hace falta esperar.
- **Se renueva por contexto, no por turnos:** cuando el contexto pasa de `orchestrator.renewAt` (60 %), o tras `maxTurns`
  (60), empieza una conversación nueva. La memoria no se pierde, porque está en el tablero y en las bitácoras: el primer
  mensaje de cada conversación lleva un resumen (`briefing()` en `logs.mjs`).
- Usa su propia identidad en el MCP (`orb`), protegida con una clave que solo tiene su proceso (sección 28).
- Mensajes internos: el motor le avisa con «AVISO DEL SISTEMA» de cosas como «han terminado las tareas, revisa e informa»
  o «la tarea se bloqueó». Eso cierra el ciclo sin que tengas que escribir nada.

## 4. Encargos optimizados en tokens

**Qué hace.** Cada encargo que escribe el asistente es compacto:
- rutas exactas, qué cambiar, criterio de terminado y qué no tocar;
- no copia código ni contexto que el agente puede leer él solo;
- no repite contexto entre tareas: usa `depends_on` y la tarea siguiente recibe el resultado de la anterior.

**Archivos.**
- Reglas del asistente: `src/engine/orchestrator.mjs`, en `persona()` («ENCARGOS COMPACTOS»).
- Lo que recibe cada agente: `src/engine/scheduler.mjs`, en `promptFor()`. Incluye:
  - el encargo;
  - lo hecho antes (como mucho `MAX_DEP_RESULT` caracteres por dependencia);
  - las últimas notas de la bitácora (unos 3000 caracteres);
  - dónde trabaja y cómo informar.
- Límite de tamaño: `MAX_DESCRIPTION` en `src/core/board.mjs`.

## 5. El tablero de tareas

**Qué hace.** Guarda las tareas con:
- estado: en cola, espera aprobación, trabajando, hecha, fallida, bloqueada, cancelada o **esperando cupo** (`limited`);
- dependencias, agente, modelo, razonamiento;
- dónde trabaja: en la carpeta del proyecto o en una copia aislada con su rama;
- de qué tarea es subtarea (`parent_id`), qué tarea revisa (`review_of`) y de qué programada sale (`schedule_id`).

**Archivos.**
- Lógica: `src/core/board.mjs`.
- Base de datos: `src/core/db.mjs` (tablas `tasks`, `events`, `messages`, `chat`, `sessions`, `session_items`,
  `session_queue`, `schedules` y `settings`).
- Pantalla: `src/ui/views/tasks.jsx` (lista, detalle, acciones y Task Review).

**Aprobaciones firmadas.**
- Una tarea espera tu aprobación cuando:
  - tiene palabras de riesgo (publicar, borrar, credenciales, pagos);
  - usa razonamiento alto;
  - o la creó un agente sin delegación de confianza.
- Al aprobar se firma un hash de lo que viste (`src/core/approval.mjs`, HMAC con la clave cifrada). Si la tarea cambia,
  la firma deja de valer y vuelve a pedir aprobación (`revalidateQueued`).

**Cómo reprogramarlo.**
- Un estado nuevo: `STATUSES` en `board.mjs`, más `STATUS` en `src/ui/lib/labels.js` y el filtro de `tasks.jsx`.
- Una columna nueva: `ADDED` en `db.mjs` (migración automática).

## 6. El planificador

**Qué hace.** Cada 1,5 s, y en cuanto cambia el tablero:
1. Lanza las tareas listas (aprobadas y con sus dependencias hechas).
2. Elige agente y cuenta.
3. Prepara dónde trabajan.
4. Al terminar cada una: guarda el resultado, hace las comprobaciones de seguridad, apunta en la bitácora y avisa.

**Archivos.** `src/engine/scheduler.mjs`:
- `tick`: la vuelta de cada momento.
- `launch`: lanzar una tarea.
- `finishNow`: cerrar una tarea.
- `promptFor`: el encargo que recibe el agente.
- `explainFailed`: explicar un fallo.
- `queueReport`: el informe final.

**Reparto.**
- Candidatos: solo los agentes **activados e instalados** (`installed()` en `src/agents/index.mjs`) y sus cuentas con cupo.
- Orden: por uso real de cada cuenta (sección 12) y, si no hay dato real, por tareas lanzadas.
- `maxParallel` tareas a la vez y `perAgent` por cuenta.
- En la carpeta del proyecto, solo una tarea que escribe a la vez. Las de solo lectura y las copias aisladas van en
  paralelo; una subtarea no espera a su tarea madre.

**Modos de trabajo.**
- `carpeta`: trabaja en la carpeta del proyecto. Antes se toma una «foto» (`takeCheckpoint`) para poder deshacer.
- `aislada`: rama y copia propias (`prepareWorkdir`, worktree de git). Al terminar se hace un commit automático, que se
  bloquea si hay archivos que parecen secretos.

**Fallos explicados.** `src/core/agent-errors.mjs` traduce el fallo:
- plan sin acceso, sesión sin iniciar (incluido «API key is missing»), modelo no disponible, sin red o programa que falta.
- Si la tarea era para «cualquier agente», pasa a otro.

## 7. Agentes en vivo

**Qué hace.** Cada conversación o tarea mantiene **un proceso vivo** de su agente entre turnos, como T3 Code. La respuesta
llega en streaming, puedes corregir en marcha, interrumpir y aprobar acciones, y la conversación del agente se retoma
aunque se cierre la app.

**La interfaz común** está en `src/agents/live.mjs`. Todos los agentes la cumplen:

```
live.send({ text, images }) → { final, text, isError, usage, limit }
live.steer({ text })   live.interrupt()   live.respond(id, 'allow'|'always'|'deny')
live.setModel(m)   live.setPermission(p)   live.close()   live.sessionId   live.caps
eventos: item · delta · session · approval · approval_done · context · rate · limit · exit
```

| Agente | Archivo | Cómo se conecta | Sesión que usa |
|---|---|---|---|
| Claude Code | `src/agents/claude.mjs` | Claude Agent SDK oficial con el `claude.exe` del usuario (`pathToClaudeCodeExecutable`), entrada en streaming, `canUseTool` para el guardia, `rate_limit_event` para el cupo real y `getContextUsage` para el contexto | `~/.claude` (o la carpeta de la cuenta) |
| Codex | `src/agents/codex.mjs` | `codex app-server`: JSON-RPC por stdio con `thread/start`, `resume` y `fork`, `turn/start`, `steer` e `interrupt`, más las peticiones de aprobación y `account/rateLimits` | `~/.codex` (ChatGPT o API key) |
| Cursor | `src/agents/cursor.mjs` | La CLI oficial con `--stream-partial-output`, un proceso por turno y `--resume` del chat. Su SDK pide otro login aparte, así que no se usa | `~/.cursor` |
| Gemini CLI, OpenCode, Qwen Code, GitHub Copilot | `src/agents/acp.mjs` | **ACP** (Agent Client Protocol), un adaptador para todos: `initialize`, `session/new` o `load`, `session/prompt`, `session/update`, `session/request_permission` y `session/cancel` | La de cada programa |

**Registro.** `src/agents/index.mjs` reúne los adaptadores. Ahí están `adapter()`, `executable()`, `installed()` (con
caché de 30 s) y `status()` (versión y sesión para la pantalla Agentes).

**Añadir un agente ACP nuevo:**
1. Una entrada en `ACP_SPECS` de `acp.mjs`: paquete, binario, argumentos ACP, archivos de login, cómo instalarlo y modelos.
2. Su id en `AGENT_IDS` y `DEFAULT_CONFIG.agents` de `src/core/home.mjs`.
3. Su icono en `src/ui/components/agent-icon.jsx`.
4. Su elemento del instalador en `src/engine/installer.mjs`.

## 8. Guardia de permisos y aprobaciones

**Qué hace.** Es el equilibrio entre poder hacer cosas y seguridad. Para cada acción de un agente decide:
- **permitir** lo normal: leer, editar en su carpeta y comandos corrientes;
- **preguntar** lo arriesgado con una tarjeta Permitir, Permitir siempre o Denegar: push, `gh`, publicar paquetes,
  descargar y ejecutar, enviar datos, borrar carpetas, cambiar el sistema, cerrar procesos, ssh, reescribir git o Docker;
- **denegar** lo que nunca está bien: tocar los datos internos del asistente (`.orb/datos`, `.orb/copias`).

**Modos de permiso.**

| Modo | Qué puede hacer |
|---|---|
| `leer` | Solo mirar |
| `editar` | Por defecto. Edita y ejecuta; lo arriesgado pregunta |
| `preguntar` | Pregunta antes de cada comando |
| `total` | Sin comprobaciones. Solo desde el PC y con confirmación |

**Archivos.**
- Decisión: `src/core/guard.mjs` (`decide`, `RISKY` y `riskOf`).
- Cada adaptador la llama en su punto de permiso: `canUseTool` en Claude, `requestApproval` en Codex y
  `request_permission` en ACP.
- Tarjetas:
  - en las conversaciones, `ApprovalCard` de `src/ui/views/session.jsx`;
  - en el chat, `ChatApproval` de `chat.jsx` (las del asistente en modo libre y las de las tareas);
  - en la barra lateral, «Te esperan».
- Motor: `sessions.respond()`, `approvals.list` y `chat.approve`.

**Cómo reprogramarlo.**
- Añadir o quitar comandos arriesgados: la lista `RISKY` de `guard.mjs`, una línea por regla con su motivo.
- Una tarea esperando permiso también avisa en el chat (`sessions.onApproval` en `engine.mjs`).

## 9. Conversaciones directas

**Qué hace.** Hablas directamente con un agente en la carpeta de un proyecto, como en T3 Code. Ves:
- la respuesta en streaming;
- los comandos (con un icono según la herramienta) y los archivos cambiados;
- el uso de tokens (contando la caché).

Desde la cabecera puedes cambiar el modelo, los permisos y el razonamiento. Sin proyecto, solo puede leer.

**Archivos.**
- Interfaz: `src/ui/views/session.jsx` (`newConversation`, `SessionView`, bloques y tarjetas).
- Motor: `src/engine/sessions.mjs` (`create`, `send`, `message`, `getLive`, `onLiveEvent`, `items` paginado).
- Las tareas usan la misma maquinaria: cada tarea tiene su conversación.

**Por dentro.**
- `getLive` crea el proceso vivo la primera vez. Para retomar, usa `resumeId` = `sessions.cli_session`, el id de la
  conversación del propio agente.
- Un proceso sin uso durante 20 min se cierra (`IDLE_CLOSE_MS`) y se retoma en el siguiente mensaje.
- Sin modelo elegido se usa el `defaultModel` del agente (Sonnet en Claude), nunca el predeterminado de su programa, que
  puede ser el más caro.

## 10. Cola y corrección en marcha

**Qué hace.** Mientras el agente trabaja:
- **Intro** le corrige sobre la marcha: lo lee en su siguiente paso, en el mismo turno. Funciona con Claude (prioridad
  `next`) y Codex (`turn/steer`).
- **Ctrl+Intro** pone el mensaje **en cola**, que se envía en orden al terminar el turno. La cola se puede editar, reordenar
  y vaciar.
- Los agentes que no se pueden corregir en marcha siempre ponen en cola.

**Archivos.**
- `sessions.mjs`: `message()`, `enqueue()`, `editQueued()` y `takeQueued()`.
- Tabla `session_queue`.
- Interfaz: el bloque «En cola» de `session.jsx` y el placeholder del cuadro de mensaje.
- El asistente también se puede corregir en marcha (`Orchestrator.ask`).

## 11. Bifurcar, continuar y detalles

- **Bifurcar** hace una copia de la conversación desde este punto para probar otra idea. Claude y Codex llevan su historial
  completo de forma nativa (`forkSession`, `thread/fork`). Los demás empiezan con un resumen. Código: `sessions.fork()` y el
  botón con el icono de bifurcar.
- **Continuar:** una conversación que quedó a medias (la app se cerró) o sin cupo muestra «Continuar» (`sessions.resume()`).
- **Detalles** (icono «i»): agente, cuenta, permisos, carpeta, rama de git y cambios, pull requests, contexto, tarea, de
  dónde sale y el id de la conversación del agente (`showDetails()` en `session.jsx`).
- **Historial paginado:** se cargan los 200 últimos mensajes y «Ver mensajes anteriores» trae más
  (`sessions.items({ before })`).

## 12. Contexto y cupo real

**Qué hace.** Es el punto medio entre trabajar y no quemar tokens.
- **Medidor de contexto** en cada conversación y en el chat. Cuanto más lleno, más cara cada respuesta.
- **Cupo real:** Claude y Codex dicen cuánto llevas de su ventana (5 horas, semana) y cuándo se reinicia. A partir de
  `budget.stopAt` (92 %), el trabajo nuevo espera o va a otra cuenta.
- **Red de seguridad:** 20 tareas por ventana y 6 con modelos caros por cuenta. Antes eran 6 y 2, demasiado poco.
- Topes opcionales de gasto por tarea (`maxBudgetUsd`) y aprobación para razonamiento alto.

**Archivos.**
- `src/core/budget.mjs`:
  - `recordRate` y `realRate` (uso real);
  - `canLaunch` y `rankAccounts` (decisión y orden);
  - `startCooldown` (pausa hasta el reinicio).
- Origen de los datos: eventos `rate` de los adaptadores, en `sessions.onRate` (`engine.mjs`).
- Pantallas: Agentes («Uso de cada cuenta») y Ajustes («Parar al % del cupo real»).

## 13. Tareas limitadas y continuidad

- **Límite de uso:**
  - si una cuenta llega a su límite, la tarea no falla: queda **«esperando cupo»** (`limited`) con la hora de reinicio
    (`limited_until`);
  - **sigue sola** al reiniciarse el cupo (`resumeLimited()` en el planificador), en la misma conversación del agente;
  - mientras tanto, el trabajo nuevo va a otras cuentas.
- **Cerrar la app:** las tareas que estaban trabajando continúan al volver a abrirla (constructor del `Scheduler`).
- Las dos cosas se apagan en Ajustes (`continuity.resumeAtReset` y `continuity.resumeAfterRestart`).

## 14. Delegación entre agentes

**Qué hace.** Un agente que trabaja en una tarea puede pasar parte a otro agente o modelo y esperar el resultado.
- `orb_delegate` crea una subtarea; `orb_wait_tasks` espera hasta 15 min y devuelve los resultados.
- Las subtareas cuelgan de su tarea madre y se ven en el detalle de la tarea.
- **Delegación de confianza** (Ajustes): si la tarea madre la creó el asistente o tú, y la subtarea no tiene nada
  arriesgado, va directa a la cola, como mucho `delegation.maxPerTask` (4). Si no, espera tu aprobación.

**Archivos.**
- `src/mcp/server.mjs`: `delegate()` y `waitTasks()`, disponibles solo con `ORB_TASK_ID`.
- `src/core/board.mjs`: `createTask` con `parent_id` y la regla de confianza.
- Codex amplía el tiempo de sus herramientas MCP a 960 s para que la espera quepa.

## 15. Task Review

**Qué hace.** Otro modelo audita el trabajo en solo lectura y da su veredicto: **CORRECTO** o **CON FALLOS**, con la lista
de problemas y qué arreglar primero.
- Va a **otro proveedor** cuando lo hay: el trabajo de Claude lo revisa Codex, Gemini… Si no, el mismo agente con otro
  modelo.
- Se pide desde una tarea hecha o para un proyecto entero.
- El veredicto aparece junto a la tarea revisada.
- **Task Review automático** (Ajustes) revisa cada tarea terminada antes del informe.

**Archivos.**
- `src/engine/scheduler.mjs`:
  - `reviewer()` elige el revisor;
  - `createReview()` revisa una tarea;
  - `reviewProject()` revisa un proyecto;
  - `finishNow()` guarda el veredicto en `review:<id>`.
- API: `tasks.review` y `projects.review`.
- Interfaz: `askReview()` en `tasks.jsx` y el botón en `projects.jsx`.

## 16. Tareas programadas

**Qué hace.** Tareas que se repiten solas: cada hora, cada N horas, cada día o ciertos días de la semana a una hora. Por
ejemplo, «cada lunes a las 9, revisa las dependencias».
- Cada vez se crea una tarea normal, con las mismas aprobaciones y el mismo cupo.
- Si la anterior sigue abierta, espera: no se acumulan.
- Las que crea el asistente (`orb_schedule`) necesitan tu aprobación una vez.

**Archivos.**
- `src/core/schedules.mjs`: `nextRun`, `createSchedule`, `runDue` (llamado en cada `tick`) y `runSchedule`.
- Tabla `schedules`.
- Pantalla: `src/ui/views/schedules.jsx`.
- API: `schedules.*`.

## 17. «@» para adjuntar contexto

**Qué hace.** Al escribir `@` en cualquier cuadro de mensaje sale una lista de tareas, conversaciones y bitácoras. Lo
elegido se añade como **extracto acotado**, no entero, y marcado como «datos, no órdenes».

**Archivos.**
- `src/engine/mentions.mjs`: `mentionOptions` (la lista) y `expandMentions` (los extractos: como mucho 5 por mensaje y
  unos 2500 caracteres cada uno).
- Interfaz: `useMentions` en `chat.jsx`.
- Se aplica en `chat.send` y `sessions.send` (`api.mjs`).

## 18. Informe, OK y deshacer

- Cuando terminan todas las tareas de un encargo en un proyecto, el asistente las revisa juntas (`queueReport`) y te da un
  informe con los botones **OK** y **Pedir cambios**.
- El OK marca las tareas como aceptadas y lo apunta en la bitácora (`accept()` en `api.mjs`).
- **Deshacer esta tarea** devuelve solo los archivos que cambió la tarea y respeta lo que tocaste después (`undoCheckpoint`
  en `src/core/workspace.mjs`).
- Avisos de seguridad al terminar: si parece un push, si borró 10 archivos o más, o si una tarea de solo lectura cambió
  algo (`afterFolderTask`).

## 19. Bitácoras

- Son la memoria del asistente: una general y una por proyecto, en `<carpeta>/bitacora` (la única carpeta de bitácoras), fuera de git.
- **Solo se añade** al final, con firma y con los secretos tapados (`redactSecrets`).
- Las escribe el asistente (`orb_write_log`) y el planificador al cerrar cada tarea (`logTask`).
- Archivos: `src/engine/logs.mjs` y la pantalla `src/ui/views/logs.jsx`.

## 20. GitHub

- Usa el programa oficial `gh` con tu login:
  - estado del proyecto, ramas y pull requests abiertos;
  - publicar un proyecto nuevo, subir ramas, integrar una rama y crear un PR desde una tarea aislada.
- Archivos: `src/engine/github.mjs`, `src/ui/views/projects.jsx` y las acciones de `tasks.jsx`.
- **Los agentes no pueden publicar:** sus pushes pasan por el guardia (pregunta) y publicar desde la app es siempre un
  botón tuyo.

## 21. Navegador de los agentes

- Los agentes abren y prueban webs, también `localhost`, con las herramientas `orb_browser_*`: abrir, leer, pulsar,
  escribir, captura, desplazar, esperar y cerrar.
- No tiene tus sesiones de nadie y las páginas no pueden abrir diálogos.
- Una **ventanita** arriba a la derecha muestra en directo lo que hacen.
- Archivos:
  - `src/main/browser.mjs` (páginas ocultas, la ventanita y la tubería con clave por conversación);
  - las herramientas en `src/mcp/server.mjs`;
  - `src/core/browser-key.mjs`.

## 22. Móvil

**Qué hace.** La misma interfaz como web app en el móvil, sin apps de las tiendas. Se activa en Ajustes → Móvil, con dos
vías que se encienden por separado:

| Vía | Dirección | Qué permite |
|---|---|---|
| **Wifi de casa** | `http://<IP local del PC>:3131/` | Usarlo en casa sin instalar nada en el móvil |
| **Tailscale** | `https://<pc>.<tailnet>.ts.net:3131/` (con `tailscale serve`) o `http://<IP de Tailscale>:3131/` si la tailnet no tiene HTTPS | Usarlo fuera de casa; con HTTPS se instala como app y recibe avisos |

- Desde el móvil se puede chatear y aprobar, responder permisos, editar la cola, continuar y bifurcar, pedir Task Review,
  gestionar programadas y dar el OK. Lo delicado (ajustes, cuentas, instalar, acceso total, archivos del PC) solo desde
  el PC (`ALLOWED` en `remote.mjs`).
- En el móvil, el menú tiene **«Este móvil»**: cómo instalarlo como app y el interruptor de **avisos**.

**Vincular y cifrar** (`src/core/mobile-crypto.mjs`, el mismo código en el PC y en el móvil):
- El PC tiene una clave X25519 fija; su parte pública va en el QR junto a un código de un solo uso que caduca a los 5
  minutos: `#vincular=<código>&pc=<clave>` (detrás de `#`, el navegador no lo manda a ningún servidor).
- El móvil crea su propia clave y manda solo su parte pública y una prueba sellada con una clave derivada del código.
  **El código nunca viaja**: un QR fotografiado o copiado no sirve una vez usado, y un enlace sin el móvil no vale.
- La respuesta del PC va sellada con la clave de sesión: el móvil comprueba que habla con el PC del QR (la huella del PC
  sale en el QR y en el móvil).
- Después, cada petición, respuesta, evento en directo e imagen va cifrado con XChaCha20-Poly1305 bajo una clave que solo
  tienen ese móvil y el PC. Cada mensaje dice para qué es y de qué móvil (datos adicionales), lleva la hora y un número de
  un solo uso: el PC rechaza repeticiones, mensajes viejos (más de 5 minutos de diferencia) y manipulados.
- Funciona también por http (wifi), donde el navegador no ofrece su criptografía: usa las librerías `@noble/*`.
- Quitar un móvil en Ajustes borra su clave: deja de entrar al momento. Los móviles de la 2.3.2 o anteriores (sin clave
  propia) hay que volver a vincularlos.

**Avisos** (`src/engine/webpush.mjs`): solo por HTTPS (Tailscale con HTTPS). El móvil se suscribe desde «Este móvil» y el
PC envía los avisos directamente al servicio del navegador (Google, Apple, Mozilla) con Web Push: cifrados para ese
móvil (RFC 8291) y firmados con la clave VAPID del PC (RFC 8292). Sin servidores propios ni coste. Se avisa de cada
mensaje nuevo del chat de Orb (respuestas, tareas que esperan aprobación, terminadas o fallidas) cuando ese móvil no
tiene la app abierta. En iPhone funcionan con Orb añadido a la pantalla de inicio.

**Por dentro** (`src/engine/remote.mjs`):
- Un servidor http por dirección: cada IP local privada (sin adaptadores virtuales) y la de Tailscale, o 127.0.0.1 detrás
  de `tailscale serve --https=<puerto>`. Al apagar el acceso se quita esa configuración de `tailscale serve`.
- Solo responde a sus propios nombres (contra DNS rebinding) y a su propio origen.
- Cada minuto mira si ha cambiado la red (otra wifi, otra IP) y vuelve a abrir el acceso.
- La primera vez que escucha en la red local, Windows puede preguntar por el firewall: hay que permitir las redes
  privadas. Si el PC cambia de IP local, el móvil vinculado por wifi tiene que volver a vincularse (su app guarda la
  dirección antigua); una IP fija en el router lo evita.
- Archivos: `src/engine/remote.mjs`, `src/engine/webpush.mjs`, `src/core/mobile-crypto.mjs`, `src/ui/lib/web-bridge.js`,
  la tarjeta «Móvil» y «Este móvil» en `src/ui/views/settings.jsx`. Pruebas: `test/remote.test.mjs`,
  `test/webpush.test.mjs` y `test/mobile.e2e.mjs`.
- Pendiente, en espera: usarlo desde cualquier sitio sin Tailscale con un puente propio en Cloudflare
  ([`MOVIL-PUENTE.md`](MOVIL-PUENTE.md)).

## 23. Modo experto

- Explorador y visor de archivos, cambios de git con su diff, historial, lo que está en marcha, uso de las cuentas, carga del
  equipo y actividad, alrededor del chat. Solo en el PC.
- Se activa en Ajustes; los paneles solo se pueden marcar con el modo encendido.
- Archivos: `src/engine/expert.mjs` y `src/ui/views/expert.jsx`.

## 24. Instalador y detección de sesiones

**Qué hace.** En el primer arranque, y en Agentes, detecta qué tienes e instala lo que falte con los instaladores oficiales
en una ventana visible:
- herramientas: Git, Node.js, GitHub CLI y Tailscale;
- agentes: Claude Code, Codex, Cursor, Gemini CLI, Copilot, OpenCode y Qwen.

**Si ya tienes la sesión iniciada** en un agente (por ejemplo Codex con tu cuenta de ChatGPT), Orb la usa tal cual: no hay
que iniciar sesión en la app. Si no, «Iniciar sesión» abre el login oficial del programa.

**Archivos.**
- `src/engine/installer.mjs`: `ITEMS`, `check()` y el script de PowerShell.
- `detect()` y `loginState()` de cada adaptador (por ejemplo, la sesión de Codex está en `~/.codex/auth.json`).
- `src/core/accounts.mjs`: varias cuentas por agente; cada una tiene su carpeta de login y su cupo.

## 25. Conectores MCP

- Herramientas extra para los agentes (bases de datos, Figma…), en Ajustes.
- Los servidores propios van en `<carpeta>/mcp-servers`: es configuración de Orb, no sale como proyecto. Ajustes lista sus
  subcarpetas con el comando que las arranca (`src/engine/mcp-folder.mjs`: `bin`/`main` de package.json o archivos típicos
  como `src/server.js` o `server.py`) y las añade con un clic («Usar»).
- Se pasan a los agentes elegidos junto con el MCP de Orb (`mcpServersFor` en `sessions.mjs`).
- Claude usa `--strict-mcp-config`, así que solo carga los que pasa Orb y no todos los del usuario. Esto ahorra tokens.

## 26. Idiomas

- La app está en español de España y en inglés (Ajustes → Idioma, que se aplica al momento).
- Archivos:
  - base: `src/core/i18n.mjs` (`translate`, `createT`, `localeOf`);
  - diccionarios: 1148 claves, un archivo por área en `src/core/locales/es/` y `en/` (chat, session, tasks, agents,
    settings, setup, msg…), que `es.mjs` y `en.mjs` reúnen;
  - interfaz: `src/ui/lib/i18n.js` (`useT()` y `useLocale()` en componentes, `t()` y `currentLocale()` fuera de ellos);
  - motor: `tr()` de `src/core/context.mjs` (avisos del chat, errores y motivos del guardia en el idioma elegido).
- **Añadir un texto:** se escribe `t('pantalla.clave')` en el componente y la clave se añade en los **dos** diccionarios.
  Una prueba comprueba que coinciden.
- Lo que va a los agentes (encargos, instrucciones del asistente) no se traduce: el idioma de respuesta lo marca
  `config.language`.

## 27. Interfaz

- **Barra lateral:** asistente, Tareas, Proyectos, Programadas y, debajo:
  - la **bandeja**: «Te esperan» (permisos, aprobaciones, a medias, sin cupo; «Listo» las quita) y «Trabajando»;
  - las **carpetas** (cada proyecto con sus tareas y conversaciones) y «Sin carpeta».
  - Archivo: `src/ui/components/sidebar.jsx`.
- **Estética:** shadcn/ui, Tailwind y la fuente Outfit, con colores en `src/ui/app.css`.
  - Componentes base en `src/ui/components/ui/` (botones, tarjetas, selectores, checks y switches con modo noche
    corregido).
  - Logotipos reales de los agentes en `agent-icon.jsx` (Simple Icons, CC0).
  - Robot animado en `robot.jsx`.
- **Tema** día, noche o sistema; **tamaño** de la interfaz con Ctrl +, Ctrl - y Ctrl 0; **Ctrl J** abre una terminal en la
  carpeta.

## 28. Seguridad

- **Ventana:** `sandbox` y aislamiento de contexto, CSP sin `eval`, el Markdown se pinta sin HTML y cada llamada se
  comprueba en el proceso principal.
- **Clave de las aprobaciones:** cifrada por Windows (DPAPI). El motor la recibe solo en memoria y el MCP no la tiene
  nunca.
- **Identidad del coordinador:** su clave va solo a su propio proceso MCP (por el SDK, en memoria). En la base de datos
  solo queda su hash.
- **Agentes:** entorno limpio (sin las variables secretas de la app), guardia de permisos, datos internos prohibidos y
  avisos de push o borrados masivos.
- **Textos de los agentes:** cuando vuelven al asistente se marcan como «datos, no órdenes».
- Más detalle en `docs/historico/AUDITORIA-v2.md` y `docs/historico/AUDITORIA-v2-segunda.md`.

## 29. Empaquetado, versiones y CI

- **Portable de Windows:** `npm run dist`, o la CI al cambiar `version` en `main` (`.github/workflows/release.yml`).
- El SDK de Claude y `zod` van en `app.asar.unpacked`, junto al motor (`build.asarUnpack`).
- **No se empaqueta** la copia de Claude Code del SDK (238 MB): se usa la del usuario.
- `build/icon.ico` lleva 10 tamaños (`npm run icon:ico`).
- **Pruebas en cada push y PR**, en Windows y Linux: `.github/workflows/pruebas.yml`.
- **Instalador** (NSIS, por usuario, sin administrador): acceso directo en escritorio y menú Inicio. La release publica
  también `latest.yml` y los `.blockmap`, que usa el actualizador.

**Actualizaciones** (`src/main/updater.mjs`, `src/ui/components/update-card.jsx`):
- La app instalada usa `electron-updater` con GitHub Releases (`build.publish` en `package.json`; repositorio público, sin
  token). Mira al abrirse (a los 15 s) y cada 4 h; no descarga nada hasta que el usuario pulsa **Actualizar**.
- Estados que recibe la ventana (evento `app:update`): `checking`, `available`, `downloading` (con `percent`), `downloaded`,
  `none`, `error`, `off`. Tarjeta arriba a la derecha (bajo la cabecera: no tapa el menú ni el cuadro de texto) y tarjeta «Actualizaciones» en Ajustes.
- **Reiniciar y actualizar** (`app:updateInstall`): si hay tareas en marcha pregunta antes; luego para el motor y llama a
  `quitAndInstall` (instalación silenciosa y vuelve a abrir Orb). Con «Más tarde» se instala al cerrar la app.
- **Portable** (`PORTABLE_EXECUTABLE_FILE`): consulta la API de GitHub (`releases/latest`) y el botón abre la descarga.
- Desde el código no hay actualizaciones (`off`). `ORB_NO_UPDATE=1` las apaga; `ORB_FAKE_UPDATE=<versión>` simula una
  versión nueva sin red (pruebas); `ORB_UPDATE_URL=http://127.0.0.1:<puerto>/` usa un servidor local para probar una
  actualización antes de publicarla.

## 30. Pruebas

| Comando | Qué cubre |
|---|---|
| `npm test` | 84 pruebas (incluye que los diccionarios es/en coinciden y que el inglés no tiene español) del motor con agentes falsos (`test/fixtures/fake-live.mjs` vía `ORB_FAKE_AGENTS`), los protocolos reales contra servidores falsos (ACP, codex app-server, CLI de Cursor), el guardia, sesiones, tareas, delegación, Task Review, cupo y migraciones |
| `npm run test:app` | La app entera con Electron |
| `node test/explora.e2e.mjs` | Todas las vistas en día y noche, con capturas |
| `node test/real.e2e.mjs claude,codex,cursor` | **Agentes reales**: conversaciones, tarea del asistente, informe, deshacer, aprobación, corrección, cola, bifurcación, Task Review y programadas |
| `ORB_E2E_EXE=dist/win-unpacked/Orb.dev.exe node test/packaged-live.e2e.mjs` | La app empaquetada con Claude real |

## 31. Cómo reprogramar una funcionalidad

1. Busca la funcionalidad en este documento y abre solo sus archivos.
2. Respeta los contratos entre capas:
   - la interfaz de una sesión viva (`live.mjs`);
   - las acciones de la API (`api.mjs`: nombre y parámetros);
   - los eventos (`session:item`, `session:delta`, `session:queue`, `approval:changed`, `chat:state`, `board:changed`);
   - las tablas de `db.mjs` (añadir columnas con `ADDED`, nunca borrarlas).
3. Si la acción la usa el móvil, añádela a `ALLOWED` en `remote.mjs`.
4. Textos nuevos con `t()` en los dos idiomas.
5. Una prueba en `test/` con el agente falso (`fake-live.mjs` reconoce palabras clave como `LIMITE`, `PIDE_PERMISO`,
   `DELEGA`, `DUERME`…).
6. `npm run check` y `npm test` en verde antes de subir.

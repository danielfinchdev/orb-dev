# Coordinación Orb.dev 2.3.0 — Claude local + Claude en la nube

Rama principal de trabajo: **`orb-2.3`**. Nadie trabaja directamente en `main`: `main` publica una versión en cuanto cambia
`version` en `package.json`. Cada encargo va en su propia rama, que sale de `orb-2.3`, y vuelve a ella con un pull request.

## Quién hace qué

| Encargo | Quién | Rama | Estado |
|---|---|---|---|
| Motor en vivo (adaptadores, sesiones, guardia, tareas, asistente, delegación, Task Review, cupo) | Claude local (PC de Dani, Windows) | `orb-2.3` | hecho (1cb7bce) |
| Pruebas automáticas de la arquitectura 2.3 (agentes falsos, ACP falso, pruebas en Windows) | **Claude en la nube** | `orb-2.3-pruebas` | en curso |
| Interfaz 2.3 (aprobaciones, cola, contexto, bifurcar, bandeja, Task Review, agentes nuevos) | Claude local | `orb-2.3` | hecho |
| Tareas programadas, `@` para adjuntar contexto, panel de detalles | Claude local | `orb-2.3` | hecho |
| Español (España) e inglés completos (i18n) | **Claude en la nube** (segundo encargo) | `orb-2.3-i18n` | en curso |
| Documento de funcionamiento (`docs/FUNCIONAMIENTO.md`) | Claude local | `orb-2.3` | al final |

## Reglas para todos

1. **La idea de Orb no cambia nunca.** Un chat con el asistente que, al hablarle de un proyecto, escribe encargos optimizados
   en tokens y los reparte entre varios agentes de distintos proveedores, que trabajan a la vez y coordinados.
2. **La estética se mantiene.** Mismos componentes (shadcn/ui + Tailwind, Outfit, robot), mismos colores y el mismo tono.
   Todo cambio sigue lo que ya hay sin romperlo.
3. Textos de la app en español de España, cercanos y sin jerga. Más adelante también en inglés.
4. Nunca subas `BITACORA.md`, secretos, `.env` ni datos de prueba con rutas personales.
5. Commits en español, pequeños y con qué y por qué. Al final del mensaje:
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
6. Antes de abrir el PR, `npm run check` y `npm test` en verde.

## Arquitectura 2.3 en una página (para no tener que leerlo todo)

- `src/agents/live.mjs` — interfaz común de una **sesión viva** con un agente:
  - `send({ text, images })` devuelve `{ final, text, isError, usage, limit }`.
  - `steer({ text })`, `interrupt()`, `respond(id, 'allow'|'always'|'deny')`, `setModel()`, `setPermission()` y `close()`.
  - Eventos por `onEvent`: `item`, `delta`, `session`, `approval`, `approval_done`, `context`, `rate`, `limit` y `exit`.
- Adaptadores:
  - `claude.mjs`: Claude Agent SDK con el `claude.exe` del usuario.
  - `codex.mjs`: `codex app-server` (JSON-RPC).
  - `cursor.mjs`: la CLI oficial en streaming, un proceso por turno.
  - `acp.mjs`: ACP para Gemini CLI, OpenCode, Qwen Code y Copilot.
  - El registro está en `index.mjs`.
- `src/core/guard.mjs` decide cada acción: permitir, preguntar al usuario (tarjeta) o denegar. Hay cuatro modos de permiso:
  `leer`, `editar`, `preguntar` y `total`.
- `src/engine/sessions.mjs` lleva un proceso vivo por conversación y gestiona:
  - la cola de mensajes (`session_queue`), corregir en marcha, las aprobaciones y el medidor de contexto;
  - bifurcar (`fork`) y continuar (`resume`).
- `src/engine/scheduler.mjs` gestiona las tareas:
  - estado `limited` (sigue sola al reiniciarse el cupo) y continuar después de cerrar la app;
  - Task Review (`createReview`, `reviewProject`).
- `src/core/budget.mjs` usa el uso real que reportan las cuentas (`recordRate`, `realRate`, `stopAt`).
- `src/mcp/server.mjs`: `orb_delegate` y `orb_wait_tasks` para que un agente reparta subtareas.
- Pruebas: `ORB_FAKE_AGENTS=<módulo>` cambia todos los agentes por uno falso. El módulo exporta `fakeAdapter(id, real)` y
  devuelve un objeto con la forma de un adaptador (`id`, `label`, `kind`, `caps`, `detect`, `loginState`,
  `loginCommand`, `createLive`).

## Encargo del Claude en la nube: pruebas de la 2.3 (`orb-2.3-pruebas`)

Las pruebas de `test/` se escribieron para la 2.1: lanzaban agentes falsos como programas (`fake-claude.mjs`,
`fake-codex.mjs`) que imitaban la salida `-p --output-format stream-json`. Con la 2.3 eso ya no aplica. Hay que:

1. Crear `test/fixtures/fake-live.mjs`, que exporte `fakeAdapter(id, real)`. El adaptador falso:
   - responde según el texto con las mismas palabras clave que ya usan las pruebas (`CREA_TAREA <proyecto>`, `NAVEGA <url>`,
     `ESCRIBE`…);
   - escribe archivos en `cwd`;
   - puede pedir una aprobación (`PIDE_PERMISO`), simular un límite de uso (`LIMITE`) y emitir `delta`/`context`/`rate`;
   - usa el MCP real de Orb cuando hace falta crear tareas, como hacían los falsos: puede lanzar `src/mcp/server.mjs` con
     `ORB_AGENT`/`ORB_ORCH_KEY` y hablarle por stdio.
2. Adaptar `test/helpers.mjs`, `engine.test.mjs`, `live.test.mjs`, `mcp.test.mjs`, `agents.test.mjs`, `remote.test.mjs`,
   `core.test.mjs` y `app.e2e.mjs` a la 2.3, con `ORB_FAKE_AGENTS`.
3. Pruebas nuevas:
   - el guardia (`guard.mjs`, una tabla de casos);
   - la cola y corregir en marcha;
   - las aprobaciones: permitir, denegar, y que caduquen al cerrar;
   - tarea `limited`, que continúa al pasar `limited_until`;
   - continuar después de reiniciar;
   - delegación (`orb_delegate`), con y sin confianza, respetando `maxPerTask`;
   - Task Review: otro proveedor y veredicto guardado en `review:<id>`;
   - migración de configuración (versión 2 a 3, topes 6/2 a 20/6, cuentas de los agentes nuevos);
   - `budget` con uso real (`stopAt`).
4. Crear `test/fixtures/fake-acp.mjs`, un agente ACP mínimo por stdio (`initialize`, `session/new`, `session/prompt` con
   `session/update`, `session/request_permission`, `session/cancel`), y probar `acp.mjs` contra él de punta a punta.
5. Que todo pase también en **Windows**. Nada de lanzar `.mjs` como programa: con el adaptador falso no hace falta. Añade
   el job a `.github/workflows/release.yml` si es sencillo, sin publicar nada.
6. No toques `src/ui/**`: la interfaz la está cambiando el Claude local. Si una prueba necesita un cambio pequeño en
   `src/`, hazlo y explícalo en el PR.

Al terminar, abre un PR de `orb-2.3-pruebas` contra `orb-2.3` con un resumen de lo que cubre cada prueba.

## Encargo 2 del Claude en la nube: español (España) e inglés (`orb-2.3-i18n`)

La base ya está hecha:
- `src/core/i18n.mjs`: `translate`, `createT` y `localeOf`.
- Diccionarios en `src/core/locales/es.mjs` y `src/core/locales/en.mjs`.
- `src/ui/lib/i18n.js`: `useT()` en componentes y `t()` fuera de ellos.
- El selector de idioma en Ajustes, que guarda `config.language` (`es` o `en`).
- Ejemplo ya convertido: `src/ui/components/sidebar.jsx`.

Hay que:

1. Convertir **todos** los textos visibles de `src/ui/**` (vistas, componentes, diálogos, avisos `toast`, `labels.js`, el
   primer arranque y la web del móvil) a `t('clave')`.
   - Claves por pantalla: `chat.*`, `session.*`, `tasks.*`, `agents.*`, `settings.*`, `setup.*`…
   - Textos con datos con marcadores: `t('tasks.count', { n })`.
   - Fechas y números con `useLocale()`, no con `'es-ES'` fijo.
2. Pasar también a `translate(ctx.config.language, …)` los mensajes del motor que lee el usuario:
   - los avisos del chat (`board.addChat('system', …)` en `scheduler.mjs`, `board.mjs`, `api.mjs`, `engine.mjs` y
     `orchestrator.mjs`);
   - los errores de validación de `api.mjs` y `context.mjs`;
   - los textos de `guard.mjs` (motivos) y de `agent-errors.mjs`.
3. No traduzcas lo que va a los agentes: personas, encargos, `promptFor` y las descripciones de las herramientas MCP. Eso
   sigue en español, porque es lo que entiende el asistente, y el idioma de respuesta ya se elige con `config.language`.
4. Español de **España** (vosotros no hace falta; tú, cercano y sin jerga) e inglés británico natural, no literal. No
   cambies el tono ni la estética.
5. Prueba nueva: todas las claves de `es.mjs` existen en `en.mjs` y al revés, y ningún texto visible queda en español
   cuando el idioma es inglés. Una forma de comprobarlo es la prueba de la app cambiando el idioma y buscando palabras
   típicas.
6. Haz `git merge orb-2.3` a menudo, porque el Claude local sigue empujando cambios, y resuelve los conflictos con cuidado.
   PR contra `orb-2.3`.

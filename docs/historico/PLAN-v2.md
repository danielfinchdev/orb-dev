# Orb.dev — plan y arquitectura

Decisiones (2026-10-04): código cerrado de momento, primera versión solo para **Windows**, idioma por defecto **español**.
Objetivo: que Orb sea una aplicación propia y portable que sustituya a T3 Code y que mantenga lo que lo hace distinto: un
asistente que coordina a varios agentes (Claude Code, Codex, Cursor) en un proyecto.

## Qué es Orb.dev

- Una **aplicación de escritorio** (Electron), no una web en el navegador. Sin servidor HTTP: la ventana habla con el motor
  por mensajes internos, así desaparecen los riesgos de la 1.5 (DNS rebinding, CSRF, cookies, emparejado).
- **Primer arranque:** pide el nombre del asistente (Orb por defecto), cómo quieres que te llame y dónde crear su carpeta.
  Todo vive ahí (actualizado el 2026-10-04: los proyectos son carpetas directas, ya no hace falta una carpeta de desarrollo aparte):

  ```
  D:\Orb\
    orb.json                configuración (agentes, modelos, topes, preferencias)
    bitacoras\GENERAL.md       bitácora general
    bitacoras\proyectos\<p>.md bitácora de cada proyecto (fuera del repo: nunca entra en git)
    <proyecto>\                cada carpeta es un proyecto (creada por la app o a mano en el Explorador)
    .orb\                   oculta: datos\ (base de datos, clave cifrada), ejecuciones\, copias\ (aisladas y fotos)
  ```

- **Agentes:** detecta Claude Code, Codex y Cursor instalados en el equipo y usa **el programa y la sesión que el usuario ya
  tiene** (Orb nunca pide, guarda ni toca credenciales). Botón «Iniciar sesión» abre el login oficial de cada uno.
- **Dos formas de trabajar:**
  1. **Orb (estrella):** el chat con el asistente, que analiza el pedido, escribe buenos encargos, los reparte entre agentes,
     vigila cupo, aprobaciones y resultados, y lo apunta en las bitácoras.
  2. **Conversaciones directas** al estilo T3 Code: eliges agente, modelo, proyecto y permisos, y hablas con él en directo
     (ves sus mensajes, comandos y archivos cambiados mientras trabaja).
- **Tareas en directo:** las tareas que lanza Orb usan el mismo motor de sesiones, así que también se ven en directo y se
  puede seguir hablando con su agente.
- **GitHub:** mediante el programa oficial `gh` (login oficial, sin tokens en Orb): estado, ramas, pull requests de cada
  proyecto y «Crear pull request» desde una tarea. Publicar (push / PR) siempre lo confirma el usuario con un botón.
- **Herramientas extra (MCP):** el usuario puede añadir conectores MCP (p. ej. control del navegador con Playwright) que se
  pasan a los agentes que elija.

## Qué se reutiliza de la 1.5

| 1.5 | 2.0 |
|---|---|
| `core/board.mjs`, `db.mjs` | `src/core/board.mjs`, `db.mjs`: mismo tablero, generalizado (sin nombres fijos, modelos configurables) |
| `approval.mjs`, `safety.mjs`, `budget.mjs`, `workspace.mjs` | igual en `src/core/`, con rutas de la carpeta del asistente |
| `runners.mjs` | `src/agents/`: detección genérica + comandos en streaming |
| `orchestrator.mjs`, `chronicle.mjs` | `src/engine/orchestrator.mjs`, `logs.mjs`: persona configurable, bitácoras propias |
| `mcp-server.mjs` | `src/mcp/server.mjs`: mismas herramientas, textos genéricos |
| `daemon.mjs`, `app.html`, `access.mjs`, `push.mjs`, `t3.mjs`, scripts PowerShell | **se sustituyen**: motor por mensajes, interfaz nueva, sin web, sin T3 |

## Estructura del código

```
src/main/      Electron: ventana, diálogos, puente seguro (preload) y arranque del motor
src/ui/        interfaz (React + shadcn/ui + Tailwind, Outfit); se compila en src/renderer
src/engine/    motor (proceso aparte): rutas de mensajes, planificador, sesiones, orquestador, bitácoras, GitHub
src/core/      lógica pura reutilizada de la 1.5 (tablero, aprobaciones, seguridad, cupo, carpetas)
src/agents/    un archivo por agente: detectar, construir el comando, interpretar sus eventos
src/mcp/       servidor MCP que cargan los agentes
test/          pruebas (node --test) y prueba de la app con Electron
```

## Etapas

1. Base: app, primer arranque, carpeta y bitácoras, núcleo trasladado, agentes detectados.
2. Sesiones en directo (conversaciones y tareas).
3. Orb orquestador sobre el motor nuevo.
4. GitHub y conectores MCP.
5. Auditoría de optimización y seguridad, arreglos y empaquetado portable (`npm run dist` en Windows).
6. Varias cuentas por agente, instalación automática con los instaladores oficiales y acceso desde el móvil (Tailscale + QR).
7. Navegador de los agentes con ventanita flotante en directo, modo experto (solo PC) y repaso responsive.
8. Segunda auditoría (`docs/historico/AUDITORIA-v2-segunda.md`) con sus arreglos.

## Pendiente fuera del código (antes de publicar)

- Revisar las condiciones de uso vigentes de Anthropic, OpenAI y Cursor para apps de terceros que usan sus CLI oficiales.
- Nombre comercial: **Orb.dev** (el asistente se llama «Orb» por defecto y cada uno puede ponerle el suyo). Antes de
  publicar: comprobar la marca en EUIPO/OEPM y el dominio. Está en `src/core/product.mjs` y `package.json`.
- Certificado de firma de código para Windows (sin él, SmartScreen avisa) y actualizaciones automáticas.
- «Computer use» de escritorio completo (ratón y teclado del PC): no incluido. Los agentes tienen su propio navegador
  (páginas web) y la ventanita muestra lo que hacen en él.

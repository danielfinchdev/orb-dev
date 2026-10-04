# Orb.dev — tu jefe de proyecto de agentes de IA

Aplicación de escritorio para Windows (portable). Hablas con tu asistente («Orb» o el nombre que le pongas), él convierte
lo que pides en encargos, los reparte entre **Claude Code, Codex y Cursor**, revisa lo que hacen y te lo cuenta para que des
el **OK**. También puedes hablar directamente con cada agente, en directo, como en T3 Code.

```
Tú → Orb → tareas y coordinación → agentes → tareas hechas → Orb revisa → informe → tu OK
```

## Probarlo (versión de prueba)

Es una versión de prueba: hecha para Windows 10/11 y todavía sin probar a fondo en un Windows real. Si algo falla,
cuéntalo con una captura.

1. Instala [Git](https://git-scm.com/) y [Node.js 22.13 o superior](https://nodejs.org/).
2. Descárgalo y arráncalo:
   ```bash
   git clone https://github.com/danielfinchdev/orb-dev.git
   cd orb-dev
   npm install
   npm start
   ```
3. En el primer arranque te ofrece instalar lo que falte (Claude Code, Codex, Cursor…). Necesitas **tu propia cuenta** de
   al menos uno de ellos; el inicio de sesión lo hace su programa oficial, la app nunca ve tus contraseñas.

## Empezar

1. Abre `Orb.dev-2.0.0-portable.exe`.
2. Elige su nombre, cómo te llama y dónde crear su carpeta (por ejemplo `D:\` → `D:\Orb`).
3. En **Agentes**, comprueba que encuentra Claude Code, Codex o Cursor y que tienen la sesión iniciada (el botón abre el login
   oficial de cada uno; la app nunca ve tus contraseñas).
4. Crea un proyecto desde el chat (botón de proyecto bajo el cuadro de texto) y pídele algo.

## La carpeta del asistente

```
D:\Orb\
  orb.json              ajustes
  bitacoras\GENERAL.md     memoria general
  bitacoras\proyectos\     una bitácora por proyecto
  webviaproject\           cada carpeta es un proyecto (las que crea la app y las que crees tú en el Explorador)
  .orb\                 datos de la app (oculta): base de datos, clave cifrada, registros, copias para deshacer
```

## Lo principal

- **Chat con el asistente**: modelo Sonnet 5.5 (ahorro) u Opus 5.5, ambos con razonamiento medio, y casilla **Orquestador**:
  marcada, solo coordina; desmarcada (modo libre), trabaja directamente en el proyecto (sin push ni publicar).
- **Tareas**: en la carpeta del proyecto, por turnos y con **«Deshacer esta tarea»**, o en una copia aislada con rama propia.
  Aprobación obligatoria para lo delicado (publicar, borrar, credenciales, pagos, razonamiento alto, tareas creadas por un agente).
  Cupo por agente cada 5 h. Revisión cruzada opcional. Informe final con **OK / Pedir cambios**.
- **Conversaciones directas** con cada agente, en directo: mensajes, comandos, archivos cambiados, imágenes de referencia
  y permisos («Solo leer», «Editar archivos», «Acceso total»).
- **GitHub** con el `gh` oficial: publicar un proyecto, subir ramas, crear pull requests, clonar, ver PR abiertos.
- **Varias cuentas por agente** (2 de Codex, 3 de Claude…): cada una con su login, su cupo y su pausa por límite; las
  tareas se reparten solas entre las que tienen cupo, o fijas una concreta.
- **Instalación automática**: en el primer arranque (y en «Agentes») instala lo que falte con los instaladores oficiales
  (Git, Node.js, GitHub CLI, Tailscale, Claude Code, Codex, Cursor) en una ventana visible.
- **Navegador de los agentes**: abren, prueban y revisan webs (también `localhost`) con las herramientas `orb_browser_*`,
  y una **ventanita flotante arriba a la derecha** te enseña en directo lo que hacen (se agranda, se contrae o se cierra).
- **Móvil sin apps nativas**: activa «Móvil» en Ajustes, escanea el QR (de un solo uso) con el móvil conectado a tu
  Tailscale y añade la web a la pantalla de inicio (por ejemplo desde Vivaldi). El móvil chatea, aprueba, da el OK y
  sigue las tareas; lo delicado (ajustes, cuentas, instalar, acceso total, archivos del PC) solo desde el PC.
- **Modo experto** (Ajustes, solo PC): explorador y visor de archivos, cambios de git con su diff, historial, lo que está
  en marcha, uso de las cuentas, carga del equipo y actividad, alrededor del chat. Eliges qué paneles ver.
- **Conectores MCP** extra para los agentes (bases de datos, Figma…).
- **Robot animado** que reacciona (piensa, habla, se alegra, se preocupa, se duerme) y avisa en una esquina. Día y noche.
  Todo es responsive (móvil y ventanas estrechas) salvo el modo experto.

## Desarrollo

```bash
npm install
npm start            # compila la interfaz y abre la app
npm test             # pruebas del motor (agentes falsos, sin cuentas)
npm run test:app     # la app entera con Electron (en Linux: xvfb-run -a npm run test:app)
npm run test:movil   # la web app del móvil a tamaño de teléfono
npm run dist         # Orb.dev-2.0.0-portable.exe e instalador (en Windows)
npm run icon         # vuelve a dibujar el icono desde el robot
```

| Carpeta | Qué hay |
|---|---|
| `src/main/` | Electron: ventana, primer arranque, puente seguro, arranque del motor y navegador de los agentes con su ventanita |
| `src/engine/` | Motor (proceso aparte): API, sesiones en directo, planificador, orquestador, bitácoras, GitHub, móvil, instalador, modo experto |
| `src/core/` | Tablero, aprobaciones, seguridad, cupo, carpetas y deshacer |
| `src/agents/` | Un adaptador por agente: detectarlo, lanzarlo e interpretar sus eventos |
| `src/mcp/` | Servidor MCP que usan los agentes y el asistente |
| `src/ui/` | Interfaz (React + componentes shadcn/ui + Tailwind, tipografía Outfit) |
| `docs/` | Plan y auditorías |

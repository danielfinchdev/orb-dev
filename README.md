# Orb·e: Tu director de bolsillo

**Orb** (`Orb.exe`) es una aplicación de escritorio para Windows (instalador o portable). Hablas con su robot, **Orb·e** (o
como lo llames), y él:

1. **Planifica tu proyecto por fases y escribe un encargo claro para cada agente, sin gastar tokens de más.** Los agentes
   son de varios proveedores (**Claude Code, Codex, Cursor, Gemini CLI, OpenCode, Qwen Code y GitHub Copilot**) y trabajan a la vez.
2. **Te entrega resultados comprobados**, para que des el **OK**.

También puedes hablar directamente con cada agente, en directo: respuesta en streaming, corregirle sobre la marcha, cola
de mensajes, permisos con un clic y bifurcar.

Este repositorio es **Orb.dev**, el desarrollo de la app. Cómo funciona todo, funcionalidad por funcionalidad:
[`docs/FUNCIONAMIENTO.md`](docs/FUNCIONAMIENTO.md). Novedades: [`docs/NOVEDADES.md`](docs/NOVEDADES.md).

```
Tú → Orb·e → tareas y coordinación → agentes → tareas hechas → Orb·e revisa → informe → tu OK
```

## Descargar y usar (lo más fácil)

1. Entra en [**Releases → última versión**](https://github.com/danielfinchdev/orb-dev/releases/latest) y descarga
   **`Orb-2.6.0-instalador.exe`**.
2. Doble clic: se instala para tu usuario (sin permisos de administrador) con acceso directo en el escritorio y en el menú
   Inicio. Luego lo abres escribiendo «Orb» en el buscador de Windows.
3. Windows SmartScreen avisará porque la app aún no está firmada: «Más información» → «Ejecutar de todas formas».

¿Sin instalar nada? **`Orb-2.6.0-portable.exe`** se abre tal cual con doble clic. ¿Y que arranque más rápido? Descarga **`Orb-2.6.0-windows.zip`**, clic derecho → «Extraer todo» y abre
`Orb.exe` de dentro de la carpeta. No hace falta instalar Node.js ni Git para la app; los agentes (Claude Code, Codex,
Cursor) te los instala ella misma en el primer arranque. El repositorio es privado: para descargar hay que tener acceso
a él en GitHub (o que te pasen el archivo).

Cada versión nueva se publica sola: al cambiar `version` en `package.json` en `main`, GitHub la prueba, la construye en
un Windows real, prueba la app empaquetada (`.github/workflows/release.yml`) y deja en Releases el `.exe` y el `.zip`. Es una versión de prueba: si algo falla, cuéntalo con
una captura.

## Usarla desde el código (para desarrollar)

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
4. Para abrirla otra vez: en la carpeta `orb-dev`, `npm start`. Para tener la última versión: `git pull` y `npm install`
   antes de `npm start` (mejor que un zip: así recibes los arreglos).

El `.exe` no está dentro del código: se descarga de Releases (arriba) o lo generas tú en Windows con `npm run dist`
(deja en `dist\` el portable y un instalador).

**Ojo con Cursor:** su plan gratuito no deja usar el agente desde otras apps. Si una tarea falla por eso, la app lo dice
claro, deja Cursor en pausa un día y, si la tarea era para «cualquier agente», se la pasa a otro.

## Empezar

1. Abre Orb desde el menú Inicio (o `Orb-2.6.0-portable.exe`, o `npm start` si la usas desde el código).
2. Elige su nombre, cómo te llama y dónde crear su carpeta. La carpeta se llama como el asistente: con `D:\` y el nombre
   «Nova» se crea `D:\Nova`; si dejas el nombre por defecto, `D:\Orb`.
3. En **Agentes**, comprueba qué agentes encuentra (Claude Code, Codex, Cursor, Gemini CLI, OpenCode, Qwen Code, Copilot) y
   que tienen la sesión iniciada. Si ya iniciaste sesión en su programa (por ejemplo Codex con tu cuenta de ChatGPT), no
   hace falta nada más; si no, el botón abre el login oficial (la app nunca ve tus contraseñas).
4. Crea un proyecto desde el chat (botón de proyecto bajo el cuadro de texto) y pídele algo.

## La carpeta del asistente

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

## Lo principal

- **Novedades de la 2.3**:
  - **Agentes en directo:** un proceso vivo por conversación, respuesta en streaming, corregir en marcha (Intro), cola
    editable (Ctrl+Intro), bifurcar, continuar tras cerrar, detalles y medidor de contexto.
  - **Permisos equilibrados:** lo arriesgado pregunta con una tarjeta Permitir/Denegar en lugar de prohibirse.
  - **Más agentes** por ACP.
  - **Cupo real:** usa el uso que dicen Claude y Codex; las tareas esperan solas al reinicio.
  - **Delegación** entre agentes.
  - **Task Review:** otro modelo de otro proveedor audita y da un veredicto.
  - **Tareas programadas**, **«@»** para adjuntar contexto y **bandeja** en la barra lateral.
  - **Español de España e inglés.**
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
- **Móvil sin apps nativas**: activa «Móvil» en Ajustes y escanea el QR (de un solo uso) con el móvil, por la wifi de
  casa (sin instalar nada) o por Tailscale (también fuera de casa, con HTTPS). Todo va cifrado de extremo a extremo
  entre el móvil y el PC. La web se añade a la pantalla de inicio como una app y, por HTTPS, avisa de lo que espera tu
  aprobación. El móvil chatea, aprueba, da el OK y sigue las tareas; lo delicado (ajustes, cuentas, instalar, acceso
  total, archivos del PC) solo desde el PC.
- **Modo experto** (Ajustes, solo PC): explorador y visor de archivos, cambios de git con su diff, historial, lo que está
  en marcha, uso de las cuentas, carga del equipo y actividad, alrededor del chat. Eliges qué paneles ver.
- **Conectores MCP** extra para los agentes (bases de datos, Figma…).
- **Menú de carpetas**: a la izquierda, cada proyecto es una carpeta que se pliega y despliega con las tareas que le has
  mandado y sus conversaciones (el `+` de cada carpeta te lleva al chat con ese proyecto elegido). Las conversaciones sin
  proyecto, en «Sin carpeta».
- **Tareas en directo**: mientras trabaja, cada tarea enseña cuánto lleva, los pasos, qué está haciendo ahora y el
  porcentaje que va informando el agente (en «Tareas» y encima del cuadro de texto del chat). Si una tarea pasa 10 minutos
  sin dar señales, te avisa en el chat para que mires su conversación o la canceles.
- **Fallos explicados**: si un agente no puede trabajar (plan sin acceso, sin sesión, modelo no disponible, sin red), la
  tarea dice por qué y qué hacer, en vez de un «falló» a secas.
- **Ajustes en una ventana** con apartados (General, Apariencia, Tareas y usos, Móvil, Herramientas, Modo
  experto, Actualizaciones, Contribuye y Más aplicaciones).
- **Apariencia:** modo claro, oscuro o sistema; temas Orb, Vaporwave, Retro arcade, Profesional (sin robot) y Candy;
  tipografía de la interfaz y del código; colores del código. La barra de menús de Windows está oculta por defecto.
- **Tamaño de la interfaz** en Ajustes → Apariencia (Pequeña / Normal / Grande) o con `Ctrl +`, `Ctrl -` y `Ctrl 0`
  (también `Ctrl` + rueda del ratón). Se guarda en cada PC.
- **`Ctrl J` abre una terminal** en la carpeta del proyecto que tengas delante: Warp si lo tienes instalado; si no,
  Windows Terminal o PowerShell. En Ajustes → Apariencia puedes elegir una fija (Warp, Windows Terminal, PowerShell o CMD).
- **Robot animado** que reacciona (piensa, habla, se alegra, se preocupa, se duerme) y avisa en una esquina.
  Todo es responsive (móvil y ventanas estrechas) salvo el modo experto.
- **Contribuye:** apoyo por PayPal y comentarios con capturas, sin cuenta.

## Desarrollo

```bash
npm install
npm start            # compila la interfaz y abre la app
npm test             # pruebas del motor (agentes falsos, sin cuentas)
npm run test:app     # la app entera con Electron (en Linux: xvfb-run -a npm run test:app)
npm run test:movil   # la web app del móvil a tamaño de teléfono
ORB_E2E_EXE=dist/win-unpacked/Orb.exe node test/smoke.e2e.mjs   # prueba la app ya empaquetada
npm run dist         # Orb-2.6.0-portable.exe e instalador (en Windows)
npm run icon         # vuelve a sacar el icono del art work (docs/diseno/art work); luego npm run icon:ico
```

| Carpeta | Qué hay |
|---|---|
| `src/main/` | Electron: ventana, primer arranque, puente seguro, arranque del motor y navegador de los agentes con su ventanita |
| `src/engine/` | Motor (proceso aparte): API, sesiones en directo, planificador, orquestador, bitácoras, GitHub, móvil, instalador, modo experto |
| `src/core/` | Tablero, aprobaciones, seguridad, cupo, carpetas y deshacer |
| `src/agents/` | Un adaptador por agente: detectarlo, lanzarlo e interpretar sus eventos |
| `src/mcp/` | Servidor MCP que usan los agentes y el asistente |
| `src/ui/` | Interfaz (React + componentes shadcn/ui + Tailwind, tipografía Outfit) |
| `docs/` | Toda la documentación: índice en [`docs/README.md`](docs/README.md) |

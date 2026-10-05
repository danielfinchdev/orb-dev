# Segunda auditoría de seguridad y optimización — Orb.dev 2.0

2026-10-04, rama `orb-2`. Revisión de todo lo añadido después de la primera auditoría
(`docs/AUDITORIA-v2.md`): acceso desde el móvil, navegador de los agentes con su ventanita, varias cuentas por agente,
instalación automática y modo experto. Tres revisiones independientes (una por área) y después la comprobación de cada
hallazgo contra el código antes de arreglarlo. Cada punto dice si **se aplicó** o si queda como **límite conocido**.

## Resumen

- **28 hallazgos**: 3 altos, 13 medios y 12 bajos. **26 aplicados** con pruebas; 2 quedan como límites conocidos y se explican.
- Lo más serio: el móvil recibía los ajustes completos (con las claves de los conectores MCP); una página web hostil
  podía abrir ventanas de alerta en tu escritorio y bloquear al agente; y el diff del modo experto se podía engañar con
  patrones de git para enseñar un `.env`.
- Pruebas: 41 del motor (`npm test`), la app entera con Electron (`npm run test:app`, 30 capturas, incluye el navegador
  con una página que lanza `alert()` y tiene un campo para subir archivos), y la web app del móvil a tamaño de teléfono
  (`npm run test:movil`). También la app empaquetada.

## Móvil (servidor por Tailscale)

| # | Gravedad | Hallazgo | Arreglo |
|---|---|---|---|
| M1 | Alta | `app.state` y el evento `config:changed` enviaban la configuración completa: variables de entorno de los conectores MCP (tokens), carpetas de las cuentas y rutas de los programas. | **Aplicado.** El móvil recibe una versión reducida (`phoneConfig`): conectores sin comando ni entorno, cuentas sin carpeta, agentes sin ruta. El evento ya no lleva la configuración. Prueba: `remote.test.mjs`. |
| M2 | Media | Una conversación a la que el PC dio «Acceso total» se podía seguir usando desde el móvil. | **Aplicado.** Cualquier acción del móvil sobre una conversación con acceso total se rechaza (salvo detenerla). Prueba. |
| M3 | Media | La sesión del móvil era una cookie, y las cookies no distinguen puertos: un servidor de desarrollo que un agente arranque en el mismo PC la recibiría si abres esa web en el móvil. | **Aplicado.** Sin cookies: la página guarda su clave en su propio almacenamiento (solo esa dirección y puerto) y la manda en una cabecera `Authorization`; los eventos en directo van por `fetch`. De paso desaparece el CSRF. Prueba. |
| M4 | Media | Activar y desactivar muy seguido podía dejar el servidor escuchando sin forma de pararlo. | **Aplicado.** Un único arranque a la vez y un contador de paradas: si lo apagas mientras arranca, no llega a escuchar. Apagar también anula el QR pendiente. |
| M5 | Baja | Un móvil que deja de leer los eventos acumulaba memoria sin límite; sin tope de conexiones por móvil. | **Aplicado.** Se corta el flujo que pasa de 1 MB pendiente; máximo 3 flujos por dispositivo. |
| M6 | Baja | Los intentos fallidos de vinculación se contaban para todos (otro equipo podía bloquearte) y un cuerpo raro daba error 500 sin contar. | **Aplicado.** Intentos por dirección; cuerpo y rutas raras validados. Prueba. |
| M7 | Baja | Se escuchaba en la primera dirección 100.64/10, que también usan el CGNAT de algunos operadores y otras VPN. | **Aplicado.** Solo la dirección que confirma `tailscale status` o la del adaptador de Tailscale. |
| M8 | Baja | Las fotos subidas desde el móvil no se borraban nunca y se escribían bloqueando el motor. | **Aplicado.** Escritura asíncrona, 3 subidas a la vez, 7 días y 300 MB como máximo (se borran las más viejas). |
| M9 | Media | Con «Editar archivos» un agente ejecuta comandos con tu usuario: desde el móvil se le podría pedir leer cualquier archivo del PC. | **Límite conocido.** Es la función (que el móvil haga trabajar a los agentes). Se reduce el riesgo de un móvil perdido: la vinculación caduca a los **30 días sin uso** (antes 180) y se revoca desde Ajustes → Móvil. El «Acceso total» nunca desde el móvil. |

## Navegador de los agentes y ventanita flotante

| # | Gravedad | Hallazgo | Arreglo |
|---|---|---|---|
| N1 | Alta | `alert()`/`confirm()` de una página aparecían como ventanas en tu escritorio (con el texto que quisiera la página) y bloqueaban al agente hasta pulsar. | **Aplicado.** `disableDialogs`: las páginas de los agentes no pueden abrir diálogos. La prueba de la app usa una página con `alert()`. |
| N2 | Media | Una página colgada (bucle infinito) dejaba la conversación bloqueada 10 minutos gastando CPU. | **Aplicado.** Cada acción tiene 40 s; si no responde, se cierra el proceso de la página y el agente lo sabe. Cerrar nunca espera detrás. |
| N3 | Media | Con 4 páginas abiertas, una quinta cerraba la más antigua aunque otro agente la estuviera usando. | **Aplicado.** Solo se cierra una página sin uso; si todas están en uso, el agente recibe «inténtalo en un rato». |
| N4 | Media | Todas las páginas se dibujaban 8 veces por segundo aunque nadie las viera (≈4 MB por imagen) y la ventanita recodificaba en el hilo principal. | **Aplicado.** Solo se dibuja la página que muestra la ventanita, y solo mientras se ve; máximo 4 imágenes por segundo, al tamaño real de la ventanita y llegando siempre la última. |
| N5 | Media | Si el motor se había caído, cerrar la ventana podía dejar la app viva e invisible (las páginas ocultas son ventanas). | **Aplicado.** Al cerrarse la ventana principal se cierra la app; cambiar de carpeta limpia el navegador antes de reiniciar. |
| N6 | Baja | Cualquier agente con la clave común podía usar la página de otra conversación (o hacerse pasar por el asistente en la ventanita). | **Aplicado.** Cada conversación recibe su **propia clave**, derivada (HMAC) de la secreta de la app con su agente, conversación y tarea; la app la recalcula al conectar. |
| N7 | Baja | Codex recibe su clave en la línea de comandos (visible para otros procesos del mismo usuario). | **Límite conocido**, ahora acotado: esa clave solo sirve para la página de esa conversación (N6). Claude la recibe por su entorno. |
| N8 | Baja | La tubería local no tenía límites (conexiones que no se presentan, peticiones en cola). | **Aplicado.** 5 s para presentarse, 32 conexiones, 8 peticiones pendientes por conexión. |
| N9 | Baja | Un clic del agente en un campo de subir archivo abriría el selector de archivos de Windows. | **Aplicado.** El agente no puede pulsar campos de archivo (ni su etiqueta). Prueba. Queda que una página lo intente sola durante un clic (Chromium lo limita; sin confirmar en Windows real). |

Comprobado y bien: el aislamiento de los scripts (mundo aislado: la página no puede trucar las funciones que usa la app),
la sesión en memoria sin tus datos, `orb://` inaccesible desde las páginas, solo `http(s)`, descargas, permisos,
autenticación HTTP y Bluetooth denegados, y la ventanita solo puede mandar sus tres órdenes.

## Cuentas, instalación y modo experto

| # | Gravedad | Hallazgo | Arreglo |
|---|---|---|---|
| E1 | Alta | En el diff de un archivo, git interpretaba la ruta como patrón: `*`, `.`, `[.]env` o `:(icase).ENV` enseñaban el `.env`. | **Aplicado.** git con `--literal-pathspecs`, y solo se acepta un nombre exacto de la lista de cambios. El diff completo quita las secciones de archivos secretos (también renombrados). Pruebas. |
| E2 | Media | En Windows, nombres como `.env::$DATA`, `.env.` o `ENV~1` y `.GIT` en mayúsculas saltaban los filtros. | **Aplicado.** Se rechazan `:` y los puntos o espacios finales, se resuelve con `realpathSync.native` (nombre real) y las carpetas internas se comparan sin mayúsculas. Pruebas. |
| E3 | Media | git se ejecutaba de forma síncrona dentro del motor, y el modo experto lo relanzaba en cada cambio del tablero. | **Aplicado.** git asíncrono con tiempo límite, sin listar uno a uno los archivos de carpetas no versionadas, y la vista refresca como mucho cada 5 s (más el botón de recargar). |
| E4 | Media | La carpeta de una cuenta podía estar dentro de un proyecto, de la carpeta del asistente o en la red, y `.credentials.json` no contaba como secreto. | **Aplicado.** Se rechazan esas ubicaciones (salvo `.orb/cuentas`, la de por defecto) y `.credentials.json` / `.claude.json` son secretos (nunca se commitean). Pruebas. |
| E5 | Baja | Si se borraba una cuenta, sus conversaciones seguían en silencio con la cuenta principal. | **Aplicado.** Avisa de que la cuenta ya no existe; no se puede quitar una cuenta con una conversación trabajando. |
| E6 | Baja | Un id de cuenta borrado se reutilizaba y heredaba su uso y su pausa. | **Aplicado.** Nunca se repite un id usado. Prueba. |
| E7 | Media | Las consolas (login, instalación) se abrían con `cmd /c start`, que reinterpreta `&`, `^` o `%` de rutas como `D:\I+D&Co`. | **Aplicado.** Se arranca el programa directamente en su propia consola. |
| E8 | Media | El script de instalación se rompía con una carpeta como `Ana’s Orb` (comilla tipográfica) o `[casa]` (comodín). | **Aplicado.** Se duplican todas las comillas que PowerShell entiende y se escribe con `-LiteralPath`. |
| E9 | Baja | El script `.ps1` quedaba en disco unos milisegundos antes de ejecutarse: otro programa podía cambiarlo. | **Aplicado.** Sin archivo: va directo a PowerShell con `-EncodedCommand` (≈7 000 caracteres, muy por debajo del límite). |
| E10 | Baja | Se podían lanzar dos instalaciones a la vez; cerrar la ventana antes de tiempo la dejaba «en marcha» 45 min. | **Aplicado.** Una instalación a la vez y se detecta el cierre de su ventana. |

Comprobado: el móvil no tiene ninguna acción `expert.*`, `installer.*` ni `accounts.*`; los ids del instalador solo salen
de una lista fija; `CLAUDE_CONFIG_DIR` / `CODEX_HOME` nunca se heredan y la cuenta va la última en el entorno.

## Otros cambios de esta ronda

- El nombre del producto está en un solo sitio (`src/core/product.mjs`) y `npm run check` avisa si `package.json` no coincide.
- Todo es responsive (móvil y ventanas desde 400 px); el modo experto solo en pantallas anchas del PC.

## Límites conocidos (además de los de la primera auditoría)

- **M9**: el móvil vinculado manda a los agentes igual que el PC (salvo «Acceso total» y los ajustes). Si pierdes el móvil,
  revócalo en Ajustes → Móvil.
- **N7**: Codex recibe su clave del navegador en la línea de comandos (solo vale para su conversación).
- **Sin probar en Windows real** (el entorno de desarrollo es Linux): el cifrado DPAPI, las consolas de instalación y login,
  `realpathSync.native` con nombres 8.3, la tubería con nombre y las notificaciones. Hay que pasar la app por un Windows
  antes de publicarla.

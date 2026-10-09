## Descargar

- **`Orb.dev-2.3.3-instalador.exe`** (recomendado): se instala para tu usuario, sin permisos de administrador, con acceso
  directo en el escritorio y en el menú Inicio. Después lo encuentras escribiendo «Orb» en el buscador de Windows.
- **`Orb.dev-2.3.3-portable.exe`**: un solo archivo. Doble clic y se abre, sin instalar nada.
- **`Orb.dev-2.3.3-windows.zip`**: lo mismo ya descomprimido (arranca más rápido). Clic derecho → «Extraer todo» y abre `Orb.dev.exe`.

Windows 10/11. Como aún no está firmada, SmartScreen avisa la primera vez: «Más información» → «Ejecutar de todas formas».
En el primer arranque la app detecta qué agentes tienes y con qué sesión, e instala lo que falte con los instaladores oficiales.

## Novedades de la 2.3.3

### Orb estrena aspecto

- **El robot nuevo** está en toda la app: cabeza viva con ojos animados y gestos, y cuatro poses de cuerpo entero
  (saluda, piensa, señala, de pie). Se pone preocupado cuando algo falla y se duerme cuando no hay nada que hacer.
- **Sonidos del robot:** pitidos cortos cuando habla, termina algo o le tocas la cabeza (nunca mientras escribes). Se
  activan, se silencian y se ajusta el volumen en Ajustes.
- **Robot animado:** en Ajustes puedes dejar las animaciones completas o solo las mínimas (parpadea y cambia de cara).
- **Icono nuevo** de la app, sacado del mismo diseño.

### El móvil, sin Tailscale y cifrado de extremo a extremo

- **Por la wifi de casa:** activa «Móvil» en Ajustes, pulsa «Vincular por wifi» y escanea el QR con el móvil conectado a
  la misma wifi. No hay que instalar nada en el móvil.
- **Por Tailscale, también fuera de casa:** si tu Tailscale tiene HTTPS, Orb lo usa solo. Así la web se instala en el
  móvil como una app de verdad.
- **Todo cifrado de extremo a extremo:** al escanear el QR, el móvil crea su propia clave. Desde ese momento todo lo que
  se dicen el móvil y el PC va cifrado: ni la wifi ni nadie por el camino puede leerlo ni cambiarlo. Un QR copiado no
  sirve, y quitar el móvil en Ajustes lo desconecta al momento.
- **Avisos en el móvil:** en el menú del móvil, «Este móvil» → «Avisos en este móvil». Te avisa de las tareas que esperan
  tu aprobación, las terminadas o fallidas y las respuestas de Orb cuando no tienes la app abierta. Necesita la conexión
  segura (Tailscale con HTTPS); en iPhone, con Orb añadido a la pantalla de inicio. Gratis: los envía tu propio PC.
- Los móviles vinculados con la 2.3.2 o antes hay que **volver a vincularlos** (una vez).

## Novedades de la 2.3.2

### Orb se actualiza solo

- Al abrirse y cada 4 horas, Orb mira en GitHub si hay una versión nueva. Si la hay, aparece una tarjeta arriba a la
  derecha: **Actualizar** la descarga en segundo plano y **Reiniciar y actualizar** la instala y vuelve a abrir Orb.
- «Más tarde»: se instala sola la próxima vez que cierres Orb. Si hay tareas trabajando, avisa antes de reiniciar.
- **Registro de cambios** abre las novedades de esa versión.
- En **Ajustes → Actualizaciones** ves la versión instalada y puedes **Buscar actualizaciones** cuando quieras.
- La versión portable no puede cambiarse a sí misma: avisa igual, y su botón abre la página de descarga.
- Funciona a partir de esta versión: la 2.3.1 no tenía el aviso, así que la 2.3.2 se instala a mano una última vez.

## Novedades de la 2.3.1

### La carpeta de Orb, igual para todos

Elijas la carpeta que elijas en el primer arranque, Orb crea dentro `Orb` con la misma estructura:

```
<carpeta elegida>\Orb\
  windows\  ios\  android\  web\   tus proyectos, cada uno en su categoría
  bitacora\                          configuración de Orb: las bitácoras (una sola carpeta)
  mcp-servers\                       configuración de Orb: los servidores MCP
```

- **Proyectos por categoría:** al crear o clonar un proyecto eliges Windows, iOS, Android o Web, y la lista de Proyectos
  sale agrupada así. Las carpetas que crees a mano dentro de una categoría aparecen solas.
- **`bitacora` y `mcp-servers` son de Orb:** no salen como proyectos ni se pueden vincular. Los servidores MCP se gestionan
  solo desde Ajustes, que lista los que hay en la carpeta y los activa con un clic.
- **Android listo:** Orb descarga adb y fastboot de Google en `android\adb-tools` la primera vez y los pone al alcance de
  los agentes. El estado se ve en Ajustes → Android.
- **Una sola carpeta de bitácoras:** si venías de la 2.3.0, `bitacoras` pasa sola a `bitacora` sin perder nada, y las
  categorías y carpetas de configuración que se colaron como proyectos desaparecen de la lista.
- **Instalador:** además del portable, un instalador que deja Orb en el menú Inicio, en el escritorio y en el buscador.

## Novedades de la 2.3.0

La idea de siempre: le cuentas a Orb qué quieres y él escribe encargos optimizados, los reparte entre agentes de varios
proveedores que trabajan a la vez, revisa lo que hacen y te pide el OK. La 2.3 rehace por dentro cómo habla con los agentes.

### Agentes en directo, como T3 Code

- **Un proceso vivo por conversación** en vez de uno por mensaje:
  - Claude Code con el Claude Agent SDK oficial;
  - Codex con `codex app-server`;
  - Cursor con su CLI en streaming.
  - Las respuestas llegan **mientras se escriben** y el segundo mensaje tarda segundos.
- **Más agentes** con el estándar ACP: **Gemini CLI, OpenCode, Qwen Code y GitHub Copilot**.
- **Usa tus sesiones:** si ya iniciaste sesión en el programa de un agente (por ejemplo Codex con ChatGPT), no hay que hacer
  nada más en la app.
- **Corregir en marcha** (Intro mientras trabaja) o **poner en cola** (Ctrl+Intro). La cola se puede editar, reordenar y
  vaciar.
- **Bifurcar** una conversación para probar otra idea sin perder la original.
- **Continuar** lo que quedó a medias, **detalles** de cada conversación (carpeta, git, PR, tarea…), **medidor de contexto**
  y historial por páginas.

### Más trabajo, menos frenos (y sin quemar tokens)

- **Permisos equilibrados:** lo normal pasa solo; lo arriesgado (push, descargar y ejecutar, borrar carpetas…) te lo pregunta
  con una tarjeta **Permitir / Permitir siempre / Denegar**, en la conversación, en el chat, en la bandeja y en el móvil.
  Hay un modo nuevo, «Preguntar antes», para vigilar de cerca.
- **Cupo real:** Claude y Codex dicen cuánto llevas de tu cupo y cuándo se reinicia. Orb para al 92 % (ajustable) y reparte
  el trabajo entre cuentas. Los topes fijos suben a 20 tareas y 6 con modelos caros por ventana, solo como red de seguridad.
- **Tareas que esperan al cupo:** al llegar al límite, la tarea no falla, espera y **sigue sola** al reiniciarse.
- **Continúan tras cerrar la app.**
- **El asistente se renueva según lo lleno que esté su contexto**, no por número de mensajes, y lee el proyecto para escribir
  encargos más precisos y cortos.

### Equipo de agentes

- **Delegación:** un agente puede pasar parte de su tarea a otro agente o modelo y esperar el resultado. Las subtareas
  cuelgan de su tarea.
- **Task Review:** otro modelo, de otro proveedor si lo hay, audita el trabajo en solo lectura y da su veredicto: correcto o
  con fallos, y la lista de problemas. Se pide para una tarea o un proyecto entero, o se activa de forma automática.
- **Tareas programadas:** «cada lunes a las 9, revisa las dependencias».
- **«@»** en cualquier cuadro de mensaje para adjuntar otra tarea, conversación o bitácora como contexto (un extracto, no
  entero).

### Interfaz

- **Bandeja** en la barra lateral: «Te esperan» y «Trabajando».
- Logotipos reales de los agentes.
- Checks visibles en modo noche.
- Sin el robot cortado en el primer arranque.
- Icono nítido en el `.exe` y la barra de tareas.
- **Español de España e inglés.**

### Para desarrolladores

- 79 pruebas que pasan también en Windows y CI de pruebas en Windows y Linux.
- `docs/FUNCIONAMIENTO.md` explica cada funcionalidad y qué archivos tocar.

## Novedades de la 2.1.0

- **Checks e interruptores que no respondían**: el robot flotante tapaba los de la derecha y se llevaba el clic. Ahora no
  sale encima de Ajustes ni de las conversaciones, los interruptores se aplican al momento (antes esperaban a «Guardar»)
  y toda la fila se puede pulsar.
- **Tamaño de la interfaz**: Ajustes → Interfaz (Pequeña / Normal / Grande) o `Ctrl +`, `Ctrl -`, `Ctrl 0` y `Ctrl` +
  rueda. «Normal» es más grande que antes.
- **`Ctrl J` abre una terminal** en la carpeta del proyecto: Warp si lo tienes; si no, Windows Terminal o PowerShell.
- **Menú de carpetas**: cada proyecto es una carpeta plegable con las tareas que le has mandado.
- **Tareas en directo**: tiempo, pasos, qué hace ahora y el porcentaje, en Tareas y encima del chat. Aviso si una tarea
  lleva 10 minutos sin dar señales.
- **Fallos explicados**: si un agente no puede trabajar (por ejemplo Cursor con el plan gratuito, o sin sesión), la tarea
  dice por qué y qué hacer, y si era para «cualquier agente» pasa a otro.
- La carpeta del asistente se llama como le pongas (o «Orb»), y la pantalla inicial enseña exactamente esa ruta.
- Limpieza: fuera cualquier resto del nombre antiguo; auditoría de seguridad sin datos privados ni claves en el código.

## Descargar

- **`Orb.dev-2.1.0-portable.exe`**: un solo archivo. Doble clic y se abre, sin instalar nada.
- **`Orb.dev-2.1.0-windows.zip`**: lo mismo ya descomprimido (arranca más rápido). Clic derecho → «Extraer todo» y abre `Orb.dev.exe`.

Windows 10/11. Como aún no está firmada, SmartScreen avisa la primera vez: «Más información» → «Ejecutar de todas formas».
En el primer arranque la app instala lo que falte (Claude Code, Codex, Cursor) con sus instaladores oficiales.

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

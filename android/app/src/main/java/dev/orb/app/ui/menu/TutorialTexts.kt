package dev.orb.app.ui.menu

/**
 * The texts of «Tutoriales», taken from the desktop app (help.* of the Spanish locale) and kept on the phone so the
 * screen works without a connection. {name} stands for the assistant's name. The tutorials about what only the PC has
 * (agents, usage, expert mode, games, themes), the keyboard shortcuts and the guided tour are left out, as the
 * desktop app does on its phone layout.
 */
object TutorialTexts {
    private const val NAME = "{name}"

    /** A text with the assistant's name put in. */
    fun named(text: String): String = text.replace(NAME, dev.orb.app.ui.chats.ChatTexts.ORBE)

    class Tutorial(val id: String, val title: String, val lines: List<String>)

    class Faq(val question: String, val answer: String)

    val TUTORIALS: List<Tutorial> = listOf(
        Tutorial(
            "start", "Primeros pasos",
            listOf(
                "Orb trabaja en su carpeta (por defecto, C:\\Orb), organizada en seis categorías: windows, linux, ios, android, web y multi.",
                "Cada carpeta de una categoría es un proyecto. Las que crees en el Explorador aparecen automáticamente.",
                "core es la carpeta interna de Orb (oculta) y no se puede usar como proyecto.",
                "Crea tu primer proyecto desde el selector de proyecto del chat o en Proyectos: nuevo, vincular una carpeta o clonar un repositorio.",
                "Un proyecto multiplataforma vive en multi: un solo repositorio con una carpeta por plataforma y «compartido» para lo común.",
            ),
        ),
        Tutorial(
            "chat", "El chat con {name}",
            listOf(
                "Con «Orquestador» activado hablas con {name}: planifica el trabajo, escribe las instrucciones para cada agente y las reparte. Puede leer el proyecto, pero no lo modifica.",
                "Con «Orquestador» desactivado hablas directamente con el agente que elijas (Claude, Codex, Cursor…), que trabaja en la carpeta del proyecto. Pide permiso para lo arriesgado y nunca hace push ni publica.",
                "Si escribes mientras responde, recibe la corrección en su siguiente paso. «Detener» corta la respuesta al momento.",
                "Escribe @ para adjuntar como contexto un extracto de una tarea, una conversación o una bitácora.",
            ),
        ),
        Tutorial(
            "brain", "Elegir el cerebro",
            listOf(
                "Bajo el cuadro de mensaje eliges el agente (Claude, Codex, Gemini…) y su modelo. «Recomendados» reúne los más habituales.",
                "El razonamiento (bajo, medio o alto) define cuánto piensa {name} en cada respuesta. El alto gasta bastante más uso. El de cada tarea lo elige Orb según su dificultad (Ajustes › Agentes y uso).",
                "El aviso «Cuidado» aparece cuando la elección puede agotar el uso de la cuenta: razonamiento alto, un modelo de alto consumo o una cuenta por encima del 75 %.",
                "Con la elección automática activada, Orb asigna a cada tarea el modelo adecuado según su dificultad: rápido para lo sencillo y potente solo cuando hace falta.",
                "Cambiar de agente inicia una conversación nueva. Las tareas y las bitácoras se conservan.",
            ),
        ),
        Tutorial(
            "newchat", "Conversaciones",
            listOf(
                "«Nuevo chat» abre una conversación propia, con su título y su proyecto. El proyecto, el cerebro y el razonamiento se eligen en el cuadro de mensaje.",
                "Con «Orquestador» hablas con {name}, que reparte el trabajo en tareas; sin él, hablas directamente con el agente y el modelo que elijas. Puedes tener varias conversaciones a la vez.",
                "Todas tus conversaciones están en el menú, en «Conversaciones» y dentro de cada proyecto. Pulsa una para volver a ella.",
                "En la conversación de una tarea ves la respuesta en directo, los comandos y los archivos modificados.",
            ),
        ),
        Tutorial(
            "tasks", "Tareas",
            listOf(
                "Cada tarea es una instrucción para un agente. Puede estar en cola, pendiente de aprobación, en curso, completada, fallida, bloqueada, cancelada o esperando a que se reinicie el uso.",
                "Las acciones delicadas esperan tu aprobación: publicar, credenciales, pagos y tareas creadas por un agente. Borrar archivos también, salvo que lo pidas tú nombrando esos archivos en tu mensaje. Si la tarea cambia, se vuelve a pedir.",
                "Al terminar un pedido, {name} revisa las tareas y te entrega un informe con «OK» y «Pedir cambios». «Deshacer esta tarea» restaura sus archivos sin tocar tus cambios posteriores.",
                "Task Review: otro modelo, de otro proveedor si es posible, audita el trabajo en solo lectura. Pídelo desde una tarea o un proyecto, o actívalo en Ajustes › Agentes y uso.",
                "Si cierras Orb, las tareas en curso continúan al volver a abrirlo. Si una cuenta llega a su límite de uso, la tarea espera y se reanuda sola.",
                "Security Review: desde un proyecto, un agente busca vulnerabilidades y secretos expuestos sin tocar nada, y entrega los hallazgos por gravedad.",
            ),
        ),
        Tutorial(
            "sidebar", "Proyectos en el menú",
            listOf(
                "Cada proyecto del menú es una carpeta. Un clic lo selecciona para un nuevo chat; doble clic (o la flecha) muestra sus tareas y conversaciones.",
                "Pasa el ratón por una tarea o conversación y pulsa su círculo para moverla a «Completados». Desde ahí se restaura con un clic.",
                "Arriba está la bandeja: «Por aprobar», «En curso» e «Incidencias» (límite de uso, interrumpidas o con error).",
                "Arrastra el borde del menú para cambiar su ancho (doble clic para restablecerlo). El botón junto a Claro / Oscuro lo pliega.",
            ),
        ),
        Tutorial(
            "board", "Pizarra",
            listOf(
                "Cada proyecto tiene su pizarra para dibujar esquemas, escribir ideas y adjuntar capturas, documentos o referencias.",
                "{name} la consulta al planificar el trabajo del proyecto. Para pedidos complejos, te sugerirá definirlos primero en la pizarra.",
                "Se guarda automáticamente en la carpeta pizarra del proyecto y no se sube a git.",
            ),
        ),
        Tutorial(
            "schedules", "Tareas programadas",
            listOf(
                "Repite una tarea automáticamente: cada hora, cada N horas, a diario o ciertos días de la semana.",
                "Cada ejecución es una tarea normal, con las mismas aprobaciones y el mismo límite de uso. Si la anterior sigue abierta, espera: nunca se acumulan.",
                "Las que propone {name} requieren tu aprobación una vez.",
            ),
        ),
        Tutorial(
            "logs", "Memorias y Actividad",
            listOf(
                "Las bitácoras son la memoria de {name}: una general y una por proyecto, en la carpeta bitacora. Solo se añaden entradas y los secretos se ocultan.",
                "{name} y el planificador las actualizan al cerrar cada tarea, así cada conversación nueva sabe qué se hizo antes.",
                "Actividad registra cada acción del tablero (quién, qué y cuándo), con buscador.",
            ),
        ),
        Tutorial(
            "phone", "Magic Link",
            listOf(
                "En Ajustes › Magic Link, activa el acceso y escanea el QR: con la app de Orb para Android (por tu wifi o por Tailscale, también fuera de casa) o con el navegador del móvil, por Tailscale con HTTPS. Después escribe tu contraseña maestra en el móvil.",
                "La conexión está cifrada de extremo a extremo y la contraseña no sale del móvil. Cada QR sirve una sola vez y, si cierras la sesión de un móvil en Magic Link, se desconecta al instante.",
                "Desde el móvil puedes chatear, aprobar y seguir las tareas. Los ajustes, las cuentas, las instalaciones y el acceso a archivos quedan reservados al PC.",
            ),
        ),
        Tutorial(
            "privacy", "Privacidad y seguridad",
            listOf(
                "Orb no usa servidores en la nube: todo funciona en tu PC. Solo salen a internet los agentes, con sus propias cuentas, y el acceso del móvil si lo activas.",
                "El inicio de sesión lo gestiona el programa oficial de cada agente: Orb nunca ve tus contraseñas. Las claves de los conectores se guardan cifradas con tu contraseña maestra y los agentes no las ven.",
                "Las acciones de riesgo (push, publicar, descargar y ejecutar, eliminar carpetas, cambios en el sistema) se confirman con Permitir / Permitir siempre / Denegar. Los agentes nunca publican por su cuenta.",
                "Los agentes no pueden acceder a los datos internos de Orb (core). Cada uno se identifica con una firma propia, así que no puede suplantar a otro ni cerrar tareas ajenas.",
                "Lo que devuelven los agentes se trata como datos, nunca como órdenes. Las bitácoras ocultan los secretos.",
            ),
        ),
    )

    val FAQS: List<Faq> = listOf(
        Faq(
            "¿Necesito una cuenta de pago?",
            "Necesitas una cuenta propia de al menos un agente (Claude Code, Codex, Cursor, Gemini CLI…). Orb usa su programa oficial y tu sesión, sin costes adicionales.",
        ),
        Faq(
            "¿Dónde se guardan mis datos?",
            "En la carpeta de Orb (por defecto, C:\\Orb): los proyectos por categoría y, en core (oculta), los ajustes, las bitácoras, la base de datos y las copias para deshacer. Las copias de seguridad van fuera de esa carpeta (en Ajustes › Datos se ve dónde). Nada se sube a la nube.",
        ),
        Faq(
            "¿Qué cambia al activar o desactivar el «Orquestador»?",
            "Con «Orquestador», {name} solo coordina: lee el proyecto y reparte instrucciones entre los agentes, que hacen el trabajo. Sin él, hablas directamente con el agente que elijas, que edita y ejecuta en la carpeta del proyecto, pide permiso para lo arriesgado y nunca hace push ni publica.",
        ),
        Faq(
            "¿Por qué una tarea está pendiente de aprobación?",
            "Porque incluye algo delicado (publicar, credenciales, pagos o borrar archivos que no nombraste en tu mensaje) o la creó un agente sin delegación de confianza. Apruébala o recházala en Tareas o desde la bandeja del menú.",
        ),
        Faq(
            "¿Qué pasa si se llega al límite de uso?",
            "La tarea no falla: queda «Esperando uso» con la hora de reinicio y se reanuda sola. Mientras tanto, el trabajo nuevo pasa a otras cuentas con uso disponible. El límite (92 % por defecto) se ajusta en Ajustes › Agentes y uso.",
        ),
        Faq(
            "¿Puedo deshacer lo que hizo un agente?",
            "Sí. «Deshacer esta tarea», en el detalle de la tarea, restaura solo los archivos que cambió esa tarea y conserva tus cambios posteriores. Si trabajó en una copia aislada, puedes descartar su rama.",
        ),
        Faq(
            "¿Qué es una copia aislada?",
            "Al crear una tarea eliges dónde trabaja: en la carpeta del proyecto (con una instantánea previa para poder deshacer) o en una copia aislada con su propia rama de git, que luego puedes integrar, convertir en pull request o descartar.",
        ),
        Faq(
            "¿Puedo cambiar el nombre del asistente o el idioma?",
            "Sí, en Ajustes › General. El nombre se aplica en toda la app y el idioma (español o inglés) cambia al instante.",
        ),
        Faq(
            "¿Cómo publico un proyecto en GitHub?",
            "Desde Proyectos, con GitHub CLI (gh) y la sesión iniciada: publicar el repositorio, subir ramas, integrar y crear pull requests. Los push de los agentes siempre requieren tu aprobación.",
        ),
        Faq(
            "¿Por qué no veo el robot?",
            "El tema Profesional no muestra el robot ni animaciones; cámbialo en Ajustes › General. El robot flotante se activa o desactiva en Ajustes › General.",
        ),
        Faq(
            "¿Cómo se actualiza Orb?",
            "La versión instalada busca actualizaciones al abrirse y cada 4 horas. «Descargar e instalar» descarga la nueva versión y «Reiniciar e instalar» la instala. También puedes buscarlas en Ajustes › General.",
        ),
        Faq(
            "Una tarea de Cursor falla por «plan sin acceso». ¿Qué hago?",
            "El plan gratuito de Cursor no permite usar su agente desde otras aplicaciones. Orb pausa Cursor un día y, si la tarea era para «cualquier agente», la asigna a otro. Con un plan de pago funciona con normalidad.",
        ),
        Faq(
            "¿Cómo envío comentarios o apoyo el proyecto?",
            "En Ajustes › Acerca de puedes enviar comentarios con capturas, sin necesidad de cuenta, y apoyar el proyecto a través de PayPal.",
        ),
        Faq(
            "¿Cómo repito el tutorial guiado?",
            "Con el botón «Repetir el tutorial guiado», en la parte superior de esta pantalla. Puedes salir en cualquier momento con «Saltar tutorial» o Esc.",
        ),
        Faq(
            "¿Dónde están mis conversaciones?",
            "En el menú, en «Conversaciones», y dentro de cada proyecto. Pulsa una para volver a ella. «Nuevo chat» empieza otra, con su propio título y proyecto.",
        ),
        Faq(
            "¿Qué es «Iniciar test»?",
            "Una prueba de funcionamiento: {name}, con el Orquestador activado, pide a varios modelos una web de prueba y la abre. Aparece en el chat la primera vez que abres Orb cada día y siempre está en Ajustes › Agentes y uso.",
        ),
        Faq(
            "¿Qué hago si olvido la contraseña maestra?",
            "Pulsa «He olvidado la contraseña» en Ajustes › Datos o en la pantalla que te la pide. Con el código de recuperación de tus copias de seguridad pones otra y conservas las claves de tus conectores. Sin él, puedes empezar de cero: se borran esas claves y tendrás que volver a enlazar tus móviles; tus proyectos y conversaciones no se tocan.",
        ),
    )
}

package dev.orb.app.ui.menu

/**
 * The texts of «Tutoriales», kept on the phone so the screen works without a connection. They follow the desktop app's
 * guides (help.* of the Spanish locale), worded for what the phone really shows. {name} stands for the assistant's name.
 * What only the PC has (agents, accounts, usage, tabs, separate copies, dictation, expert mode, games, themes, reset),
 * the keyboard shortcuts and the guided tour are left out, as the desktop app does on its phone layout.
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
                "Orb guarda tus proyectos en su carpeta del PC, por defecto C:\\Orb, ordenados en seis categorías: windows, linux, ios, android, web y multi.",
                "Cada carpeta de una categoría es un proyecto. Las que crees en el Explorador aparecen solas.",
                "core es la carpeta interna de Orb. Está oculta y no sirve como proyecto.",
                "Crea tu primer proyecto desde el chat o desde Proyectos: nuevo, vincular una carpeta o clonar un repositorio.",
                "Un proyecto para varias plataformas vive en multi: un repositorio con una carpeta por plataforma y «compartido» para lo común.",
            ),
        ),
        Tutorial(
            "chat", "Chat con {name}",
            listOf(
                "Con {name} hablas con quien planifica el trabajo: lo divide en tareas, escribe las instrucciones de cada agente y las reparte. Lee el proyecto, pero no lo modifica.",
                "Con «Directo con un agente» hablas con el agente que elijas, como Claude, Codex o Cursor. Trabaja en la carpeta del proyecto, pide permiso para lo arriesgado y nunca hace push ni publica.",
                "Si escribes mientras responde, el agente recibe tu corrección en su siguiente paso.",
                "Escribe @ para adjuntar como contexto un extracto de una tarea, un chat o una bitácora.",
            ),
        ),
        Tutorial(
            "brain", "Agente y modelo",
            listOf(
                "Al empezar un chat directo eliges el agente y su modelo. «Recomendado» reúne los más habituales y «El que usa el PC» deja la elección al PC.",
                "Con la elección automática de modelo, Orb asigna a cada tarea el modelo que le corresponde: rápido para lo sencillo y potente solo cuando hace falta. Se activa en el PC, en Ajustes › Agentes y cuentas.",
                "La cuenta la elige el PC. Si una cuenta llega a su límite de uso, el trabajo nuevo pasa a otra cuenta del mismo agente.",
            ),
        ),
        Tutorial(
            "reasoning", "Razonamiento",
            listOf(
                "El razonamiento marca cuánto piensa el agente antes de responder. Lo eliges al empezar un chat directo.",
                "Hay hasta seis niveles, de mínimo a máximo. Cada agente y cada modelo ofrece los suyos.",
                "Mínimo y bajo sirven para preguntas rápidas y cambios pequeños. Medio es el trabajo habitual. Alto y los siguientes son para problemas difíciles y revisiones a fondo.",
                "Cuanto más alto, más cuidada es la respuesta y más uso gasta.",
            ),
        ),
        Tutorial(
            "orchestrator", "Con {name} o directo",
            listOf(
                "Al crear un chat eliges cómo trabajar: «Con {name}», que lo divide en tareas y elige agentes, o «Directo con un agente», que trabaja en una carpeta.",
                "El modo se decide al crear el chat. Para cambiarlo, empieza un chat nuevo.",
                "Para coordinar, {name} necesita Claude o Codex en el PC. Cursor solo funciona en chats directos.",
                "Puedes tener tantos chats directos a la vez como quieras.",
            ),
        ),
        Tutorial(
            "newchat", "Tus chats",
            listOf(
                "«Nuevo chat» te deja elegir el proyecto, cómo trabajar y, en un chat directo, el agente. El chat se crea en el PC al enviar el primer mensaje.",
                "Necesitas conexión con el PC para empezar un chat.",
                "Todos tus chats están en Chats. Pulsa uno para volver a él.",
                "En el chat de una tarea ves la respuesta en directo, los comandos y los archivos modificados.",
            ),
        ),
        Tutorial(
            "tasks", "Tareas",
            listOf(
                "Cada tarea es una instrucción para un agente. Puede estar en cola, por aprobar, en curso, completada, fallida, bloqueada, cancelada o esperando uso.",
                "Las acciones delicadas esperan tu aprobación: publicar, escribir fuera del proyecto, usar credenciales, pagos, borrar datos y las tareas que crea un agente. Borrar archivos que nombras en tu mensaje no la pide. Si la tarea cambia, vuelve a pedirla.",
                "Al terminar un pedido, {name} revisa las tareas y te entrega un informe con «OK» y «Pedir cambios». «Deshacer esta tarea» restaura sus archivos sin tocar tus cambios posteriores.",
                "Task Review: otro modelo, si es posible de otro proveedor, audita el trabajo sin modificarlo y da su veredicto. Lo pides desde una tarea o un proyecto, o lo activas en el PC, en Ajustes › Agentes y cuentas.",
                "Si cierras Orb en el PC, las tareas en curso siguen al abrirlo de nuevo. Si una cuenta llega a su límite de uso, la tarea espera y se reanuda sola.",
                "Security Review: desde un proyecto, un agente busca vulnerabilidades y secretos expuestos sin tocar nada, y entrega los hallazgos por gravedad.",
            ),
        ),
        Tutorial(
            "menu", "Menú",
            listOf(
                "El menú de Chats abre los sitios de Orb: Chats, Tareas, Proyectos, Programadas, Pizarra, Memorias y actividad, Uso y agentes, Juegos, Tutoriales y Este móvil.",
                "Desde el menú también cambias entre modo claro y oscuro.",
                "El menú indica si el móvil está conectado a tu PC. Sin conexión, Orb muestra lo último guardado.",
            ),
        ),
        Tutorial(
            "board", "Pizarra",
            listOf(
                "Cada proyecto tiene su pizarra para dibujar esquemas, escribir ideas y adjuntar fotos, vídeos, documentos o referencias.",
                "{name} la consulta al planificar el trabajo del proyecto. En los pedidos complejos te sugerirá definirlos primero en la pizarra.",
                "Se guarda sola en la carpeta pizarra del proyecto y no se sube a Git.",
            ),
        ),
        Tutorial(
            "schedules", "Tareas programadas",
            listOf(
                "Repite una tarea sola: cada hora, cada N horas, cada día, cada semana, cada mes o una sola vez. Eliges la hora y los días.",
                "Cada ejecución es una tarea normal, con las mismas aprobaciones y el mismo límite de uso. Si la anterior sigue abierta, espera: nunca se acumulan.",
                "Las que propone {name} necesitan tu aprobación una vez.",
                "Al terminar, bien o mal, puede llegar un aviso a tu móvil. Se apaga en cada tarea programada, en el PC.",
            ),
        ),
        Tutorial(
            "logs", "Memorias y actividad",
            listOf(
                "Memorias y actividad reúne lo que Orb anota, en dos pestañas: Actividad y Bitácoras.",
                "En Bitácoras, una general y una por proyecto cuentan día a día lo que han hecho tus agentes. Son de solo lectura, privadas y ocultan tus claves.",
                "Actividad muestra cada acción en orden: quién la hizo, qué pasó y cuándo.",
                "Las normas de Orb y de tus agentes están en el PC, en Bitácoras › Normas.",
            ),
        ),
        Tutorial(
            "phone", "Enlazar el móvil",
            listOf(
                "En el PC, abre Ajustes › Dispositivos, activa el acceso y pulsa «Mostrar código QR».",
                "En el móvil, pulsa «Escanear el código QR». Si no tienes cámara, usa «Usar código corto» o pega el enlace del QR.",
                "Por wifi, el móvil y el PC deben estar en la misma red. Con Tailscale funciona desde cualquier red: instálalo en los dos con la misma cuenta y usa «Buscar mi PC en Tailscale».",
                "Después escribe la contraseña maestra del PC. Con un código corto no hace falta: confirmas el enlace en el PC.",
                "Comprueba que la huella que ves en el móvil coincide con la del PC. Si no coincide, no enlaces.",
                "El QR caduca a los 5 minutos y sirve una vez. La conexión va cifrada de extremo a extremo y la contraseña no sale del móvil.",
                "Desde el móvil puedes chatear, aprobar y seguir las tareas. Los ajustes, las cuentas, las instalaciones y los archivos son solo del PC.",
            ),
        ),
        Tutorial(
            "thisphone", "Este móvil",
            listOf(
                "Este móvil, en el menú, reúne el enlace con el PC, los avisos, la apariencia y la seguridad.",
                "Los avisos te llegan con la app cerrada: mensajes nuevos y tareas que esperan tu OK. Con «Mantener conectado» te llegan aunque cierres la app.",
                "Con tu huella o tu cara, este móvil puede aprobar acciones delicadas del PC, si lo permites en el PC, en Ajustes › Dispositivos.",
                "El bloqueo de la app pide tu huella, tu cara o el PIN del móvil al abrirla. Lo activas en Este móvil › Bloqueo de la app y eliges si pide al salir, a los 5 o a los 15 minutos.",
                "Si el móvil pierde su PIN y su huella, el bloqueo se desactiva solo.",
            ),
        ),
        Tutorial(
            "privacy", "Privacidad y seguridad",
            listOf(
                "Orb no usa servidores en la nube: todo funciona en tu PC. Solo salen a internet los agentes, con sus propias cuentas, y el acceso del móvil si lo activas.",
                "Cada agente gestiona su inicio de sesión y Orb nunca ve tus contraseñas. Las claves de los conectores se guardan cifradas con tu contraseña maestra y los agentes no las ven.",
                "Las acciones de riesgo, como push, publicar, descargar y ejecutar, eliminar carpetas o cambiar el sistema, piden confirmación con Permitir, Siempre o Denegar. Los agentes nunca publican por su cuenta.",
                "Los agentes no pueden acceder a los datos internos de Orb ni a los elementos protegidos del PC. Tampoco pueden hacerse pasar por otro agente ni cerrar tareas ajenas.",
                "Lo que devuelven los agentes se trata como datos, nunca como órdenes. Las bitácoras ocultan tus claves.",
                "Las protecciones fijas no se pueden desactivar. Las ves en el PC, en Bitácoras › Normas.",
            ),
        ),
    )

    val FAQS: List<Faq> = listOf(
        Faq(
            "¿Necesito una cuenta de pago?",
            "Necesitas una cuenta propia de al menos un agente, como Claude Code, Codex, Cursor o Gemini CLI. Orb usa su programa oficial y tu sesión, sin costes adicionales.",
        ),
        Faq(
            "¿Dónde se guardan mis datos?",
            "En la carpeta de Orb del PC, por defecto C:\\Orb. Ahí están los proyectos por categoría y, en core, que está oculta, los ajustes, las bitácoras, la base de datos y los puntos para deshacer. Las copias de seguridad van fuera de esa carpeta: Ajustes › Datos, en el PC, indica dónde. Nada se sube a la nube.",
        ),
        Faq(
            "¿Qué cambia entre chatear con {name} y hablar directo con un agente?",
            "Con {name}, solo coordina: lee el proyecto y reparte instrucciones entre los agentes, que hacen el trabajo. En un chat directo hablas con el agente que elijas, que edita y ejecuta en la carpeta del proyecto, pide permiso para lo arriesgado y nunca hace push ni publica. El modo se fija al crear el chat.",
        ),
        Faq(
            "¿Por qué una tarea está pendiente de aprobación?",
            "Porque incluye algo delicado, como publicar, usar credenciales, pagos o borrar archivos que no nombraste, o porque la creó un agente sin delegación de confianza. Apruébala o recházala en Tareas.",
        ),
        Faq(
            "¿Qué pasa si se llega al límite de uso?",
            "La tarea no falla: queda en «Esperando uso» con la hora de reinicio y se reanuda sola. Mientras tanto, el trabajo nuevo pasa a otras cuentas con uso disponible. El límite, por defecto el 92 %, se ajusta en el PC, en Ajustes › Agentes y cuentas.",
        ),
        Faq(
            "¿Puedo deshacer lo que hizo un agente?",
            "Sí. «Deshacer esta tarea», en el detalle de la tarea, restaura solo los archivos que cambió y conserva tus cambios posteriores. Si el trabajo se hizo en una copia aparte, también puedes descartarla desde el PC.",
        ),
        Faq(
            "¿Qué es una copia aparte?",
            "Es una copia del proyecto, con su propia rama de Git, donde un agente trabaja sin tocar tu carpeta. Se elige en el PC al empezar un chat o a mitad de chat. Después la unes a tu carpeta o la descartas y, en una tarea, también puedes convertirla en pull request.",
        ),
        Faq(
            "¿Puedo cambiar el nombre del asistente o el idioma?",
            "Sí, en el PC, en Ajustes › General. El nombre se aplica en toda la app y el idioma, español o inglés, cambia al instante.",
        ),
        Faq(
            "¿Cómo publico un proyecto en GitHub?",
            "Desde Proyectos, en el PC, con GitHub CLI y la sesión iniciada: publicar el repositorio, subir ramas, integrar y crear pull requests. Los push de los agentes siempre requieren tu aprobación.",
        ),
        Faq(
            "¿Por qué no veo el robot?",
            "El robot sale con el tema Orb del PC. Los demás temas no lo muestran. Cambia el tema en el PC, en Ajustes › Apariencia, donde también activas o desactivas el robot flotante.",
        ),
        Faq(
            "¿Cómo se actualiza Orb?",
            "Orb en el PC busca actualizaciones al abrirse y cada 4 horas. «Descargar e instalar» baja la nueva versión y «Reiniciar e instalar» la instala. También puedes buscarlas en Ajustes › General.",
        ),
        Faq(
            "Una tarea de Cursor falla por «plan sin acceso». ¿Qué hago?",
            "El plan gratuito de Cursor no permite usar su agente desde otras aplicaciones. Orb pausa Cursor un día y, si la tarea era para cualquier agente, la pasa a otro. Con un plan de pago funciona con normalidad.",
        ),
        Faq(
            "¿Cómo envío comentarios o apoyo el proyecto?",
            "En el PC, en Ajustes › Acerca de, o con el icono del bicho al pie del menú lateral, envías comentarios con capturas, sin necesidad de cuenta. En Acerca de también puedes apoyar el proyecto con PayPal.",
        ),
        Faq(
            "¿Dónde están mis chats?",
            "En Chats. Pulsa uno para volver a él. «Nuevo chat» empieza otro, con su propio proyecto.",
        ),
        Faq(
            "¿Qué es «Iniciar test»?",
            "Una prueba de funcionamiento: {name}, con el Orquestador activado, pide a varios modelos una web de prueba y la abre. Aparece en el chat del PC la primera vez que abres Orb cada día y siempre está en Ajustes › Agentes y cuentas.",
        ),
        Faq(
            "¿Qué hago si olvido la contraseña maestra?",
            "En el PC, pulsa «He olvidado la contraseña» en Ajustes › Permisos y seguridad o en la pantalla que te la pide. Con el código de recuperación de tus copias de seguridad pones otra y conservas las claves de tus conectores. Sin él, puedes empezar de cero: se borran esas claves y tendrás que volver a enlazar tus móviles. Tus proyectos y chats no se tocan.",
        ),
    )
}

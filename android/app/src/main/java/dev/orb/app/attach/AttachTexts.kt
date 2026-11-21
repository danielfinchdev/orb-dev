package dev.orb.app.attach

/** Texts of attachments and of «Compartir con Orb». */
object AttachTexts {
    const val ADD = "Adjuntar"
    const val SHEET_TITLE = "Adjuntar"
    const val CAMERA = "Cámara"
    const val GALLERY = "Galería"
    const val FILE = "Archivo"
    const val CAMERA_META = "Cámara del sistema"
    const val GALLERY_META = "Selector del sistema"
    const val REMOVE = "Quitar adjunto"
    const val REMOVE_ONE = "Quitar"
    const val OPTIONS = "Opciones del adjunto"
    const val ENCRYPT_HINT = "Cada archivo se cifra y sube al PC con su barra de progreso."
    const val PREPARING = "Preparando…"
    const val UPLOADING = "Cifrando y subiendo…"
    const val RETRY = "Reintentar"
    const val UPLOAD_FAILED = "No se pudo subir"
    const val TOO_BIG = "Es demasiado grande"
    const val UNREADABLE = "No se pudo leer"
    const val CAMERA_FAILED = "No se pudo usar la cámara"
    const val UNREADABLE_PICKER = "No se pudo abrir el selector"
    const val WAIT_UPLOADS = "Espera a que terminen de subirse los adjuntos."
    const val NOT_ACCEPTED = "Este PC no admite ese tipo de archivo."
    const val TOO_MANY = "Máximo 6 adjuntos por mensaje."

    fun tooBigMb(mb: Long) = "Es demasiado grande (máximo $mb MB)."

    // Share
    const val SHARE_TITLE = "Compartir con Orb"
    const val SHARE_TO = "Enviar a"
    const val SHARE_NEW_ORBE = "Nuevo chat"
    const val SHARE_RECENT = "Chats recientes"
    const val SHARE_PROJECTS = "Proyectos"
    const val SHARE_TEXT_HINT = "Escribe qué quieres hacer con esto"
    const val SHARE_SEND = "Enviar a Orb"
    const val SHARE_CANCEL = "Cancelar"
    const val SHARE_CLOSE = "Descartar"
    const val SHARE_EMPTY = "No hay nada que compartir que Orb pueda abrir."
    const val SHARE_WAITING = "Hay contenido compartido esperando. Enlaza con tu PC para enviarlo."
    const val SHARE_SKIPPED = "Se dejaron fuera archivos que Orb no admite o que son demasiado grandes."
    const val SHARE_CUT = "El texto era muy largo y se ha recortado."
    const val SHARE_NEEDS_TEXT = "Escribe un mensaje para enviarlo."
    const val SHARE_ASSISTANT_NO_FILES = "El asistente aún no recibe adjuntos: elige un chat de agente."
    const val SHARE_FAILED = "No se pudo enviar"
    /** Pre-filled when only a picture or file is shared: the PC does not take an empty message. */
    const val SHARE_DEFAULT_TEXT = "Adjunto compartido desde el móvil"
}

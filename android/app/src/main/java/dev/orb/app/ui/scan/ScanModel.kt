package dev.orb.app.ui.scan

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import dev.orb.app.link.payload.LinkErrors
import dev.orb.app.link.payload.LinkPayloadException
import dev.orb.app.link.payload.parseLinkPayload
import dev.orb.app.ui.payloadErrorText
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/** The camera as the scanner needs it: Android's permission and the system settings, nothing of the picture itself. */
interface CameraAccess {
    /** The Activity that shows the scanner now, or null when it goes away; accesses that need none ignore it. */
    fun attach(current: android.app.Activity?) {}

    val hasCamera: Boolean
    fun granted(): Boolean

    /** True while Android would still show its dialog after a refusal; false once it will not ask again. */
    fun canExplain(): Boolean

    /** The system settings page of this app, where the permission can be given back. */
    fun openSettings()
}

enum class ScanPermission {
    /** Not answered yet: the phrase is shown and Android's dialog is about to appear or is open. */
    Asking,
    Granted,

    /** Refused; the person can ask again with the button. */
    Denied,

    /** Refused for good: only the system settings can give it back. */
    Blocked,
}

data class ScanUiState(
    val permission: ScanPermission = ScanPermission.Asking,
    val hasFlash: Boolean = false,
    val torch: Boolean = false,
    // One line about what the camera saw and refused; it goes away by itself.
    val hint: String? = null,
    // The text of the Orb link that was read: set once, the screen then leaves.
    val found: String? = null,
)

object ScanTexts {
    const val TITLE = "Escáner"
    const val HEADING = "Escanea el QR de tu Orb"
    const val EXPIRES = "Caduca a los 5 minutos y sirve una vez."
    const val TORCH_ON = "Linterna encendida. "
    const val READ_TITLE = "QR leído"
    const val READ_NOTE = "Vibración corta y paso a la huella."
    const val VALID = "Código QR válido"
    const val NOT_ORB = "Ese código no es de Orb."
    const val NEED_TITLE = "Necesito la cámara"
    const val NEED_NOTE = "Orb solo la usa para leer el QR de tu PC. La imagen no sale del móvil."
    const val WAITING = "Esperando tu permiso de cámara"
    const val DENIED = "Permiso de cámara denegado"
    const val PASTE = "Pegar el enlace del QR"
    const val TYPE_CODE = "Escribir el código a mano"
    const val GIVE = "Dar permiso de cámara"
    const val SETTINGS = "Abrir los ajustes"
    const val BACK = "Atrás"
    const val TORCH = "Linterna"
}

/** What the person is told when a code was read but is not a usable Orb link. */
fun scanHint(key: String): String = when (key) {
    LinkErrors.OLD_QR, LinkErrors.INSECURE -> payloadErrorText(key)
    else -> ScanTexts.NOT_ORB
}

/** The scan button of the welcome page: the scanner when the phone has a camera, the short-code sheet when it has none. */
fun openScanner(hasCamera: Boolean, scanner: () -> Unit, shortCode: () -> Unit) = if (hasCamera) scanner() else shortCode()

private const val MAX_QR_CHARS = 4096

// Android answers a request it will not show at once; a person needs far longer than this to read and tap the dialog.
private const val NO_DIALOG_NANOS = 300_000_000L

/**
 * What the scanner screen knows: the camera permission, the torch and what was read. Whatever a QR holds only goes through
 * [parseLinkPayload]; it is never opened, followed or kept.
 */
class ScanViewModel(
    private val access: CameraAccess,
    private val clock: () -> Long = { System.nanoTime() },
) : ViewModel() {
    private val _state = MutableStateFlow(ScanUiState(permission = if (access.granted()) ScanPermission.Granted else ScanPermission.Asking))
    val state: StateFlow<ScanUiState> = _state.asStateFlow()

    /** Hands the current Activity to the access this view model keeps, which outlives the Activity that created it. */
    fun attachActivity(current: android.app.Activity?) = access.attach(current)

    private var requested = false
    private var askedAt: Long? = null
    private var denials = 0
    private var lastText: String? = null

    /** True exactly once, on opening, when Android's dialog still has to be shown: the scanner never asks again by itself. */
    @Synchronized
    fun takeRequest(): Boolean {
        if (requested || _state.value.permission != ScanPermission.Asking) return false
        requested = true
        return true
    }

    /** The system dialog is about to be shown (by the opening or by the button): its answer time is measured from here. */
    fun asking() {
        askedAt = clock()
    }

    /**
     * Android's answer, or the button's. A refusal is final only when the system gave an answer without showing its dialog
     * (it came back at once) or when it is the second one; closing the dialog by tapping outside is not a refusal for good.
     */
    @Synchronized
    fun permissionResult(granted: Boolean) {
        val since = askedAt
        askedAt = null
        if (!granted) denials++
        val withoutDialog = since != null && clock() - since < NO_DIALOG_NANOS
        _state.update {
            it.copy(
                permission = when {
                    granted -> ScanPermission.Granted
                    !access.canExplain() && (withoutDialog || denials >= 2) -> ScanPermission.Blocked
                    else -> ScanPermission.Denied
                },
            )
        }
    }

    /** Whether the «Dar permiso de cámara» button may show Android's dialog again (the person asked for it). */
    fun canAskAgain(): Boolean = _state.value.permission == ScanPermission.Denied

    fun openSettings() = access.openSettings()

    /** The screen came back (from the system settings, or from the background): the permission is read again. */
    fun resumed() = _state.update {
        when {
            access.granted() -> it.copy(permission = ScanPermission.Granted)
            it.permission == ScanPermission.Granted -> it.copy(permission = if (access.canExplain()) ScanPermission.Denied else ScanPermission.Blocked, torch = false)
            else -> it
        }
    }

    /** The screen goes away or to the background: the camera is let go, and with it the torch. */
    fun paused() = _state.update { it.copy(torch = false) }

    fun flashFound(has: Boolean) = _state.update { it.copy(hasFlash = has, torch = it.torch && has) }

    fun toggleTorch() = _state.update { if (it.hasFlash && it.permission == ScanPermission.Granted) it.copy(torch = !it.torch) else it }

    fun clearHint() {
        synchronized(this) { lastText = null }
        _state.update { it.copy(hint = null) }
    }

    /** One decoded text from the camera. The same text again, or anything once a link was found, is ignored. */
    @Synchronized
    fun onText(text: String) {
        val s = _state.value
        if (s.found != null || s.permission != ScanPermission.Granted || text == lastText) return
        lastText = text
        val hint = if (text.length > MAX_QR_CHARS) ScanTexts.NOT_ORB else try {
            parseLinkPayload(text)
            null
        } catch (e: LinkPayloadException) {
            scanHint(e.key)
        } catch (e: Exception) {
            ScanTexts.NOT_ORB
        }
        _state.update { if (hint == null) it.copy(found = text, hint = null, torch = false) else it.copy(hint = hint) }
    }
}

/**
 * How a read link travels from the scanner back to the welcome page: through the saved state of the welcome's own
 * back stack entry, so it survives the process being recreated with the scanner open. It is taken once and erased.
 */
object ScanHandoff {
    const val KEY = "scanned-link"
    const val PASTE_KEY = "scan-paste"
    const val CODE_KEY = "scan-code"

    fun deliver(target: SavedStateHandle?, text: String) {
        target?.set(KEY, text)
    }

    fun take(source: SavedStateHandle): String? {
        val text = source.get<String>(KEY)
        if (text != null) source.remove<String>(KEY)
        return text
    }

    /** «Pegar el enlace» on the scanner: the welcome page opens its sheet. */
    fun deliverPaste(target: SavedStateHandle?) {
        target?.set(PASTE_KEY, true)
    }

    fun takePaste(source: SavedStateHandle): Boolean = source.remove<Boolean>(PASTE_KEY) == true

    /** «Escribir el código a mano» on the scanner: the welcome page opens the short-code sheet. */
    fun deliverCode(target: SavedStateHandle?) {
        target?.set(CODE_KEY, true)
    }

    fun takeCode(source: SavedStateHandle): Boolean = source.remove<Boolean>(CODE_KEY) == true
}

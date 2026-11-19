package dev.orb.app.ui.welcome

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.orb.app.link.net.PairError
import dev.orb.app.link.net.PairOk
import dev.orb.app.link.net.PairingException
import dev.orb.app.link.net.ResolvedLink
import dev.orb.app.link.payload.LinkPayloadException
import dev.orb.app.link.payload.LinkVia
import dev.orb.app.link.payload.parseManual
import dev.orb.app.ui.Linker
import dev.orb.app.ui.pairErrorText
import dev.orb.app.ui.payloadErrorText
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class WelcomeStage {
    /** Welcome: the scan button and, in a sheet, the short code. */
    Entry,

    /** The PC answered: its name and fingerprint are shown and the master password is asked. */
    Fingerprint,

    /** The password was accepted; the key is being saved. */
    Linking,

    /** Linked; the person leaves with the «Ir a Chats» button. */
    Done,
}

/** What the PC answered, for the person to compare with the PC's own screen. */
data class PcIdentity(val name: String, val groups: List<String>, val viaCode: Boolean)

data class WelcomeUiState(
    val stage: WelcomeStage = WelcomeStage.Entry,
    val sheet: Boolean = false,
    val link: String = "",
    val code: String = "",
    val address: String = "",
    val pc: PcIdentity? = null,
    // Lives only in memory, is cleared as soon as it is sent and is never logged.
    val password: String = "",
    // How many characters were typed, so the field can still be drawn as dots while the password is being checked.
    val passwordLength: Int = 0,
    val showPassword: Boolean = false,
    // Resolving the PC (step a).
    val busy: Boolean = false,
    // Checking the password with the PC (step b).
    val checking: Boolean = false,
    // The error that belongs under the password field, and the one that belongs to the stage as a whole.
    val passwordError: String? = null,
    val error: String? = null,
    val noticeDialog: Boolean = false,
    // The person said «Ahora no» to notices: the bottom message points to «Este móvil».
    val noticesLater: Boolean = false,
    val noticesOn: Boolean = false,
) {
    /** How many of the three steps of «Enlazando» really happened: the PC's code, the password, the key saved. */
    val stepsDone: Int get() = when (stage) {
        WelcomeStage.Entry, WelcomeStage.Fingerprint -> 0
        WelcomeStage.Linking -> 2
        WelcomeStage.Done -> 3
    }
}

/** Android's notification permission as the first-run flow needs it. */
interface NoticeGate {
    /** True while Android would still need the person's OK: version 13 or later and notices not allowed. */
    fun shouldAsk(): Boolean
    val enabled: Boolean

    /** Android's own permission request. */
    fun request()
}

/** The fingerprint as the groups the person compares with the PC's screen (the same ones the PC shows). */
fun fingerprintGroups(fp: String): List<String> = fp.split('-', ' ').filter { it.isNotBlank() }

class WelcomeViewModel(
    private val linker: Linker,
    private val deviceName: String,
    // Saves the new link and starts using it; runs on [dispatcher].
    private val onLinked: (PairOk) -> Unit,
    private val dispatcher: CoroutineDispatcher = Dispatchers.Default,
    private val notices: NoticeGate? = null,
) : ViewModel() {
    private val _state = MutableStateFlow(WelcomeUiState())
    val state: StateFlow<WelcomeUiState> = _state.asStateFlow()

    // What step (a) resolved; the password step links against it. It never leaves the view model.
    private var resolved: ResolvedLink? = null

    fun openSheet() = _state.update { it.copy(sheet = true, error = null) }
    fun closeSheet() = _state.update { if (it.busy) it else it.copy(sheet = false, error = null) }

    fun setLink(v: String) = _state.update { it.copy(link = v, error = null) }
    fun setCode(v: String) = _state.update { it.copy(code = v, error = null) }
    fun setAddress(v: String) = _state.update { it.copy(address = v, error = null) }

    /** The «Pegar» button: whatever the clipboard holds replaces the link field. */
    fun paste(text: String?) {
        val t = text?.trim().orEmpty()
        if (t.isNotEmpty()) setLink(t)
    }

    fun setPassword(v: String) = _state.update { it.copy(password = v, passwordLength = v.length, passwordError = null, error = null) }
    fun toggleShowPassword() = _state.update { it.copy(showPassword = !it.showPassword) }

    /** Step (a): asks the PC who it is. Nothing is linked yet; the person first sees the name and the fingerprint. */
    fun resolve() {
        val s = _state.value
        if (s.busy || s.stage != WelcomeStage.Entry) return
        val payload = try {
            parseManual(text = s.link.ifBlank { null }, code = s.code, address = s.address)
        } catch (e: LinkPayloadException) {
            return fail(payloadErrorText(e.key))
        } catch (e: Exception) {
            return fail(payloadErrorText(""))
        }
        _state.update { it.copy(busy = true, error = null) }
        viewModelScope.launch(dispatcher) {
            try {
                val r = linker.resolve(payload).getOrElse { return@launch fail(errorOf(it)) }
                resolved = r
                _state.update {
                    it.copy(
                        busy = false, sheet = false, stage = WelcomeStage.Fingerprint,
                        pc = PcIdentity(r.name?.takeIf { n -> n.isNotBlank() } ?: "Tu PC", fingerprintGroups(r.fp), r.via == LinkVia.CODE),
                    )
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                fail("Error inesperado (${e.javaClass.simpleName}).")
            }
        }
    }

    /** Step (b): the person saw the fingerprint and typed the master password; this proves it to the PC and saves the link. */
    fun confirm() {
        val s = _state.value
        val r = resolved
        if (s.checking || s.stage != WelcomeStage.Fingerprint || r == null) return
        if (s.password.isEmpty()) return _state.update { it.copy(passwordError = "Escribe la contraseña maestra del PC.") }
        val password = s.password
        _state.update { it.copy(checking = true, error = null, passwordError = null, password = "", showPassword = false) }
        viewModelScope.launch(dispatcher) {
            try {
                val ok = linker.link(r, password, deviceName).getOrElse { return@launch rejected(it) }
                _state.update { it.copy(stage = WelcomeStage.Linking) }
                onLinked(ok)
                resolved = null
                val ask = notices?.shouldAsk() == true
                _state.update {
                    it.copy(checking = false, stage = WelcomeStage.Done, passwordLength = 0, noticeDialog = ask, noticesOn = notices?.enabled == true)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _state.update { it.copy(checking = false, stage = WelcomeStage.Fingerprint, error = "Error inesperado (${e.javaClass.simpleName}).") }
            }
        }
    }

    /** Back from the fingerprint to the welcome: what the PC answered and the password are forgotten. */
    fun back() {
        if (_state.value.checking || _state.value.stage != WelcomeStage.Fingerprint) return
        resolved = null
        _state.update { it.copy(stage = WelcomeStage.Entry, pc = null, password = "", passwordLength = 0, showPassword = false, error = null, passwordError = null) }
    }

    /** «Activar» in «¿Avisos de Orb?»: only now does Android's own permission request appear. */
    fun activateNotices() {
        _state.update { it.copy(noticeDialog = false) }
        notices?.request()
    }

    /** «Ahora no»: Android is not asked; the bottom message points to «Este móvil». Nothing asks again by itself. */
    fun declineNotices() = _state.update { it.copy(noticeDialog = false, noticesLater = true) }

    /** The permission changed (the activity came back from Android's dialog or settings). */
    fun noticesChanged(on: Boolean) = _state.update { it.copy(noticesOn = on, noticesLater = it.noticesLater && !on) }

    private fun rejected(e: Throwable) {
        val refused = (e as? PairingException)?.error as? PairError.Refused
        if (refused?.reason == "password") _state.update { it.copy(checking = false, passwordError = errorOf(e)) } else fail(errorOf(e))
    }

    private fun errorOf(e: Throwable): String = (e as? PairingException)?.let { pairErrorText(it.error) } ?: pairErrorText(PairError.BadAnswer)

    private fun fail(message: String) = _state.update { it.copy(busy = false, checking = false, error = message) }

    override fun onCleared() {
        resolved = null
    }
}

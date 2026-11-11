package dev.orb.app.ui.welcome

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.orb.app.link.net.PairError
import dev.orb.app.link.net.PairOk
import dev.orb.app.link.net.PairingException
import dev.orb.app.link.payload.LinkPayloadException
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

data class WelcomeUiState(
    val link: String = "",
    val code: String = "",
    val address: String = "",
    // Lives only in memory, is cleared after every attempt and is never logged.
    val password: String = "",
    val busy: Boolean = false,
    val error: String? = null,
    val linked: Boolean = false,
)

class WelcomeViewModel(
    private val linker: Linker,
    private val deviceName: String,
    // Saves the new link and starts using it; runs on [dispatcher].
    private val onLinked: (PairOk) -> Unit,
    private val dispatcher: CoroutineDispatcher = Dispatchers.Default,
) : ViewModel() {
    private val _state = MutableStateFlow(WelcomeUiState())
    val state: StateFlow<WelcomeUiState> = _state.asStateFlow()

    fun setLink(v: String) = _state.update { it.copy(link = v, error = null) }
    fun setCode(v: String) = _state.update { it.copy(code = v, error = null) }
    fun setAddress(v: String) = _state.update { it.copy(address = v, error = null) }
    fun setPassword(v: String) = _state.update { it.copy(password = v, error = null) }

    fun submit() {
        val s = _state.value
        if (s.busy || s.linked) return
        val payload = try {
            parseManual(text = s.link.ifBlank { null }, code = s.code, address = s.address)
        } catch (e: LinkPayloadException) {
            return fail(payloadErrorText(e.key))
        } catch (e: Exception) {
            return fail(payloadErrorText(""))
        }
        if (s.password.isEmpty()) return fail("Escribe la contraseña maestra del PC.")
        val password = s.password
        _state.update { it.copy(busy = true, error = null, password = "") }
        viewModelScope.launch(dispatcher) {
            try {
                val resolved = linker.resolve(payload).getOrElse { return@launch fail(errorOf(it)) }
                val ok = linker.link(resolved, password, deviceName).getOrElse { return@launch fail(errorOf(it)) }
                onLinked(ok)
                _state.update { it.copy(busy = false, linked = true) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                fail("Error inesperado (${e.javaClass.simpleName}).")
            }
        }
    }

    private fun errorOf(e: Throwable): String = (e as? PairingException)?.let { pairErrorText(it.error) } ?: pairErrorText(PairError.BadAnswer)

    private fun fail(message: String) = _state.update { it.copy(busy = false, error = message) }
}

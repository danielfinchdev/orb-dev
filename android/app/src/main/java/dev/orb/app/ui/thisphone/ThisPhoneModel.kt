package dev.orb.app.ui.thisphone

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.orb.app.AppContainer
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.notify.NotifySettings
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

/** What «Este móvil» needs from the app: the link, the notice settings and the way out. */
interface ThisPhoneBackend {
    val pcName: StateFlow<String?>
    val connection: StateFlow<ConnectionState>
    val settings: StateFlow<NotifySettings>
    val notificationsEnabled: StateFlow<Boolean>
    fun setKeepConnected(on: Boolean)
    fun setLockScreenPublic(on: Boolean)
    fun requestNotifications()

    /** Forgets the PC: link keys, cache and unsent messages. */
    suspend fun unlink()
}

@OptIn(ExperimentalCoroutinesApi::class)
class RuntimeThisPhoneBackend(private val container: AppContainer) : ThisPhoneBackend {
    private val link = container.runtime.flatMapLatest { rt ->
        if (rt == null) flowOf<Pair<String?, ConnectionState>>(null to ConnectionState.Unlinked)
        else rt.client.connection.map { c -> ((c as? ConnectionState.Online)?.pcName ?: rt.client.pcInfo.value?.name ?: rt.client.currentSession.name) to c }
    }.stateIn(container.scope, SharingStarted.Eagerly, null to ConnectionState.Connecting)

    override val pcName: StateFlow<String?> = link.map { it.first }.stateIn(container.scope, SharingStarted.Eagerly, null)
    override val connection: StateFlow<ConnectionState> = link.map { it.second }.stateIn(container.scope, SharingStarted.Eagerly, ConnectionState.Connecting)
    override val settings get() = container.notifyPrefs.settings
    override val notificationsEnabled get() = container.notificationAccess.enabled
    override fun setKeepConnected(on: Boolean) = container.notifyPrefs.setKeepConnected(on)
    override fun setLockScreenPublic(on: Boolean) = container.notifyPrefs.setLockScreenPublic(on)
    override fun requestNotifications() = container.notificationAccess.request()
    override suspend fun unlink() = container.unlink()
}

@Immutable
data class ThisPhoneState(
    val pcName: String? = null,
    val connection: ConnectionState = ConnectionState.Connecting,
    val keepConnected: Boolean = true,
    val lockScreenPublic: Boolean = false,
    val notificationsEnabled: Boolean = true,
    val unlinking: Boolean = false,
    val unlinked: Boolean = false,
)

class ThisPhoneViewModel(private val backend: ThisPhoneBackend) : ViewModel() {
    private val busy = MutableStateFlow(false)
    private val done = MutableStateFlow(false)

    val state: StateFlow<ThisPhoneState> = combine(
        backend.pcName, backend.connection, backend.settings, backend.notificationsEnabled, combine(busy, done) { b, d -> b to d },
    ) { name, conn, s, enabled, (b, d) ->
        ThisPhoneState(name, conn, s.keepConnected, s.lockScreenPublic, enabled, b, d)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), ThisPhoneState())

    fun setKeepConnected(on: Boolean) = backend.setKeepConnected(on)
    fun setLockScreenPublic(on: Boolean) = backend.setLockScreenPublic(on)
    fun requestNotifications() = backend.requestNotifications()

    fun unlink() {
        if (busy.value) return
        busy.value = true
        viewModelScope.launch {
            backend.unlink()
            done.value = true
            busy.value = false
        }
    }
}

object ThisPhoneTexts {
    const val TITLE = "Este móvil"
    const val BACK = "Volver"
    const val SECTION_LINK = "Enlace"
    const val SECTION_NOTICES = "Avisos"
    const val SECTION_SECURITY = "Seguridad"
    const val SECTION_LOOK = "Aspecto"
    const val KEEP = "Mantener conectado"
    const val KEEP_HINT = "Recibe avisos con la app cerrada. Muestra un aviso fijo discreto y no usa servicios de Google."
    const val NOTICES = "Avisos de Orb"
    const val NOTICES_ON = "Permitidos"
    const val NOTICES_OFF = "Desactivados en Android"
    const val ALLOW = "Permitir"
    const val LOCK_CONTENT = "Mostrar el texto en la pantalla de bloqueo"
    const val LOCK_CONTENT_HINT = "Apagado: el aviso se ve, pero sin su contenido."
    const val FINGERPRINT = "Bloqueo con huella"
    const val FINGERPRINT_HINT = "Estará disponible en una próxima versión."
    const val APPEARANCE = "Apariencia"
    const val UNLINK = "Desenlazar este móvil"
    const val NO_NAME = "PC sin nombre"

    fun link(c: ConnectionState, zone: TimeZone = TimeZone.getDefault()): String = when (c) {
        is ConnectionState.Online -> "Conectado ahora"
        is ConnectionState.Offline -> c.lastSeen?.let { "Sin conexión · última vez ${stamp(it, zone)}" } ?: "Sin conexión"
        ConnectionState.Connecting -> "Conectando…"
        ConnectionState.UpdateApp -> "Hay que actualizar la app"
        ConnectionState.UpdatePc -> "Hay que actualizar Orb en el PC"
        ConnectionState.Unlinked -> "No enlazado"
        is ConnectionState.Attention -> "El PC necesita atención"
    }

    private fun stamp(ms: Long, zone: TimeZone) = SimpleDateFormat("d MMM, HH:mm", Locale("es")).apply { timeZone = zone }.format(ms)
}

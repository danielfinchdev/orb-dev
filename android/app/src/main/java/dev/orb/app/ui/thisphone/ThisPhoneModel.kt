package dev.orb.app.ui.thisphone

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.orb.app.AppContainer
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.lock.AuthCapability
import dev.orb.app.lock.AuthResult
import dev.orb.app.lock.LockDelay
import dev.orb.app.lock.LockSettings
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

    val lock: StateFlow<LockSettings>
    fun lockCapability(): AuthCapability

    /** Turns the lock on after the system authenticated the person right now. */
    fun enableLock(onDone: (AuthResult) -> Unit)
    fun disableLock()
    fun setLockDelay(delay: LockDelay)

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
    override val lock get() = container.lock.settings
    override fun lockCapability() = container.lock.capability()
    override fun enableLock(onDone: (AuthResult) -> Unit) = container.lock.enable(onDone)
    override fun disableLock() = container.lock.disable()
    override fun setLockDelay(delay: LockDelay) = container.lock.setDelay(delay)
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
    val appLock: Boolean = false,
    val lockDelay: LockDelay = LockDelay.OneMinute,
    /** False when the phone has neither biometrics nor a PIN: the lock cannot be turned on. */
    val lockAvailable: Boolean = true,
    val lockMessage: String? = null,
)

class ThisPhoneViewModel(private val backend: ThisPhoneBackend) : ViewModel() {
    private val busy = MutableStateFlow(false)
    private val done = MutableStateFlow(false)
    private val lockMessage = MutableStateFlow<String?>(null)
    private val lockAvailable = MutableStateFlow(backend.lockCapability() == AuthCapability.Ready)

    val state: StateFlow<ThisPhoneState> = combine(
        backend.pcName, backend.connection, backend.settings, backend.notificationsEnabled, combine(busy, done) { b, d -> b to d },
    ) { name, conn, s, enabled, (b, d) ->
        ThisPhoneState(name, conn, s.keepConnected, s.lockScreenPublic, enabled, b, d)
    }.combine(combine(backend.lock, lockAvailable, lockMessage) { l, a, m -> Triple(l, a, m) }) { st, (l, a, m) ->
        st.copy(appLock = l.enabled, lockDelay = l.delay, lockAvailable = a, lockMessage = m)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), ThisPhoneState())

    fun setKeepConnected(on: Boolean) = backend.setKeepConnected(on)
    fun setLockScreenPublic(on: Boolean) = backend.setLockScreenPublic(on)
    fun requestNotifications() = backend.requestNotifications()

    /** The person may have set a PIN or a fingerprint in Android since the screen was last shown. */
    fun refreshLock() { lockAvailable.value = backend.lockCapability() == AuthCapability.Ready }

    fun setAppLock(on: Boolean) {
        lockMessage.value = null
        if (!on) return backend.disableLock()
        backend.enableLock { result ->
            lockMessage.value = when (result) {
                AuthResult.Blocked -> ThisPhoneTexts.LOCK_BLOCKED
                AuthResult.Failed -> ThisPhoneTexts.LOCK_FAILED
                AuthResult.NothingSet -> ThisPhoneTexts.LOCK_NOTHING_SET
                AuthResult.Success, AuthResult.Cancelled -> null
            }
            refreshLock()
        }
    }

    fun setLockDelay(delay: LockDelay) = backend.setLockDelay(delay)

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
    const val FINGERPRINT_HINT = "Pide tu huella, tu cara o el PIN del móvil al abrir Orb. Apagado de serie."
    const val FINGERPRINT_UNAVAILABLE = "Para usarlo, configura una huella o un PIN en los ajustes de Android."
    const val LOCK_DELAY = "Volver a pedirlo"
    const val LOCK_BLOCKED = "Demasiados intentos. Espera un momento o usa el PIN del móvil."
    const val LOCK_FAILED = "No se pudo comprobar. El bloqueo sigue apagado."
    const val LOCK_NOTHING_SET = "Este móvil no tiene huella ni PIN configurados."

    fun delay(d: LockDelay) = when (d) {
        LockDelay.Immediate -> "Inmediato"
        LockDelay.OneMinute -> "1 min"
        LockDelay.FiveMinutes -> "5 min"
    }
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

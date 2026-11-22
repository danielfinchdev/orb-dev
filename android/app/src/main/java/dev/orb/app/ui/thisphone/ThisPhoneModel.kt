package dev.orb.app.ui.thisphone

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.orb.app.AppContainer
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.PathError
import dev.orb.app.link.net.PathStatus
import dev.orb.app.link.net.PcEntry
import dev.orb.app.link.net.pcDisplayName
import dev.orb.app.lock.AuthCapability
import dev.orb.app.lock.AuthResult
import dev.orb.app.lock.LockDelay
import dev.orb.app.lock.LockSettings
import dev.orb.app.notify.LockScreenNotice
import dev.orb.app.notify.NoteChannel
import dev.orb.app.notify.NoticeStatus
import dev.orb.app.notify.NotifySettings
import dev.orb.app.notify.NotifyTexts
import dev.orb.app.ui.offline.OfflineTexts
import dev.orb.app.ui.scan.CameraAccess
import kotlinx.coroutines.CancellationException
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

    /** Each address of the PC with the last time it answered; empty when there is no link. */
    val paths: StateFlow<List<dev.orb.app.link.net.PathStatus>> get() = MutableStateFlow(emptyList())

    /** The PC's own account of its doors, when it gives one. */
    val pcEntries: StateFlow<List<dev.orb.app.link.net.PcEntry>> get() = MutableStateFlow(emptyList())
    val settings: StateFlow<NotifySettings>
    /** What Android lets the notices do now (permission and channels), read from the system. */
    val noticeStatus: StateFlow<NoticeStatus>

    /** The PC's fingerprint as the link keeps it; null when there is no link. */
    fun fingerprint(): String?
    fun setKeepConnected(on: Boolean)
    fun setLockScreen(mode: LockScreenNotice)

    /** Android's permission dialog, or the app's notice settings when the dialog can no longer be shown. */
    fun requestNotifications()

    /** The system's notice settings of Orb, where the permission is turned off. */
    fun openNoticeSettings()

    /** The system's settings of one channel: its sound lives there. */
    fun openChannelSettings(channel: NoteChannel)

    /** Reads again what Android says about the permissions (the person may have changed them in the system settings). */
    fun refreshPermissions()
    fun cameraState(): CameraState
    fun openCameraSettings()

    /** True while Android may limit Orb in the background to save battery. */
    fun batteryRestricted(): Boolean
    fun openBatterySettings()

    /** One light call through the encrypted link (the `me` of the connection test); how long it takes is the latency. */
    suspend fun probe(): Result<Unit>

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
        else rt.client.connection.map { c -> rt.client.pcDisplayName(c) to c }
    }.stateIn(container.scope, SharingStarted.Eagerly, null to ConnectionState.Connecting)

    override val pcName: StateFlow<String?> = link.map { it.first }.stateIn(container.scope, SharingStarted.Eagerly, null)
    override val connection: StateFlow<ConnectionState> = link.map { it.second }.stateIn(container.scope, SharingStarted.Eagerly, ConnectionState.Connecting)
    override val paths: StateFlow<List<dev.orb.app.link.net.PathStatus>> = container.runtime.flatMapLatest { rt ->
        rt?.client?.paths ?: flowOf(emptyList())
    }.stateIn(container.scope, SharingStarted.Eagerly, emptyList())
    override val pcEntries: StateFlow<List<dev.orb.app.link.net.PcEntry>> = container.runtime.flatMapLatest { rt ->
        rt?.client?.pcEntries ?: flowOf(emptyList())
    }.stateIn(container.scope, SharingStarted.Eagerly, emptyList())
    override val settings get() = container.notifyPrefs.settings
    override val noticeStatus get() = container.notificationAccess.status
    override fun fingerprint(): String? = container.runtime.value?.client?.currentSession?.pc
    override fun setKeepConnected(on: Boolean) = container.notifyPrefs.setKeepConnected(on)
    override fun setLockScreen(mode: LockScreenNotice) = container.notifyPrefs.setLockScreen(mode)
    override fun requestNotifications() = container.notificationAccess.request()
    override fun openNoticeSettings() = container.noticeSettings.openApp()
    override fun openChannelSettings(channel: NoteChannel) = container.noticeSettings.openChannel(channel)
    override fun refreshPermissions() = container.notificationAccess.refresh()
    override fun cameraState() = cameraStateOf(container.cameraAccess)
    override fun openCameraSettings() = container.cameraAccess.openSettings()
    override fun batteryRestricted() = container.batteryAccess.restricted()
    override fun openBatterySettings() = container.batteryAccess.openSettings()
    override suspend fun probe(): Result<Unit> =
        container.runtime.value?.client?.me()?.map { } ?: Result.failure(IllegalStateException("not linked"))
    override val lock get() = container.lock.settings
    override fun lockCapability() = container.lock.capability()
    override fun enableLock(onDone: (AuthResult) -> Unit) = container.lock.enable(onDone)
    override fun disableLock() = container.lock.disable()
    override fun setLockDelay(delay: LockDelay) = container.lock.setDelay(delay)
    override suspend fun unlink() = container.unlink()
}

/** The camera as «Este móvil» reports it. Whether Android would still show its dialog is only known by the scanner itself. */
enum class CameraState { None, Allowed, NotAllowed }

fun cameraStateOf(access: CameraAccess): CameraState = when {
    !access.hasCamera -> CameraState.None
    access.granted() -> CameraState.Allowed
    else -> CameraState.NotAllowed
}

/** One way to the PC for the screen: its name, how it is doing, and whether its last try worked. */
@Immutable
data class PathLine(val label: String, val text: String, val ok: Boolean)

@Immutable
data class ThisPhoneState(
    val pcName: String? = null,
    val connection: ConnectionState = ConnectionState.Connecting,
    val fingerprint: String? = null,
    /** How the phone reaches the PC now; null while there is no connection. */
    val route: RouteKind? = null,
    /** Each way to the PC with when it last worked: what the phone knows of its own tries, plus what the PC says of its doors. */
    val paths: List<PathLine> = emptyList(),
    /** The last measured round trip through the link; null before the first one or when it failed. */
    val latencyMs: Long? = null,
    val measuring: Boolean = false,
    val keepConnected: Boolean = true,
    val lockScreen: LockScreenNotice = LockScreenNotice.Generic,
    val notices: NoticeStatus = NoticeStatus.On,
    val camera: CameraState = CameraState.Allowed,
    val batteryRestricted: Boolean = false,
    val unlinking: Boolean = false,
    val unlinked: Boolean = false,
    val appLock: Boolean = false,
    val lockDelay: LockDelay = LockDelay.FiveMinutes,
    /** False when the phone has neither biometrics nor a PIN: the lock cannot be turned on. */
    val lockAvailable: Boolean = true,
    val lockMessage: String? = null,
) {
    val online: Boolean get() = connection is ConnectionState.Online
}

class ThisPhoneViewModel(
    private val backend: ThisPhoneBackend,
    // Monotonic clock in ms, injectable for tests.
    private val now: () -> Long = { System.nanoTime() / 1_000_000 },
    private val wallClock: () -> Long = { System.currentTimeMillis() },
) : ViewModel() {
    private val busy = MutableStateFlow(false)
    private val done = MutableStateFlow(false)
    private val lockMessage = MutableStateFlow<String?>(null)
    private val lockAvailable = MutableStateFlow(backend.lockCapability() == AuthCapability.Ready)
    private val latency = MutableStateFlow<Long?>(null)
    private val measuring = MutableStateFlow(false)
    private val camera = MutableStateFlow(backend.cameraState())
    private val battery = MutableStateFlow(backend.batteryRestricted())

    val state: StateFlow<ThisPhoneState> = combine(
        backend.pcName, backend.connection, backend.settings, backend.noticeStatus, combine(busy, done) { b, d -> b to d },
    ) { name, conn, s, enabled, (b, d) ->
        ThisPhoneState(
            pcName = name, connection = conn, fingerprint = backend.fingerprint(),
            route = (conn as? ConnectionState.Online)?.let { RouteKind.of(it.base) },
            keepConnected = s.keepConnected, lockScreen = s.lockScreen, notices = enabled, unlinking = b, unlinked = d,
        )
    }.combine(combine(backend.lock, lockAvailable, lockMessage) { l, a, m -> Triple(l, a, m) }) { st, (l, a, m) ->
        st.copy(appLock = l.enabled, lockDelay = l.delay, lockAvailable = a, lockMessage = m ?: ThisPhoneTexts.LOCK_AUTO_OFF.takeIf { l.autoOff })
    }.combine(combine(backend.paths, backend.pcEntries) { p, e -> p to e }) { st, (p, e) ->
        st.copy(paths = ThisPhoneTexts.pathLines(p, e, wallClock()))
    }.combine(combine(latency, measuring) { l, m -> l to m }) { st, (l, m) ->
        st.copy(latencyMs = l.takeIf { st.online }, measuring = m)
    }.combine(combine(camera, battery) { c, b -> c to b }) { st, (c, b) ->
        st.copy(camera = c, batteryRestricted = b)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), ThisPhoneState())

    /**
     * Times one call through the link. It runs when the screen opens and when the person pulls to refresh, never in a
     * loop, and only while the PC is reachable (there is nothing to time otherwise).
     */
    fun measure() {
        if (measuring.value || !state.value.online) return
        measuring.value = true
        viewModelScope.launch {
            val t0 = now()
            val result = try { backend.probe() } catch (e: CancellationException) { throw e } catch (e: Exception) { Result.failure(e) }
            latency.value = if (result.isSuccess) (now() - t0).coerceAtLeast(0) else null
            measuring.value = false
        }
    }

    fun setKeepConnected(on: Boolean) = backend.setKeepConnected(on)
    fun setLockScreen(mode: LockScreenNotice) = backend.setLockScreen(mode)

    /**
     * The switch reflects what Android really allows: off asks for the permission (or opens the settings when Android will not
     * ask), on opens the settings where it can be turned off, and a notice channel that is off opens that channel's page.
     */
    fun toggleNotifications() {
        val n = state.value.notices
        when {
            !n.allowed -> backend.requestNotifications()
            n.offChannels.isNotEmpty() -> fixChannels()
            else -> backend.openNoticeSettings()
        }
    }

    fun requestNotifications() = backend.requestNotifications()
    fun openChannelSettings(channel: NoteChannel) = backend.openChannelSettings(channel)

    /** The page of the channel that is off, or the list of all of them when more than one is. */
    fun fixChannels() {
        val off = state.value.notices.offChannels
        if (off.size == 1) backend.openChannelSettings(off.single()) else backend.openNoticeSettings()
    }

    fun openCameraSettings() = backend.openCameraSettings()
    fun openBatterySettings() = backend.openBatterySettings()

    /**
     * Reads again everything the person can change outside Orb: it runs whenever the screen comes back (from Android's
     * settings too), so nothing here is a copy that can go stale. The phone may also have got a PIN or a fingerprint.
     */
    fun refresh() {
        backend.refreshPermissions()
        camera.value = backend.cameraState()
        battery.value = backend.batteryRestricted()
        refreshLock()
    }

    fun refreshLock() { lockAvailable.value = backend.lockCapability() == AuthCapability.Ready }

    fun setAppLock(on: Boolean) {
        lockMessage.value = null
        if (!on) return backend.disableLock()
        backend.enableLock { result ->
            lockMessage.value = when (result) {
                AuthResult.Blocked -> ThisPhoneTexts.LOCK_BLOCKED
                AuthResult.Failed, AuthResult.NotRecognized -> ThisPhoneTexts.LOCK_FAILED
                AuthResult.NothingSet -> ThisPhoneTexts.LOCK_NOTHING_SET
                AuthResult.Success, AuthResult.Cancelled -> null
            }
            refreshLock()
        }
    }

    /** The choice of the sheet: «Sin bloqueo» (null) turns the lock off; the others set the delay and turn it on if it was off. */
    fun chooseLock(delay: LockDelay?) {
        if (delay == null) return setAppLock(false)
        backend.setLockDelay(delay)
        if (!state.value.appLock) setAppLock(true)
    }

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
    const val SECTION_LOOK = "Apariencia"
    const val SECTION_SECURITY = "Seguridad"
    const val LINK_PC = "PC"
    const val LINK_FINGERPRINT = "Huella"
    const val LINK_ROUTE = "Ruta"
    const val NOTICES = "Avisos de mensajes y tareas"
    const val NOTICES_HINT = "Chats y aprobaciones"
    const val NOTICES_OFF = "Avisos desactivados en Android"
    const val NOTICES_OFF_HINT = "Permite los avisos para recibir los chats y las aprobaciones."
    const val NOTICES_OFF_SETTINGS_HINT = "Actívalos en los ajustes de Android para recibir los chats y las aprobaciones."
    const val NOTICES_CHANNEL_OFF = "Un aviso está apagado en Android"
    const val ALLOW = "Permitir"
    const val OPEN_SETTINGS = "Abrir ajustes"
    const val SETTINGS = "Ajustes"
    const val CAMERA = "Cámara"
    const val CAMERA_ON = "Permitida. Orb solo la usa para leer el QR de tu PC."
    const val CAMERA_OFF = "No permitida. Sin ella no se puede escanear el QR: escribe el código a mano o pega el enlace. Orb la pide al abrir el escáner."
    const val CAMERA_NONE = "Este móvil no tiene cámara. Puedes enlazar escribiendo el código a mano."
    const val BATTERY = "Ahorro de batería"
    const val BATTERY_RESTRICTED = "Limitada. Android puede cerrar Orb para ahorrar batería y dejarías de recibir avisos con la app cerrada. En la pantalla que se abre, busca Orb y déjala sin restricciones."
    const val BATTERY_FREE = "Sin restricción. Android no cierra Orb para ahorrar batería."
    const val BATTERY_LINK = "Revisar el ahorro de batería"
    const val KEEP = "Mantener conectado"
    const val KEEP_HINT = "Avisos aunque cierres la app"
    const val KEEP_NOTE = "«Mantener conectado» muestra un aviso fijo discreto y no usa servicios de Google."
    const val LOCK_SCREEN = "En la pantalla de bloqueo"
    const val LOCK_SCREEN_FULL = "Nombre del chat y texto"
    const val LOCK_SCREEN_GENERIC = "Solo «Orb»"
    const val LOCK_SCREEN_NONE = "Nada"
    const val LOCK_SCREEN_WITH_LOCK = "Con el bloqueo de la app, los avisos no llevan el texto."
    const val CHANNELS = "Sonido de cada canal"
    const val CHANNELS_HINT = "Mensajes, Aprobaciones y Estado"
    const val CHANNELS_NOTE = "Se abre en los ajustes de Android."
    const val APP_LOCK = "Bloqueo de la app"
    const val LOCK_NONE = "Sin bloqueo"
    const val LOCK_ON_EXIT = "Al salir"
    const val FINGERPRINT_UNAVAILABLE = "Para usarlo, configura una huella o un PIN en los ajustes de Android."
    const val LOCK_BLOCKED = "Demasiados intentos. Espera un momento o usa el PIN del móvil."
    const val LOCK_FAILED = "No se pudo comprobar. El bloqueo sigue apagado."
    const val LOCK_AUTO_OFF = "El bloqueo se desactivó porque el móvil ya no tiene PIN ni huella."
    const val LOCK_NOTHING_SET = "Este móvil no tiene huella ni PIN configurados."
    const val MORE_OPTIONS = "Más opciones"
    const val LINK_TEST = "Prueba de conexión"
    const val LINK_TEST_HINT = "Comprueba el enlace con el PC y la cola de envío"
    const val UNLINK = "Desvincular este móvil"
    const val UNLINK_NOTE = "Solo lo del móvil: los ajustes del PC siguen en el PC."
    const val UNLINK_TITLE = "¿Desvincular este móvil?"
    const val UNLINK_CONFIRM = "Desvincular"
    const val CANCEL = "Cancelar"
    const val NO_NAME = "PC sin nombre"
    const val NO_FINGERPRINT = "—"

    /** Says all of it: the link is forgotten, and so are the saved copy and the messages that were not sent yet. */
    fun unlinkBody(pc: String?) =
        "Se olvida el enlace con ${pc?.takeIf { it.isNotBlank() } ?: "el PC"}: se borran la llave guardada, la copia guardada en el móvil " +
            "y los mensajes sin enviar, y dejarás de recibir avisos. Para volver a usarlo tendrás que enlazarlo otra vez con el PC."

    /** Which notices Android keeps off: the names are the ones of the channels in Android's own settings. */
    fun channelsOffHint(off: List<NoteChannel>): String =
        off.joinToString(" y ") { "«${channel(it)}»" } + (if (off.size == 1) " está apagado" else " están apagados") + " en Android: esos avisos no llegan."

    fun lockScreenChoice(m: LockScreenNotice) = when (m) {
        LockScreenNotice.Full -> LOCK_SCREEN_FULL
        LockScreenNotice.Generic -> LOCK_SCREEN_GENERIC
        LockScreenNotice.Hidden -> LOCK_SCREEN_NONE
    }

    /** The options of «Bloqueo de la app»; null is «Sin bloqueo». */
    fun lockChoice(d: LockDelay?) = when (d) {
        null -> LOCK_NONE
        LockDelay.Immediate -> LOCK_ON_EXIT
        LockDelay.FiveMinutes -> "Huella tras 5 min fuera"
        LockDelay.FifteenMinutes -> "Huella tras 15 min fuera"
    }

    fun channel(c: NoteChannel) = when (c) {
        NoteChannel.Messages -> NotifyTexts.CHANNEL_MESSAGES
        NoteChannel.Approvals -> NotifyTexts.CHANNEL_APPROVALS
        NoteChannel.Status -> NotifyTexts.CHANNEL_STATUS
    }

    /** The line under the title of the bar. */
    fun headerSub(name: String?, c: ConnectionState): String {
        val pc = name?.takeIf { it.isNotBlank() } ?: NO_NAME
        return when (c) {
            is ConnectionState.Online -> "$pc · conectado"
            is ConnectionState.Offline -> "$pc · sin conexión"
            ConnectionState.Connecting -> "$pc · conectando…"
            else -> pc
        }
    }

    /** «Tailscale · 38 ms», or «Sin ruta · última a las 13:20» when the PC cannot be reached. */
    fun route(s: ThisPhoneState, zone: TimeZone = TimeZone.getDefault()): String = when (val c = s.connection) {
        is ConnectionState.Online -> (s.route?.label ?: "Conectado") + (s.latencyMs?.let { " · $it ms" } ?: "")
        is ConnectionState.Offline -> "Sin ruta" + (c.lastSeen?.let { " · última a las ${clock(it, zone)}" } ?: "")
        ConnectionState.Connecting -> "Conectando…"
        else -> "Sin ruta"
    }

    /**
     * One line per way to the PC: «Wi-Fi» / «Tailscale» with when it last worked, or why not. The PC's own account of that
     * door (closed, its last error) is added when it gives one; an address the PC does not list is told from the phone's side only.
     */
    fun pathLines(paths: List<PathStatus>, entries: List<PcEntry>, now: Long, zone: TimeZone = TimeZone.getDefault()): List<PathLine> =
        paths.map { p ->
            val kind = RouteKind.of(p.url)
            val label = when (kind) { RouteKind.Tailscale -> "Tailscale"; RouteKind.Lan -> "Wi-Fi"; else -> "Internet" }
            val mine = when {
                p.lastOkAt != null -> "Funcionó ${OfflineTexts.absolute(p.lastOkAt, now, zone)}"
                p.lastTryAt == null -> "Aún sin probar"
                else -> "Nunca ha funcionado"
            }
            val why = p.lastError?.let { PATH_ERRORS[it] }
            val pc = entries.firstOrNull { it.url != null && it.url == p.url }
            val theirs = when {
                pc == null -> null
                pc.open == false -> "cerrada en el PC" + (pc.lastError?.let { ": $it" } ?: "")
                else -> null
            }
            PathLine(label, listOfNotNull(mine, why, theirs).joinToString(" · "), ok = p.lastError == null && p.lastOkAt != null)
        }

    private val PATH_ERRORS = mapOf(
        PathError.UNREACHABLE to "no llega",
        PathError.NO_ANSWER to "no contesta",
        PathError.REFUSED to "responde que no",
    )

    fun link(c: ConnectionState, zone: TimeZone = TimeZone.getDefault()): String = when (c) {
        is ConnectionState.Online -> "Conectado"
        is ConnectionState.Offline -> c.lastSeen?.let { "Sin conexión · última vez ${stamp(it, zone)}" } ?: "Sin conexión"
        ConnectionState.Connecting -> "Conectando…"
        ConnectionState.UpdateApp -> "Hay que actualizar la app"
        ConnectionState.UpdatePc -> "Hay que actualizar Orb en el PC"
        ConnectionState.Unlinked -> "No enlazado"
        is ConnectionState.Attention -> "El PC necesita atención"
    }

    private fun clock(ms: Long, zone: TimeZone) = SimpleDateFormat("HH:mm", Locale("es")).apply { timeZone = zone }.format(ms)
    private fun stamp(ms: Long, zone: TimeZone) = SimpleDateFormat("d MMM, HH:mm", Locale("es")).apply { timeZone = zone }.format(ms)
}

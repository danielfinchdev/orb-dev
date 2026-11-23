package dev.orb.app.lock

import dev.orb.app.share.AppGate
import dev.orb.app.ui.theme.KeyValueStore
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.crypto.Cipher

/** How long the app may stay in the background before it asks again; [Immediate] is «Al salir». */
enum class LockDelay(val key: String, val ms: Long) {
    Immediate("now", 0), FiveMinutes("5m", 5 * 60_000L), FifteenMinutes("15m", 15 * 60_000L);

    companion object {
        /** The one-minute choice was dropped: whoever had it moves to the nearest one offered, five minutes. */
        fun fromKey(key: String?) = entries.firstOrNull { it.key == key } ?: FiveMinutes
    }
}

/** [autoOff]: the lock turned itself off because the phone lost its PIN and fingerprint; «Este móvil» says so. */
data class LockSettings(val enabled: Boolean = false, val delay: LockDelay = LockDelay.FiveMinutes, val autoOff: Boolean = false)

/**
 * The only thing kept about the lock: whether it is on and the delay. No secret lives here; the real protection is
 * the system's own authentication (fingerprint, face or the phone's PIN), asked every time the app opens.
 */
class LockPrefs(private val store: KeyValueStore) {
    private val _settings: MutableStateFlow<LockSettings>

    init {
        val delay = LockDelay.fromKey(store.getString(DELAY))
        // Saved in its new form so the old key is gone for good.
        if (store.getString(DELAY) == "1m") store.edit { putString(DELAY, delay.key) }
        _settings = MutableStateFlow(LockSettings(store.getBoolean(ENABLED, false), delay, store.getBoolean(AUTO_OFF, false)))
    }

    val settings: StateFlow<LockSettings> = _settings.asStateFlow()

    /** A deliberate choice of the person: it also clears the note about an automatic switch-off. */
    fun setEnabled(on: Boolean) {
        store.edit { putBoolean(ENABLED, on); putBoolean(AUTO_OFF, false) }
        _settings.value = _settings.value.copy(enabled = on, autoOff = false)
    }

    /** The lock was dropped because nothing can open it any more. */
    fun setAutoOff() {
        store.edit { putBoolean(ENABLED, false); putBoolean(AUTO_OFF, true) }
        _settings.value = _settings.value.copy(enabled = false, autoOff = true)
    }

    fun setDelay(delay: LockDelay) {
        store.edit { putString(DELAY, delay.key) }
        _settings.value = _settings.value.copy(delay = delay)
    }

    private companion object {
        const val ENABLED = "lock.enabled"
        const val DELAY = "lock.delay"
        const val AUTO_OFF = "lock.autoOff"
    }
}

/**
 * Whether the app may show its content. It starts locked when the lock is on (a cold start), locks again when the app
 * comes back after more than the chosen delay, and opens only through [unlock] after the system authenticated the person.
 * [now] must be monotonic (elapsed time since boot), so changing the clock cannot dodge the delay.
 */
class AppLockGate(private val prefs: LockPrefs, private val now: () -> Long) : AppGate {
    private val _locked = MutableStateFlow(prefs.settings.value.enabled)
    val locked: StateFlow<Boolean> = _locked.asStateFlow()
    private var leftAt: Long? = null

    override fun isOpen(): Boolean = !_locked.value

    @Synchronized
    fun onBackground() {
        if (leftAt == null) leftAt = now()
    }

    @Synchronized
    fun onForeground() {
        val left = leftAt ?: return
        leftAt = null
        val s = prefs.settings.value
        if (s.enabled && now() - left >= s.delay.ms) _locked.value = true
    }

    @Synchronized
    fun unlock() {
        // The system credential screen sends the app to the background and back; that trip must not lock it again.
        leftAt = null
        _locked.value = false
    }

    /** Turned on right after a successful authentication, so the person is already inside. */
    @Synchronized
    fun enable() {
        prefs.setEnabled(true)
        leftAt = null
        _locked.value = false
    }

    @Synchronized
    fun disable() {
        prefs.setEnabled(false)
        leftAt = null
        _locked.value = false
    }
}

enum class AuthCapability {
    /** Something to authenticate with: a fingerprint, a face or the phone's PIN, pattern or password. */
    Ready,

    /** The phone has neither biometrics nor a PIN: there is nothing to lock the app with. */
    NothingSet,
}

sealed interface AuthResult {
    data object Success : AuthResult

    /** Authenticated through a [AuthRequest.cipher]: the system unlocked that cipher for one operation. */
    class Crypto(val cipher: Cipher) : AuthResult
    data object Cancelled : AuthResult

    /** Too many wrong tries: the system blocks the sensor for a while. Nothing is lost. */
    data object Blocked : AuthResult
    data object Failed : AuthResult

    /** The sensor could not read the finger (or nobody touched it in time): trying again is the whole advice. */
    data object NotRecognized : AuthResult
    data object NothingSet : AuthResult
}

/** [cipher]: when set, the prompt is bound to it (a `CryptoObject`) and the answer is [AuthResult.Crypto]. */
data class AuthRequest(val title: String, val subtitle: String?, val credentialOnly: Boolean = false, val cipher: Cipher? = null)

/** The system's authentication, behind an interface so the lock can be tested without Android. */
interface Authenticator {
    fun capability(): AuthCapability
    fun authenticate(request: AuthRequest, onResult: (AuthResult) -> Unit)
}

/** What the lock screen tells the person after an attempt. */
enum class LockNotice { Blocked, Failed, NotRecognized }

/** Ties the gate to the system authentication. The activity supplies the [authenticator] while it exists. */
class AppLock(
    val prefs: LockPrefs,
    val gate: AppLockGate,
    /** Null below Android 11: the lock then asks the system only, as it always did. */
    private val crypto: LockCrypto? = null,
    /** Debug log; it never receives secrets, only timings. */
    private val log: (String) -> Unit = {},
    private val nanos: () -> Long = System::nanoTime,
) {
    @Volatile
    var authenticator: Authenticator? = null
        set(value) {
            field = value
            // A prompt of the previous activity may never answer (it was recreated); do not stay busy for ever.
            _busy.value = false
        }

    val settings: StateFlow<LockSettings> get() = prefs.settings

    private val _notice = MutableStateFlow<LockNotice?>(null)
    val notice: StateFlow<LockNotice?> = _notice.asStateFlow()
    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    fun capability(): AuthCapability = authenticator?.capability() ?: AuthCapability.NothingSet

    /** Asks the system to authenticate; the gate opens only on success. [pin] goes straight to the phone's PIN. */
    fun unlock(pin: Boolean = false) {
        val auth = authenticator ?: return
        // A phone with no screen lock protects nothing, and nothing could ever open this lock: it is dropped, not stuck.
        if (auth.capability() == AuthCapability.NothingSet) return dropLock()
        if (!_busy.compareAndSet(expect = false, update = true)) return
        _notice.value = null
        if (crypto == null) {
            auth.authenticate(AuthRequest(LockTexts.PROMPT_TITLE, LockTexts.PROMPT_SUBTITLE, credentialOnly = pin)) { result ->
                _busy.value = false
                if (result == AuthResult.Success) gate.unlock() else report(result)
            }
            return
        }
        when (val prepared = crypto.prepareUnlock()) {
            is LockCipher.Ready -> {
                val t0 = nanos()
                auth.authenticate(AuthRequest(LockTexts.PROMPT_TITLE, LockTexts.PROMPT_SUBTITLE, credentialOnly = pin, cipher = prepared.cipher)) { result ->
                    _busy.value = false
                    if (result is AuthResult.Crypto && crypto.open(result.cipher)) {
                        log("lock opened in ${(nanos() - t0) / 1_000_000} ms")
                        gate.unlock()
                    } else report(if (result is AuthResult.Crypto || result == AuthResult.Success) AuthResult.Failed else result)
                }
            }
            // The key died (a new fingerprint or no screen lock any more) or never existed (a lock made before the key):
            // the phone's PIN proves the person and a new key replaces it.
            LockCipher.Invalidated -> renewKey(auth) { _busy.value = false }
        }
    }

    private fun renewKey(auth: Authenticator, finished: () -> Unit) {
        val crypto = crypto ?: return finished()
        val fresh = crypto.prepareEnable()
        if (fresh !is LockCipher.Ready) {
            finished()
            return dropLock()
        }
        auth.authenticate(AuthRequest(LockTexts.PROMPT_TITLE, LockTexts.RENEW_SUBTITLE, credentialOnly = true, cipher = fresh.cipher)) { result ->
            finished()
            if (result is AuthResult.Crypto && crypto.seal(result.cipher)) gate.unlock() else {
                if (result is AuthResult.NothingSet) dropLock() else report(if (result is AuthResult.Crypto) AuthResult.Failed else result)
            }
        }
    }

    private fun report(result: AuthResult) {
        when (result) {
            AuthResult.Blocked -> _notice.value = LockNotice.Blocked
            AuthResult.Failed, AuthResult.NothingSet, is AuthResult.Crypto -> _notice.value = LockNotice.Failed
            AuthResult.NotRecognized -> _notice.value = LockNotice.NotRecognized
            AuthResult.Cancelled, AuthResult.Success -> Unit
        }
    }

    /** The lock cannot be opened any more: it is turned off and «Este móvil» says why. */
    private fun dropLock() {
        gate.disable()
        crypto?.clear()
        prefs.setAutoOff()
    }

    /** Turning the lock on needs a valid authentication right now, so a lock nobody can open is never set. */
    fun enable(onDone: (AuthResult) -> Unit) {
        val auth = authenticator
        if (auth == null || auth.capability() != AuthCapability.Ready) return onDone(AuthResult.NothingSet)
        if (!_busy.compareAndSet(expect = false, update = true)) return onDone(AuthResult.Cancelled)
        if (crypto == null) {
            auth.authenticate(AuthRequest(LockTexts.ENABLE_TITLE, LockTexts.ENABLE_SUBTITLE)) { result ->
                _busy.value = false
                if (result == AuthResult.Success) gate.enable()
                onDone(result)
            }
            return
        }
        val fresh = crypto.prepareEnable()
        if (fresh !is LockCipher.Ready) {
            _busy.value = false
            return onDone(AuthResult.Failed)
        }
        val t0 = nanos()
        auth.authenticate(AuthRequest(LockTexts.ENABLE_TITLE, LockTexts.ENABLE_SUBTITLE, cipher = fresh.cipher)) { result ->
            _busy.value = false
            if (result is AuthResult.Crypto && crypto.seal(result.cipher)) {
                log("lock enabled in ${(nanos() - t0) / 1_000_000} ms")
                gate.enable()
                onDone(AuthResult.Success)
            } else {
                crypto.clear()
                onDone(if (result is AuthResult.Crypto || result == AuthResult.Success) AuthResult.Failed else result)
            }
        }
    }

    fun disable() {
        gate.disable()
        crypto?.clear()
    }

    fun setDelay(delay: LockDelay) = prefs.setDelay(delay)
}

object LockTexts {
    const val PROMPT_TITLE = "Desbloquear Orb"
    const val PROMPT_SUBTITLE = "Usa tu huella o el PIN del móvil"
    const val ENABLE_TITLE = "Activar el bloqueo de Orb"
    const val ENABLE_SUBTITLE = "Confirma que eres tú para activarlo"
    const val RENEW_SUBTITLE = "La protección del móvil cambió. Usa tu PIN para renovar el bloqueo"

    const val LOCKED_TITLE = "Desbloquea para ver tus chats"
    const val LOCKED_NOTE = "Huella, cara o PIN del móvil"
    const val UNLOCK = "Desbloquear"
    const val UNLOCK_AGAIN = "Probar otra vez"
    const val WHERE_TO_CHANGE = "Opcional · Menú › Este móvil › Bloqueo de la app"
    const val NEVER_MASTER = "Nunca pide la contraseña maestra."
    const val USE_PIN = "Usar PIN del móvil"
    const val BLOCKED = "Demasiados intentos. Espera un momento o usa el PIN del móvil."
    const val FAILED = "No se pudo comprobar. Inténtalo otra vez o usa el PIN del móvil."
    const val NOT_RECOGNIZED = "No se reconoció. Prueba otra vez."

    fun notice(n: LockNotice) = when (n) {
        LockNotice.Blocked -> BLOCKED
        LockNotice.Failed -> FAILED
        LockNotice.NotRecognized -> NOT_RECOGNIZED
    }
}

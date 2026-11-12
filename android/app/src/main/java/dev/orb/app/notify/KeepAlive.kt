package dev.orb.app.notify

import dev.orb.app.link.net.ConnectionState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** How the link to the PC stands, as far as keeping the service alive cares. */
enum class LinkKind {
    Online, Connecting, Offline,

    /** No link, or one that cannot work until something is updated: nothing to keep alive. */
    Terminal;

    companion object {
        fun of(c: ConnectionState): LinkKind = when (c) {
            is ConnectionState.Online, is ConnectionState.Attention -> Online
            ConnectionState.Connecting -> Connecting
            is ConnectionState.Offline -> Offline
            ConnectionState.Unlinked, ConnectionState.UpdateApp, ConnectionState.UpdatePc -> Terminal
        }
    }
}

/**
 * When the «Mantener conectado» service should run. It runs while the setting is on and a PC is linked, and it steps
 * aside once the PC has been out of sight for [graceMs] (away from home without a way to reach it), so the phone is
 * not kept busy for nothing. A change of network gives the PC a new chance.
 */
class KeepAlivePolicy(private val clock: () -> Long, private val graceMs: Long = 10 * 60_000L) {
    enum class Decision { Start, Stop, None }

    private var running = false
    private var parked = false
    private var offlineSince: Long? = null

    fun evaluate(enabled: Boolean, kind: LinkKind): Decision {
        val wanted = enabled && kind != LinkKind.Terminal
        if (!wanted) {
            offlineSince = null
            parked = false
            return stopIfRunning()
        }
        when (kind) {
            LinkKind.Online -> { offlineSince = null; parked = false }
            LinkKind.Offline -> {
                val since = offlineSince ?: clock().also { offlineSince = it }
                if (running && clock() - since >= graceMs) {
                    parked = true
                    return stopIfRunning()
                }
            }
            else -> Unit
        }
        if (!running && !parked) {
            running = true
            return Decision.Start
        }
        return Decision.None
    }

    /** The network changed: the PC may be reachable now, so a parked service gets a fresh window. */
    fun networkChanged() {
        parked = false
        offlineSince = null
    }

    /** Android refused to start the service (a background start); the next change tries again. */
    fun startFailed() {
        running = false
    }

    /** Milliseconds until the PC has been out of sight long enough to step aside, or null when no wait is pending. */
    fun recheckInMs(): Long? {
        val since = offlineSince ?: return null
        if (!running) return null
        return (since + graceMs - clock()).coerceAtLeast(1)
    }

    private fun stopIfRunning(): Decision =
        if (running) { running = false; Decision.Stop } else Decision.None
}

interface ServiceLauncher {
    /** True when the service was started; false when Android did not allow it now. */
    fun start(): Boolean
    fun stop()
}

interface NetworkWatcher {
    /** Calls [onChange] whenever the device gets another network; closing the result stops watching. */
    fun watch(onChange: () -> Unit): AutoCloseable
}

/**
 * Keeps [KeepAlivePolicy] informed (setting, link, network) and starts or stops the service as it decides. [kind] emits
 * only once the saved link is known, so a service started at boot is not stopped before the link is read.
 */
class KeepAliveController(
    private val policy: KeepAlivePolicy,
    private val enabled: Flow<Boolean>,
    private val kind: Flow<LinkKind>,
    private val network: NetworkWatcher,
    private val launcher: ServiceLauncher,
    private val log: (String) -> Unit = {},
) {
    fun start(scope: CoroutineScope): Job = scope.launch {
        val tick = MutableStateFlow(0)
        val watch = network.watch { policy.networkChanged(); tick.update { it + 1 } }
        try {
            combine(enabled, kind, tick) { e, k, _ -> e to k }.collectLatest { (e, k) ->
                apply(policy.evaluate(e, k))
                while (true) {
                    val wait = policy.recheckInMs() ?: break
                    delay(wait)
                    apply(policy.evaluate(e, k))
                }
            }
        } finally {
            watch.close()
        }
    }

    private fun apply(d: KeepAlivePolicy.Decision) {
        when (d) {
            KeepAlivePolicy.Decision.Start -> if (launcher.start()) log("servicio activado") else { policy.startFailed(); log("servicio no permitido ahora") }
            KeepAlivePolicy.Decision.Stop -> { launcher.stop(); log("servicio parado") }
            KeepAlivePolicy.Decision.None -> Unit
        }
    }
}

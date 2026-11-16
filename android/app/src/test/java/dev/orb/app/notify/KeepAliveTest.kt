package dev.orb.app.notify

import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.PcVersions
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.Assert.assertTrue

class KeepAlivePolicyTest {
    private var now = 0L
    private val policy = KeepAlivePolicy({ now }, graceMs = 600_000)
    private val start = KeepAlivePolicy.Decision.Start
    private val stop = KeepAlivePolicy.Decision.Stop
    private val none = KeepAlivePolicy.Decision.None

    @Test fun startsWhenOnAndLinkedAndDoesNotRestartItself() {
        assertEquals(start, policy.evaluate(true, LinkKind.Connecting))
        assertEquals(none, policy.evaluate(true, LinkKind.Online))
    }

    @Test fun neverRunsWhenOffOrWithoutALink() {
        assertEquals(none, policy.evaluate(false, LinkKind.Online))
        assertEquals(none, policy.evaluate(true, LinkKind.Terminal))
    }

    @Test fun stopsWhenSwitchedOffOrUnlinked() {
        policy.evaluate(true, LinkKind.Online)
        assertEquals(stop, policy.evaluate(false, LinkKind.Online))
        assertEquals(start, policy.evaluate(true, LinkKind.Online))
        assertEquals(stop, policy.evaluate(true, LinkKind.Terminal))
    }

    @Test fun stepsAsideAfterThePcStaysOutOfSight() {
        policy.evaluate(true, LinkKind.Online)
        assertEquals(none, policy.evaluate(true, LinkKind.Offline))
        assertEquals(600_000L, policy.recheckInMs())
        now += 599_000
        assertEquals(none, policy.evaluate(true, LinkKind.Offline))
        now += 1_000
        assertEquals(stop, policy.evaluate(true, LinkKind.Offline))
        assertEquals(null, policy.recheckInMs())
        // Parked: asking again does not bring it back by itself.
        assertEquals(none, policy.evaluate(true, LinkKind.Offline))
    }

    @Test fun comingBackOnlineCancelsTheWait() {
        policy.evaluate(true, LinkKind.Online)
        policy.evaluate(true, LinkKind.Offline)
        now += 500_000
        policy.evaluate(true, LinkKind.Online)
        assertEquals(null, policy.recheckInMs())
        now += 500_000
        assertEquals(none, policy.evaluate(true, LinkKind.Offline))
        assertEquals(600_000L, policy.recheckInMs())
    }

    @Test fun aNetworkChangeBringsAParkedServiceBack() {
        policy.evaluate(true, LinkKind.Online)
        policy.evaluate(true, LinkKind.Offline)
        now += 600_000
        policy.evaluate(true, LinkKind.Offline)
        policy.networkChanged()
        assertEquals(start, policy.evaluate(true, LinkKind.Offline))
        assertEquals(600_000L, policy.recheckInMs())
    }

    @Test fun aRefusedStartIsTriedAgainOnTheNextChange() {
        assertEquals(start, policy.evaluate(true, LinkKind.Online))
        policy.startFailed()
        assertEquals(start, policy.evaluate(true, LinkKind.Online))
    }

    @Test fun connectionStatesMapToKinds() {
        val v = PcVersions(4, 2, "3.8.4")
        assertEquals(LinkKind.Online, LinkKind.of(ConnectionState.Online("b", "PC", v)))
        assertEquals(LinkKind.Online, LinkKind.of(ConnectionState.Attention("x")))
        assertEquals(LinkKind.Offline, LinkKind.of(ConnectionState.Offline(null, null)))
        assertEquals(LinkKind.Connecting, LinkKind.of(ConnectionState.Connecting))
        assertEquals(LinkKind.Terminal, LinkKind.of(ConnectionState.Unlinked))
        assertEquals(LinkKind.Terminal, LinkKind.of(ConnectionState.UpdateApp))
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class KeepAliveControllerTest {
    private class Launcher(var allowed: Boolean = true) : ServiceLauncher {
        val events = mutableListOf<String>()
        override fun start(): Boolean { events += if (allowed) "start" else "refused"; return allowed }
        override fun stop() { events += "stop" }
    }

    private class Network : NetworkWatcher {
        var onChange: (() -> Unit)? = null
        var closed = false
        override fun watch(onChange: () -> Unit): AutoCloseable { this.onChange = onChange; return AutoCloseable { closed = true } }
    }

    private val enabled = MutableStateFlow(true)
    private val kind = MutableStateFlow(LinkKind.Online)
    private val launcher = Launcher()
    private val network = Network()

    private fun kotlinx.coroutines.test.TestScope.controller() =
        KeepAliveController(KeepAlivePolicy({ testScheduler.currentTime }, 600_000), enabled, kind, network, launcher).start(this)

    @Test fun followsTheSettingAndTheLink() = runTest {
        val job = controller()
        runCurrent()
        assertEquals(listOf("start"), launcher.events)
        enabled.value = false
        runCurrent()
        assertEquals(listOf("start", "stop"), launcher.events)
        enabled.value = true
        runCurrent()
        kind.value = LinkKind.Terminal
        runCurrent()
        assertEquals(listOf("start", "stop", "start", "stop"), launcher.events)
        job.cancel()
        runCurrent()
        assertTrue(network.closed)
    }

    @Test fun parksWhenThePcStaysOfflineAndReturnsWithTheNetwork() = runTest {
        val job = controller()
        runCurrent()
        kind.value = LinkKind.Offline
        runCurrent()
        advanceTimeBy(599_000)
        assertEquals(listOf("start"), launcher.events)
        advanceTimeBy(2_000)
        runCurrent()
        assertEquals(listOf("start", "stop"), launcher.events)
        network.onChange!!.invoke()
        runCurrent()
        assertEquals(listOf("start", "stop", "start"), launcher.events)
        job.cancel()
    }

    @Test fun aRefusedBackgroundStartIsRetriedOnTheNextChange() = runTest {
        launcher.allowed = false
        val job = controller()
        runCurrent()
        assertEquals(listOf("refused"), launcher.events)
        launcher.allowed = true
        network.onChange!!.invoke()
        runCurrent()
        assertEquals(listOf("refused", "start"), launcher.events)
        job.cancel()
    }
}

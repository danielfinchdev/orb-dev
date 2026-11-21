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
    private val park = KeepAlivePolicy.Decision.Park
    private val resume = KeepAlivePolicy.Decision.Resume
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

    @Test fun parksTheLinkAfterThePcStaysOutOfSightButKeepsTheService() {
        policy.evaluate(true, LinkKind.Online)
        assertEquals(none, policy.evaluate(true, LinkKind.Offline))
        assertEquals(600_000L, policy.recheckInMs())
        now += 599_000
        assertEquals(none, policy.evaluate(true, LinkKind.Offline))
        now += 1_000
        assertEquals(park, policy.evaluate(true, LinkKind.Offline))
        assertEquals(null, policy.recheckInMs())
        // Parked: asking again changes nothing, and the service is never started a second time.
        assertEquals(none, policy.evaluate(true, LinkKind.Offline))
    }

    @Test fun aParkedLinkResumesWhenThePcIsBackOnline() {
        policy.evaluate(true, LinkKind.Online)
        policy.evaluate(true, LinkKind.Offline)
        now += 600_000
        assertEquals(park, policy.evaluate(true, LinkKind.Offline))
        assertEquals(resume, policy.evaluate(true, LinkKind.Online))
        assertEquals(none, policy.evaluate(true, LinkKind.Online))
    }

    @Test fun switchingOffWhileParkedStopsTheService() {
        policy.evaluate(true, LinkKind.Online)
        policy.evaluate(true, LinkKind.Offline)
        now += 600_000
        policy.evaluate(true, LinkKind.Offline)
        assertEquals(stop, policy.evaluate(false, LinkKind.Offline))
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

    @Test fun aNetworkChangeBringsAParkedLinkBack() {
        policy.evaluate(true, LinkKind.Online)
        policy.evaluate(true, LinkKind.Offline)
        now += 600_000
        policy.evaluate(true, LinkKind.Offline)
        policy.networkChanged()
        assertEquals(resume, policy.evaluate(true, LinkKind.Offline))
        // A fresh window starts after that.
        assertEquals(none, policy.evaluate(true, LinkKind.Offline))
        assertEquals(600_000L, policy.recheckInMs())
    }

    @Test fun aNetworkChangeWithoutAParkedLinkResumesNothing() {
        policy.evaluate(true, LinkKind.Online)
        policy.networkChanged()
        assertEquals(none, policy.evaluate(true, LinkKind.Online))
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
    private val parks = mutableListOf<Boolean>()
    private var networkTries = 0

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
        KeepAliveController(KeepAlivePolicy({ testScheduler.currentTime }, 600_000), enabled, kind, network, launcher, park = { parks += it }, onNetwork = { networkTries++ }).start(this)

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

    @Test fun parksTheLinkWhenThePcStaysOfflineAndResumesItWithTheNetworkKeepingTheService() = runTest {
        val job = controller()
        runCurrent()
        kind.value = LinkKind.Offline
        runCurrent()
        advanceTimeBy(599_000)
        assertEquals(emptyList<Boolean>(), parks)
        advanceTimeBy(2_000)
        runCurrent()
        assertEquals(listOf(true), parks)
        network.onChange!!.invoke()
        runCurrent()
        assertEquals(listOf(true, false), parks)
        assertEquals(1, networkTries)
        // The service was started once and never stopped, so no start from the background is needed to come back.
        assertEquals(listOf("start"), launcher.events)
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

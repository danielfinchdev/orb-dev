package dev.orb.app.ui.welcome

import dev.orb.app.link.net.DiscoverProbe
import dev.orb.app.link.net.FoundPc
import dev.orb.app.link.net.LinkSession
import dev.orb.app.link.net.PairOk
import dev.orb.app.link.net.ResolvedLink
import dev.orb.app.link.net.TailscaleDiscovery
import dev.orb.app.link.net.tailscaleCandidates
import dev.orb.app.link.payload.LinkPayload
import dev.orb.app.ui.Linker
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class TailscaleSearchTest {
    private val dispatcher = UnconfinedTestDispatcher()

    @Before fun setUp() = Dispatchers.setMain(dispatcher)
    @After fun tearDown() = Dispatchers.resetMain()

    private class CountingLinker : Linker {
        var resolves = 0
        var links = 0
        override suspend fun resolve(payload: LinkPayload): Result<ResolvedLink> { resolves++; return Result.failure(IllegalStateException("not reached")) }
        override suspend fun link(link: ResolvedLink, password: String, deviceName: String): Result<PairOk> { links++; return Result.failure(IllegalStateException("not reached")) }
    }

    private fun discovery(vararg answers: Pair<String, String>) = TailscaleDiscovery(DiscoverProbe { base -> answers.toMap()[base] })

    @Test fun aFullMagicDnsNameIsTriedOverHttpsAndPlainHttpAndAShortNameOnlyOverHttp() {
        assertEquals(listOf("https://torre.example.ts.net:3131", "http://torre.example.ts.net:3131"), tailscaleCandidates(" Torre.example.ts.net. "))
        assertEquals(listOf("http://torre:3131"), tailscaleCandidates("torre"))
        assertEquals(listOf("http://100.64.0.1:3131"), tailscaleCandidates("100.64.0.1"))
    }

    @Test fun withoutTheVpnOnlyTheHttpsMagicDnsNameIsTried() {
        assertEquals(listOf("https://torre.example.ts.net:3131"), tailscaleCandidates("torre.example.ts.net", vpnActive = false))
        assertTrue(tailscaleCandidates("torre", vpnActive = false).isEmpty())
        assertTrue(tailscaleCandidates("100.64.0.1", vpnActive = false).isEmpty())
    }

    @Test fun publicOrMalformedNamesAreNeverProbed() {
        assertTrue(tailscaleCandidates("").isEmpty())
        assertTrue(tailscaleCandidates("8.8.8.8").isEmpty())
        assertTrue(tailscaleCandidates("evil.example.com/../x").let { it.isEmpty() || it.all { b -> b.startsWith("https://") } })
        assertTrue(tailscaleCandidates("a b").isEmpty())
    }

    @Test fun onlyAnswersFromAnOrbAreListedOncePerPc() = kotlinx.coroutines.test.runTest(dispatcher) {
        val d = discovery("https://torre.example.ts.net:3131" to "Torre", "http://torre.example.ts.net:3131" to "Torre")
        assertEquals(listOf(FoundPc("Torre", "https://torre.example.ts.net:3131")), d.find("torre.example.ts.net"))
        assertTrue(discovery().find("torre").isEmpty())
    }

    @Test fun findingAPcFillsTheAddressButLinksNothingAndStillNeedsTheCode() {
        val linker = CountingLinker()
        val vm = WelcomeViewModel(linker, "Test", {}, dispatcher, discovery = discovery("http://torre:3131" to "Torre"))
        vm.toggleTs()
        assertTrue(vm.state.value.tsOpen)
        vm.setTsQuery("torre")
        vm.searchTs()
        assertEquals(listOf(FoundPc("Torre", "http://torre:3131")), vm.state.value.tsFound)
        vm.pickTs(vm.state.value.tsFound.single())
        assertEquals("http://torre:3131", vm.state.value.address)
        assertEquals("", vm.state.value.code)
        // no code yet: continuing is refused before asking the PC anything
        vm.resolve()
        assertEquals(0, linker.resolves)
        assertEquals(0, linker.links)
        assertEquals(WelcomeStage.Entry, vm.state.value.stage)
        assertTrue(vm.state.value.error != null)
    }

    @Test fun anEmptySearchSaysSoAndKeepsTheQrAsTheWayOut() {
        val vm = WelcomeViewModel(CountingLinker(), "Test", {}, dispatcher, discovery = discovery())
        vm.setTsQuery("torre")
        vm.searchTs()
        assertTrue(vm.state.value.tsSearched && vm.state.value.tsFound.isEmpty() && !vm.state.value.tsSearching)
    }
}

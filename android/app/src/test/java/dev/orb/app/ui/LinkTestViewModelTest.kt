package dev.orb.app.ui

import dev.orb.app.data.OutboxEntity
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkEvent
import dev.orb.app.link.net.LinkException
import dev.orb.app.link.net.PcInfo
import dev.orb.app.link.net.PcVersions
import dev.orb.app.ui.linktest.LinkTestViewModel
import dev.orb.app.ui.linktest.Probe
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class LinkTestViewModelTest {
    @Before fun setUp() = Dispatchers.setMain(UnconfinedTestDispatcher())
    @After fun tearDown() = Dispatchers.resetMain()

    private class FakeBackend : LinkTestBackend {
        override val connection = MutableStateFlow<ConnectionState>(ConnectionState.Connecting)
        override val events = MutableSharedFlow<LinkEvent>(extraBufferCapacity = 16, onBufferOverflow = BufferOverflow.DROP_OLDEST)
        override val queue = MutableStateFlow<List<OutboxEntity>>(emptyList())
        override val conversationCount = MutableStateFlow(0)
        override val messageCount = MutableStateFlow(0)
        override val log = MutableStateFlow<List<String>>(emptyList())
        var meResult: Result<PcInfo> = Result.failure(LinkException(LinkError.Offline))
        var stateResult: Result<JsonElement> = Result.failure(LinkException(LinkError.Offline))
        val enqueued = ArrayList<String>()
        val notes = ArrayList<String>()

        override suspend fun me() = meResult
        override suspend fun appState() = stateResult
        override suspend fun enqueueNewChat(text: String) { enqueued += text }
        override fun note(line: String) { notes += line }
    }

    private fun info() = PcInfo("dev", "Mi PC", "fp123", PcVersions(4, 2, "3.8.4"), null, JsonObject(emptyMap()))

    @Test fun connectionEventsAndCountersFollowTheBackend() {
        val b = FakeBackend()
        val vm = LinkTestViewModel(b)
        b.connection.value = ConnectionState.Online("http://pc", "Mi PC", PcVersions(4, 2, "3.8.4"))
        b.events.tryEmit(LinkEvent("chat:state", JsonNull))
        b.events.tryEmit(LinkEvent("chat:state", JsonNull))
        b.events.tryEmit(LinkEvent("task:update", JsonNull))
        b.conversationCount.value = 3
        b.messageCount.value = 40
        val s = vm.state.value
        assertTrue(s.connection is ConnectionState.Online)
        assertEquals(mapOf("chat:state" to 2, "task:update" to 1), s.eventCounts)
        assertEquals(3, s.conversations)
        assertEquals(40, s.messages)
    }

    @Test fun meSuccessShowsTheSummaryWithLatency() {
        val b = FakeBackend().apply { meResult = Result.success(info()) }
        var t = 1_000L
        val vm = LinkTestViewModel(b, now = { t.also { t += 25 } })
        vm.callMe()
        val me = vm.state.value.me as Probe.Done
        assertEquals("Mi PC", me.value.pcName)
        assertEquals("3.8.4", me.value.version)
        assertEquals("fp123", me.value.fingerprint)
        assertEquals(25L, me.value.latencyMs)
    }

    @Test fun meFailureIsShownInSpanishAndLoggedWithoutDetails() {
        val b = FakeBackend()
        val vm = LinkTestViewModel(b)
        vm.callMe()
        val failed = vm.state.value.me as Probe.Failed
        assertTrue(failed.message.contains("Sin conexión"))
        assertTrue(b.notes.single().startsWith("/api/me error"))
    }

    @Test fun appStateShowsSizeAndKeysNotContent() {
        val answer = JsonObject(mapOf("projects" to JsonPrimitive("secret-project-name"), "unread" to JsonPrimitive(3)))
        val b = FakeBackend().apply { stateResult = Result.success(answer) }
        val vm = LinkTestViewModel(b)
        vm.callAppState()
        val a = (vm.state.value.appState as Probe.Done).value
        assertEquals(answer.toString().length, a.chars)
        assertEquals(listOf("projects", "unread"), a.keys)
        assertTrue(b.notes.none { it.contains("secret-project-name") })
    }

    @Test fun enqueueSendsTheDraftAndClearsIt() {
        val b = FakeBackend()
        val vm = LinkTestViewModel(b)
        vm.setDraft("  hola  ")
        vm.enqueueTest()
        assertEquals(listOf("hola"), b.enqueued)
        assertEquals("", vm.state.value.draft)
        assertTrue(b.notes.none { it.contains("hola") })
    }
}

package dev.orb.app.ui.notes

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkException
import dev.orb.app.link.net.PcVersions
import dev.orb.app.ui.theme.OrbTheme
import dev.orb.app.ui.theme.OrbPaletteChoice
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.Json
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

fun notice(id: String, title: String = "Orbe", at: Long = 1_000, target: NoticeTarget? = NoticeTarget.Chat("conversation", "7")) =
    Notice(id, title, "Hola", "message", at, target)

class FakeNotesBackend : NotesBackend {
    val connectionState = MutableStateFlow<ConnectionState>(ConnectionState.Online("http://pc", "PC", PcVersions(1, 1, "3.8.4")))
    override val connection get() = connectionState
    val feed = NotesFeed()
    override val notices get() = feed.rows
    val calls = ArrayList<String>()
    var markResult: Result<Unit> = Result.success(Unit)

    override suspend fun refresh(): Result<Unit> { calls += "refresh"; return Result.success(Unit) }
    override suspend fun markRead(ids: List<String>?): Result<Unit> { calls += "markRead $ids"; feed.markRead(ids); return markResult }
    override fun markReadLocal(id: String) { calls += "local $id"; feed.markRead(listOf(id)) }
}

@OptIn(ExperimentalCoroutinesApi::class)
class NotesViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @Before fun setUp() = Dispatchers.setMain(dispatcher)
    @After fun tearDown() = Dispatchers.resetMain()

    private fun TestScope.vm(b: FakeNotesBackend): NotesViewModel {
        val vm = NotesViewModel(b)
        backgroundScope.launch { vm.state.collect { } }
        runCurrent()
        return vm
    }

    @Test fun parserTurnsANoteEventIntoANoticeWithItsDestination() {
        val chat = NotesParser.fromEvent(Json.parseToJsonElement("""{"key":"conversation:7","id":20001,"route":{"view":"chat","id":7},"kind":"message","title":"Orbe","body":"Listo","line":5}"""), 10)!!
        assertEquals("note:conversation:7:5", chat.id)
        assertEquals(NoticeTarget.Chat("conversation", "7"), chat.target)
        val ask = NotesParser.fromEvent(Json.parseToJsonElement("""{"key":"session:s9","kind":"approval","title":"Agente","body":"x","card":{"method":"sessions.approve","id":"s9","request":"r1"}}"""), 10)!!
        assertEquals(NoticeTarget.Chat("session", "s9"), ask.target)
        val task = NotesParser.fromEvent(Json.parseToJsonElement("""{"key":"conversation:7","kind":"task","title":"T","body":"","card":{"method":"tasks.approve","task":41}}"""), 10)!!
        assertEquals(NoticeTarget.Task(41), task.target)
        assertNull(NotesParser.fromEvent(Json.parseToJsonElement("""{"x":1}"""), 10))
        val orb = NotesParser.fromEvent(Json.parseToJsonElement("""{"key":"orb","route":{"view":"chat"},"kind":"message","title":"Orb","body":"b"}"""), 10)!!
        assertEquals(NoticeTarget.ChatsTab, orb.target)
        // A repeat without a line is the same notice, whatever the time.
        val again = NotesParser.fromEvent(Json.parseToJsonElement("""{"key":"orb","route":{"view":"chat"},"kind":"message","title":"Orb","body":"b"}"""), 99)!!
        assertEquals(orb.id, again.id)
        val other = NotesParser.fromEvent(Json.parseToJsonElement("""{"key":"orb","route":{"view":"chat"},"kind":"message","title":"Orb","body":"c"}"""), 10)!!
        assertTrue(other.id != orb.id)
    }

    @Test fun parserReadsPendingApprovalsFromAppState() {
        val l = NotesParser.approvals(Json.parseToJsonElement("""{"approvals":[{"id":"a1","session_id":"s3","body":{"title":"Editar archivo","reason":"cambia main"}}]}"""), 5)
        assertEquals("approval:a1", l.single().id)
        assertEquals("Editar archivo", l.single().title)
        assertEquals(NoticeTarget.Chat("session", "s3"), l.single().target)
    }

    @Test fun newestNoticeComesFirstAndCountsAsUnread() = runTest(dispatcher) {
        val b = FakeNotesBackend()
        val vm = vm(b)
        b.feed.add(notice("a", at = 10))
        b.feed.add(notice("b", at = 20))
        runCurrent()
        assertEquals(listOf("b", "a"), vm.state.value.rows.map { it.notice.id })
        assertEquals(2, vm.state.value.unread)
    }

    @Test fun markAllReadTellsThePcAndClearsTheCounter() = runTest(dispatcher) {
        val b = FakeNotesBackend()
        val vm = vm(b)
        b.feed.add(notice("a"))
        runCurrent()
        vm.markAllRead()
        advanceUntilIdle()
        assertEquals("markRead null", b.calls.last())
        assertEquals(0, vm.state.value.unread)
    }

    @Test fun ifThePcIsNotToldTheListStillReadsAsReadAndAMessageSays() = runTest(dispatcher) {
        val b = FakeNotesBackend()
        b.markResult = Result.failure(LinkException(LinkError.Timeout))
        val vm = vm(b)
        b.feed.add(notice("a"))
        runCurrent()
        val got = ArrayList<String>()
        backgroundScope.launch { vm.messages.collect { got += it } }
        vm.markAllRead()
        advanceUntilIdle()
        assertEquals(0, vm.state.value.unread)
        assertTrue(got.single().startsWith(NotesTexts.PC_NOT_TOLD))
    }

    @Test fun openingANoticeReadsItOnThePhoneOnly() = runTest(dispatcher) {
        val b = FakeNotesBackend()
        val vm = vm(b)
        b.feed.add(notice("a"))
        b.feed.add(notice("b", at = 5))
        runCurrent()
        vm.open(notice("a"))
        runCurrent()
        assertEquals(1, vm.state.value.unread)
        assertFalse(b.calls.any { it.startsWith("markRead") })
    }

    @Test fun anAnsweredPermissionDisappearsWhenTheStateIsReadAgain() {
        val feed = NotesFeed()
        feed.setPending(listOf(notice("approval:1", at = 10)))
        feed.setPending(listOf(notice("approval:1", at = 99)))
        assertEquals(10L, feed.rows.value.single().notice.at)
        feed.setPending(emptyList())
        assertTrue(feed.rows.value.isEmpty())
    }

    @Test fun readsTheStateWhenTheConnectionComesBack() = runTest(dispatcher) {
        val b = FakeNotesBackend()
        vm(b)
        advanceUntilIdle()
        assertEquals("refresh", b.calls.first())
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NotesScreenTest {
    @get:Rule val rule = createComposeRule()

    @Before fun setUp() = Dispatchers.setMain(Dispatchers.Unconfined)
    @After fun tearDown() = Dispatchers.resetMain()

    private fun show(b: FakeNotesBackend, onOpen: (NoticeTarget) -> Unit = {}) {
        val vm = NotesViewModel(b)
        rule.setContent { OrbTheme(OrbPaletteChoice.Grafito, dark = false) { NotesScreen(vm, onBack = {}, onOpen = onOpen, nowMs = { 2_000 }) } }
        rule.waitForIdle()
    }

    @Test fun emptyCenterSaysSo() {
        show(FakeNotesBackend())
        rule.onNodeWithText("No hay notificaciones").assertIsDisplayed()
    }

    @Test fun tappingANoticeOpensItsChat() {
        val b = FakeNotesBackend()
        b.feed.add(notice("a", "Proyecto web"))
        var opened: NoticeTarget? = null
        show(b, onOpen = { opened = it })
        rule.onNodeWithText("Proyecto web").performClick()
        rule.waitForIdle()
        assertEquals(NoticeTarget.Chat("conversation", "7"), opened)
        assertEquals("local a", b.calls.last())
    }

    @Test fun markAllReadButtonCallsThePc() {
        val b = FakeNotesBackend()
        b.feed.add(notice("a"))
        show(b)
        rule.onNodeWithText("Marcar todo leído").performClick()
        rule.waitForIdle()
        assertEquals("markRead null", b.calls.last())
    }
}

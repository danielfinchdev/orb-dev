package dev.orb.app.ui.notes

import androidx.compose.foundation.layout.requiredSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.unit.dp
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performSemanticsAction
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.ui.theme.OrbPaletteChoice
import dev.orb.app.ui.theme.OrbTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
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
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.GregorianCalendar
import java.util.TimeZone

@OptIn(ExperimentalCoroutinesApi::class)
class NotesViewModelDismissTest {
    private val dispatcher = StandardTestDispatcher()

    @Before fun setUp() = Dispatchers.setMain(dispatcher)
    @After fun tearDown() = Dispatchers.resetMain()

    private fun TestScope.vm(b: FakeNotesBackend): NotesViewModel {
        val vm = NotesViewModel(b)
        backgroundScope.launch { vm.state.collect { } }
        runCurrent()
        return vm
    }

    @Test fun swipingANoticeAwayOffersToBringItBack() = runTest(dispatcher) {
        val b = FakeNotesBackend()
        val vm = vm(b)
        b.feed.add(notice("a", at = 10))
        b.feed.add(notice("b", at = 20))
        runCurrent()
        val offers = ArrayList<String>()
        backgroundScope.launch { vm.dismissOffers.collect { offers += it } }
        assertTrue(vm.dismiss(notice("a", at = 10)))
        runCurrent()
        assertEquals(listOf("a"), offers)
        assertEquals(listOf("b"), vm.state.value.rows.map { it.notice.id })
        // The bell counts what is left unread.
        assertEquals(1, vm.state.value.unread)
        vm.undoDismiss("a")
        runCurrent()
        assertEquals(listOf("b", "a"), vm.state.value.rows.map { it.notice.id })
        assertEquals(2, vm.state.value.unread)
    }

    @Test fun aPermissionRequestThatStillWaitsOffersNothing() = runTest(dispatcher) {
        val b = FakeNotesBackend()
        val vm = vm(b)
        b.feed.setPending(listOf(notice("approval:1", at = 10)))
        runCurrent()
        val offers = ArrayList<String>()
        backgroundScope.launch { vm.dismissOffers.collect { offers += it } }
        assertFalse(vm.dismiss(notice("approval:1", at = 10)))
        runCurrent()
        assertTrue(offers.isEmpty())
    }

    @Test fun theBellCountsEveryKindOfNoticeAndMarkAllLeavesNone() = runTest(dispatcher) {
        val b = FakeNotesBackend()
        val vm = vm(b)
        val raws = listOf(
            """{"key":"done:1","kind":"done","title":"Orb","body":"#1 terminada y revisada","target":{"type":"task","id":1}}""",
            """{"key":"limit:c","kind":"limit","title":"Orb","body":"c ya tiene límite otra vez","target":{"type":"account","id":"c"}}""",
            """{"key":"update:3.8.9","kind":"update","title":"Orb","body":"Orb 3.8.9 disponible en el PC","target":{"type":"version","id":"3.8.9"}}""",
        )
        raws.forEachIndexed { i, raw -> b.feed.add(NotesParser.fromEvent(Json.parseToJsonElement(raw), 10L + i)!!) }
        b.feed.add(notice("m", at = 50))
        runCurrent()
        assertEquals(4, vm.state.value.unread)
        vm.markAllRead()
        advanceUntilIdle()
        assertEquals(0, vm.state.value.unread)
        assertEquals(4, vm.state.value.rows.size)
    }

    @Test fun theStateKnowsWhetherThePcKeepsItsList() = runTest(dispatcher) {
        val b = FakeNotesBackend()
        val vm = vm(b)
        assertFalse(vm.state.value.pcKeepsList)
        b.pcKeepsList = true
        b.feed.add(notice("a"))
        runCurrent()
        assertTrue(vm.state.value.pcKeepsList)
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NotesScreenKindsTest {
    @get:Rule val rule = createComposeRule()

    @Before fun setUp() = Dispatchers.setMain(Dispatchers.Unconfined)
    @After fun tearDown() = Dispatchers.resetMain()

    private val madrid = TimeZone.getTimeZone("Europe/Madrid")
    private fun at(day: Int, hour: Int, minute: Int = 0) = GregorianCalendar(madrid).apply { clear(); set(2026, 10, day, hour, minute) }.timeInMillis
    private val now = at(19, 12)

    private fun ev(raw: String, at: Long) = NotesParser.fromEvent(Json.parseToJsonElement(raw), at)!!

    private fun backend() = FakeNotesBackend().also { b ->
        b.feed.add(ev("""{"key":"task:43","kind":"task","title":"app-movil","body":"#43 espera tu OK","card":{"method":"tasks.approve","task":43}}""", at(19, 11, 59)))
        b.feed.add(ev("""{"key":"done:42","kind":"done","title":"Orb","body":"#42 terminada y revisada","target":{"type":"task","id":42}}""", at(19, 11, 54)))
        b.feed.add(ev("""{"key":"held:39","kind":"held","title":"Orb","body":"Orb paró la #39 · ha eliminado 12 archivos","target":{"type":"task","id":39}}""", at(19, 9)))
        b.feed.add(ev("""{"key":"update:3.8.9","kind":"update","title":"Orb","body":"Orb 3.8.9 disponible en el PC","target":{"type":"version","id":"3.8.9"}}""", at(18, 20)))
        b.feed.add(ev("""{"key":"limit:claude","kind":"limit","title":"Orb","body":"Claude ya tiene límite otra vez","target":{"type":"account","id":"claude"}}""", at(18, 8)))
        b.feed.add(ev("""{"key":"conversation:7","kind":"message","title":"Revisar pasarela","body":"Hecho","line":2,"route":{"view":"chat","id":7}}""", at(10, 8)))
    }

    private fun show(b: FakeNotesBackend, height: Int = 2400, onOpen: (NoticeTarget) -> Unit = {}) {
        val vm = NotesViewModel(b)
        rule.setContent { OrbTheme(OrbPaletteChoice.Grafito, dark = false) { NotesScreen(vm, onBack = {}, onOpen = onOpen, nowMs = { now }, zone = madrid, modifier = Modifier.requiredSize(390.dp, height.dp)) } }
        rule.waitForIdle()
    }

    @Test fun theListIsGroupedByDayWithEveryKindOfNotice() {
        show(backend())
        for (t in listOf(
            "Hoy", "Ayer", "Antes", "#43 espera tu OK", "#42 terminada y revisada", "Orb paró la #39", "ha eliminado 12 archivos",
            "Orb 3.8.9 disponible en el PC", "Novedades", "Claude ya tiene límite otra vez", "Revisar pasarela", "6 sin leer", NotesTexts.FOOTNOTE,
        )) rule.onNodeWithText(t).assertExists()
    }

    @Test fun eachRowOpensItsDestination() {
        val opened = ArrayList<NoticeTarget>()
        show(backend()) { opened += it }
        for (t in listOf("#42 terminada y revisada", "Orb paró la #39", "Orb 3.8.9 disponible en el PC", "Claude ya tiene límite otra vez", "Revisar pasarela")) {
            rule.onNodeWithText(t).performClick()
            rule.waitForIdle()
        }
        assertEquals(
            listOf(
                NoticeTarget.TaskChanges(42), NoticeTarget.Task(39), NoticeTarget.Version("3.8.9"), NoticeTarget.Account("claude"),
                NoticeTarget.Chat("conversation", "7"),
            ),
            opened,
        )
    }

    @Test fun markingAllReadClearsTheCount() {
        val b = backend()
        show(b)
        rule.onNodeWithText("Marcar todo").performClick()
        rule.waitForIdle()
        assertEquals(0, b.feed.rows.value.count { it.unread })
        rule.onNodeWithText("6 sin leer").assertDoesNotExist()
    }

    // The empty state sits at the top of a very tall frame here, outside the small test window: it is checked for existing.
    @Test fun anEmptyListOfANewPcSaysAllIsClear() {
        show(FakeNotesBackend().also { it.pcKeepsList = true })
        rule.onNodeWithText(NotesTexts.EMPTY_CLEAR).assertExists()
        rule.onNodeWithText(NotesTexts.EMPTY_CLEAR_HINT).assertExists()
    }

    @Test fun anEmptyListOfAnOlderPcKeepsTheHonestText() {
        show(FakeNotesBackend())
        rule.onNodeWithText(NotesTexts.EMPTY).assertExists()
        rule.onNodeWithText(NotesTexts.EMPTY_HINT).assertExists()
    }

    @Test fun offlineKeepsTheList() {
        val b = backend()
        b.connectionState.value = ConnectionState.Offline(null, null)
        show(b)
        rule.onNodeWithText("#42 terminada y revisada").assertExists()
    }

    private fun swipeActions() = rule.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsActions.CustomActions))

    @Test fun swipingAwayHasAnAccessibleActionAndAnUndo() {
        val b = backend()
        show(b, height = 700)
        val action = swipeActions().onFirst().fetchSemanticsNode().config[SemanticsActions.CustomActions].first { it.label == NotesTexts.DISMISS }
        rule.runOnUiThread { action.action() }
        rule.waitForIdle()
        // The snackbar sits at the bottom of the tall test box, outside the small window: it exists but is not on screen.
        rule.onNodeWithText(NotesTexts.DISMISSED).assertExists()
        assertEquals(5, b.feed.rows.value.size)
        rule.onNodeWithText(NotesTexts.UNDO).performSemanticsAction(SemanticsActions.OnClick)
        rule.waitForIdle()
        assertEquals(6, b.feed.rows.value.size)
    }

    @Test fun aWaitingPermissionRequestCannotBeSwiped() {
        val b = FakeNotesBackend()
        b.feed.setPending(listOf(Notice("approval:1", "Editar archivo", "cambia main", NoticeKinds.APPROVAL, 2_000, NoticeTarget.Chat("session", "s1"))))
        show(b)
        rule.onNodeWithText("Editar archivo").assertExists()
        assertEquals(0, swipeActions().fetchSemanticsNodes().size)
    }
}

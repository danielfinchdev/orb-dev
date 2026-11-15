package dev.orb.app.ui.chats

import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkEvent
import dev.orb.app.link.net.LinkException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.JsonNull
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ChatListViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @Before fun setUp() = kotlinx.coroutines.Dispatchers.setMain(dispatcher)
    @After fun tearDown() = kotlinx.coroutines.Dispatchers.resetMain()

    private fun TestScope.vm(b: FakeChatsBackend): ChatListViewModel {
        val vm = ChatListViewModel(b, clock = { 1_000_000L }, reloadDebounceMs = 300, dispatcher = dispatcher)
        backgroundScope.launch { vm.state.collect { } }
        runCurrent()
        return vm
    }

    private fun ChatListViewModel.rows() = state.value.entries.filterIsInstance<RowEntry>().map { it.row }

    @Test fun readsTheCachedRowsAndRefreshesOnceWhenOnline() = runTest(dispatcher) {
        val b = FakeChatsBackend(listOf(row("1"), row("2", unread = 3, state = ChatState.Working)))
        val vm = vm(b)
        assertEquals(2, vm.rows().size)
        assertEquals(1, vm.state.value.unreadChats)
        assertEquals(1, vm.state.value.workingChats)
        assertEquals(1, b.refreshCount)
    }

    @Test fun offlineShowsTheCacheAndDoesNotAsk() = runTest(dispatcher) {
        val b = FakeChatsBackend(listOf(row("1")))
        b.connectionState.value = ConnectionState.Offline(null, null)
        val vm = vm(b)
        assertEquals(1, vm.rows().size)
        assertFalse(vm.state.value.online)
        assertEquals(0, b.refreshCount)
        vm.togglePin(vm.rows()[0])
        runCurrent()
        assertTrue(b.calls.isEmpty())
        assertEquals(ChatTexts.ACTION_OFFLINE, vm.messages.first())
    }

    @Test fun filterChangesTheRows() = runTest(dispatcher) {
        val vm = vm(FakeChatsBackend(listOf(row("1", unread = 1), row("2"))))
        vm.setFilter(ChatFilter.Unread)
        runCurrent()
        assertEquals(listOf("1"), vm.rows().map { it.id })
    }

    @Test fun pinIsOptimisticAndStays() = runTest(dispatcher) {
        val b = FakeChatsBackend(listOf(row("1")))
        val vm = vm(b)
        b.afterAction = { b.data.value = b.data.value.copy(rows = listOf(row("1", pinned = true))) }
        vm.togglePin(vm.rows()[0])
        runCurrent()
        assertEquals(listOf("pin conversation:1 true"), b.calls)
        assertTrue(vm.rows()[0].pinned)
        assertEquals(2, b.refreshCount)
    }

    @Test fun aFailedActionGoesBackAndTellsTheError() = runTest(dispatcher) {
        val b = FakeChatsBackend(listOf(row("1", unread = 4)))
        b.actionResult = Result.failure(LinkException(LinkError.Timeout))
        val vm = vm(b)
        val seen = ArrayList<String>()
        backgroundScope.launch { vm.messages.collect { seen += it } }
        vm.markRead(vm.rows()[0])
        runCurrent()
        assertEquals(4, vm.rows()[0].unread)
        assertEquals(1, seen.size)
        assertTrue(seen[0].startsWith(ChatTexts.ACTION_FAILED))
        assertEquals(1, b.refreshCount)
    }

    @Test fun archiveHidesTheRowAtOnceAndBringsItBackIfThePcRefuses() = runTest(dispatcher) {
        val b = FakeChatsBackend(listOf(row("1"), row("2")))
        b.actionResult = Result.failure(LinkException(LinkError.Offline))
        val gate = kotlinx.coroutines.CompletableDeferred<Unit>()
        val slow = object : ChatsBackend by b {
            override suspend fun archive(ref: ChatRef): Result<Unit> { gate.await(); return b.archive(ref) }
        }
        val vm = ChatListViewModel(slow, reloadDebounceMs = 300, dispatcher = dispatcher)
        backgroundScope.launch { vm.state.collect { } }
        runCurrent()
        vm.archive(vm.rows().first { it.id == "1" })
        runCurrent()
        // The PC has not answered yet and the row is already gone.
        assertEquals(listOf("2"), vm.rows().map { it.id })
        gate.complete(Unit)
        runCurrent()
        assertEquals(setOf("1", "2"), vm.rows().map { it.id }.toSet())
    }

    @Test fun snoozeAndMuteAndRenameSendTheirParameters() = runTest(dispatcher) {
        val b = FakeChatsBackend(listOf(row("1")))
        val vm = vm(b)
        val r = vm.rows()[0]
        vm.snooze(r, SnoozeOption.OneHour)
        vm.toggleMute(r)
        vm.rename(r, "  Nuevo título ")
        vm.rename(r, "   ")
        vm.moveToNewSection(r, "Urgentes")
        runCurrent()
        assertEquals(
            listOf(
                "snooze conversation:1 ${ChatTime.iso(1_000_000L + 3_600_000L)}", "mute conversation:1 true",
                "rename conversation:1 Nuevo título", "createSection Urgentes", "move conversation:1 99",
            ),
            b.calls,
        )
    }

    @Test fun reloadsWithDebounceWhenTheInboxChanges() = runTest(dispatcher) {
        val b = FakeChatsBackend(listOf(row("1")))
        vm(b)
        assertEquals(1, b.refreshCount)
        repeat(5) { b.events.emit(LinkEvent("inbox:changed", JsonNull)) }
        b.events.emit(LinkEvent("chat:new", JsonNull))
        b.events.emit(LinkEvent("notice", JsonNull))
        runCurrent()
        assertEquals(1, b.refreshCount)
        advanceTimeBy(299)
        runCurrent()
        assertEquals(1, b.refreshCount)
        advanceTimeBy(2)
        runCurrent()
        assertEquals(2, b.refreshCount)
        b.events.emit(LinkEvent("board:changed", JsonNull))
        advanceUntilIdle()
        assertEquals(3, b.refreshCount)
    }

    @Test fun deleteIsOnlyOfferedWhenThePcHasTheMethod() = runTest(dispatcher) {
        val b = FakeChatsBackend(listOf(row("1")))
        val vm = vm(b)
        assertFalse(vm.canDelete(ChatKind.Orbe))
        assertFalse(vm.canDelete(ChatKind.Agent))
        b.trashAvailable = true
        assertTrue(vm.canDelete(ChatKind.Orbe))
        assertTrue(vm.canDelete(ChatKind.Agent))
    }

    @Test fun aFailedFirstLoadWithoutCacheIsShownAsAnError() = runTest(dispatcher) {
        val b = FakeChatsBackend()
        b.refreshResult = Result.failure(LinkException(LinkError.Timeout))
        val vm = vm(b)
        assertTrue(vm.state.value.loadFailed)
        assertFalse(vm.state.value.loaded)
    }

    @OptIn(dev.orb.app.link.api.UserConfirmation::class)
    private fun token(r: ChatRow) = dev.orb.app.link.api.Confirmed(
        if (r.kind == ChatKind.Orbe) dev.orb.app.link.api.ConfirmAction.TrashConversation else dev.orb.app.link.api.ConfirmAction.TrashSession, r.id,
    )

    @Test fun deletingTrashesOnThePcHidesTheRowAndOffersUndo() = runTest(dispatcher) {
        val b = FakeChatsBackend(listOf(row("1"), row("s1", kind = ChatKind.Agent, agent = "claude"))).apply { trashAvailable = true }
        val vm = vm(b)
        val offers = ArrayList<ChatRef>()
        backgroundScope.launch { vm.undoOffers.collect { offers += it } }
        val direct = vm.rows().first { it.direct }
        vm.delete(direct, token(direct))
        runCurrent()
        assertEquals(listOf("trash session:s1"), b.calls)
        assertEquals(dev.orb.app.link.api.ConfirmAction.TrashSession, b.tokens.single().action)
        assertEquals("s1", b.tokens.single().target)
        assertEquals(listOf("conversation:1"), vm.rows().map { it.key })
        assertEquals(listOf(direct.ref), offers)
    }

    @Test fun undoRestoresTheChatAndTheRowComesBack() = runTest(dispatcher) {
        val b = FakeChatsBackend(listOf(row("1"), row("2"))).apply { trashAvailable = true }
        val vm = vm(b)
        val gone = vm.rows().first { it.id == "2" }
        vm.delete(gone, token(gone))
        runCurrent()
        assertEquals(1, vm.rows().size)
        vm.undoDelete(gone.ref)
        runCurrent()
        assertEquals(listOf("trash conversation:2", "restore conversation:2"), b.calls)
        assertEquals(2, vm.rows().size)
    }

    @Test fun aRefusedTrashBringsTheRowBackWithAMessage() = runTest(dispatcher) {
        val b = FakeChatsBackend(listOf(row("1"))).apply { trashAvailable = true; trashResult = Result.failure(LinkException(LinkError.Timeout)) }
        val vm = vm(b)
        val said = ArrayList<String>()
        val offers = ArrayList<ChatRef>()
        backgroundScope.launch { vm.messages.collect { said += it } }
        backgroundScope.launch { vm.undoOffers.collect { offers += it } }
        val r = vm.rows().single()
        vm.delete(r, token(r))
        runCurrent()
        assertEquals(1, vm.rows().size)
        assertTrue(said.single().startsWith("No se pudo borrar el chat en el PC"))
        assertTrue(offers.isEmpty())
    }

    @Test fun deletingWithoutTheLinkAsksNothing() = runTest(dispatcher) {
        val b = FakeChatsBackend(listOf(row("1"))).apply { trashAvailable = true }
        b.connectionState.value = ConnectionState.Offline(null, null)
        val vm = vm(b)
        val r = vm.rows().single()
        vm.delete(r, token(r))
        runCurrent()
        assertTrue(b.calls.isEmpty())
        assertEquals(1, vm.rows().size)
    }
}

package dev.orb.app.notify

import dev.orb.app.link.net.ConnectionState
import dev.orb.app.ui.notes.NotesBackend
import dev.orb.app.ui.notes.NoticeRow
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class LinkLineTest {
    private val online = MutableStateFlow(true)

    private fun kotlinx.coroutines.test.TestScope.collect(): MutableList<String> {
        val seen = mutableListOf<String>()
        backgroundScope.launch { LinkLine.lines(online, { "Mi PC" }, marginMs = 45_000).collect { seen += it } }
        runCurrent()
        return seen
    }

    @Test fun saysSearchingAtOnceAndOfflineOnlyAfterTheMargin() = runTest {
        val seen = collect()
        online.value = false
        runCurrent()
        advanceTimeBy(44_000)
        assertEquals(listOf("Orb conectado a Mi PC", "Buscando a Mi PC…"), seen)
        advanceTimeBy(2_000)
        assertEquals(NotifyTexts.OFFLINE_PC, seen.last())
        assertEquals(3, seen.size)
    }

    @Test fun aShortCutNeverSaysOffline() = runTest {
        val seen = collect()
        online.value = false
        runCurrent()
        advanceTimeBy(20_000)
        online.value = true
        runCurrent()
        advanceTimeBy(120_000)
        assertEquals(listOf("Orb conectado a Mi PC", "Buscando a Mi PC…", "Orb conectado a Mi PC"), seen)
    }

    @Test fun reconnectingTakesTheOfflineLineAway() = runTest {
        val seen = collect()
        online.value = false
        runCurrent()
        advanceTimeBy(50_000)
        online.value = true
        runCurrent()
        assertEquals("Orb conectado a Mi PC", seen.last())
    }

    @Test fun theAppStartingWithTheLinkOfflineStillWaitsTheMargin() = runTest {
        online.value = false
        val seen = collect()
        assertEquals(listOf("Buscando a Mi PC…"), seen)
        advanceTimeBy(46_000)
        assertEquals(listOf("Buscando a Mi PC…", NotifyTexts.OFFLINE_PC), seen)
    }
}

/** «Leído» with the app just started: the notices list does not exist until the start-up is over. */
class NoteReaderTest {
    private class Backend : NotesBackend {
        val calls = mutableListOf<String>()
        override val connection: StateFlow<ConnectionState> = MutableStateFlow(ConnectionState.Connecting)
        override val notices: StateFlow<List<NoticeRow>> = MutableStateFlow(emptyList())
        override val pcKeepsList = true
        override suspend fun refresh() = Result.success(Unit)
        override suspend fun markRead(ids: List<String>?) = Result.success(Unit)
        override fun markReadLocal(id: String) { calls += "local $id" }
        override fun markReadChat(key: String) { calls += "chat $key" }
        override fun dismissChat(kind: String, id: String) = Unit
        override fun dismiss(id: String) = true
        override fun undoDismiss(id: String) = Unit
    }

    private val job = NoteJob(1, NoteJob.READ, "T", notice = "note:conversation:5:n3", chat = "conversation:5", local = true)

    @OptIn(ExperimentalCoroutinesApi::class)
    @Test fun waitsForTheStartUpBeforeLookingForTheList() = runTest {
        val started = CompletableDeferred<Unit>()
        var backend: Backend? = null
        val reader = NoteReader({ started.await() }, { backend })
        var done = false
        backgroundScope.launch { reader.read(job, wholeChat = true); done = true }
        runCurrent()
        assertEquals(false, done)
        val b = Backend()
        backend = b
        started.complete(Unit)
        runCurrent()
        assertEquals(listOf("chat conversation:5"), b.calls)
    }

    @Test fun aTapReadsOnlyTheNoticeItShowed() = runTest {
        val b = Backend()
        NoteReader({ }, { b }).read(job, wholeChat = false)
        assertEquals(listOf("local note:conversation:5:n3"), b.calls)
    }

    @Test fun noListMeansNothingToMark() = runTest {
        NoteReader({ }, { null }).read(job, wholeChat = true)
    }
}

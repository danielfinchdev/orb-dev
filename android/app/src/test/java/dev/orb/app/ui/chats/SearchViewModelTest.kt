package dev.orb.app.ui.chats

import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class SearchViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @Before fun setUp() = kotlinx.coroutines.Dispatchers.setMain(dispatcher)
    @After fun tearDown() = kotlinx.coroutines.Dispatchers.resetMain()

    private fun results(title: String) = SearchResults(listOf(row("1", title = title)), emptyList(), listOf(SearchTask(1, "t", "running", null, null)), emptyList())

    @Test fun lessThanTwoLettersDoNotCallThePc() = runTest(dispatcher) {
        val b = FakeChatsBackend()
        val vm = SearchViewModel(b, 250)
        runCurrent()
        vm.setQuery("a")
        advanceTimeBy(1000)
        runCurrent()
        assertTrue(b.searches.isEmpty())
        assertEquals(SearchPhase.Idle, vm.state.value.phase)
    }

    @Test fun debouncesAndGroupsTheAnswer() = runTest(dispatcher) {
        val b = FakeChatsBackend()
        b.searchResult = Result.success(results("Carrito"))
        val vm = SearchViewModel(b, 250)
        runCurrent()
        vm.setQuery("ca")
        advanceTimeBy(100); vm.setQuery("car")
        advanceTimeBy(200); runCurrent()
        assertTrue(b.searches.isEmpty())
        advanceTimeBy(100); runCurrent()
        assertEquals(listOf("car"), b.searches)
        val s = vm.state.value
        assertEquals(SearchPhase.Done, s.phase)
        assertEquals(2, s.count(SearchScope.All))
        assertEquals(1, s.count(SearchScope.Chats))
        assertEquals(1, s.count(SearchScope.Tasks))
    }

    @Test fun aNewTextCancelsTheSearchInFlight() = runTest(dispatcher) {
        val b = FakeChatsBackend()
        b.searchGate = CompletableDeferred()
        b.searchResult = Result.success(results("Viejo"))
        val vm = SearchViewModel(b, 250)
        runCurrent()
        vm.setQuery("uno")
        advanceTimeBy(260); runCurrent()
        assertEquals(SearchPhase.Searching, vm.state.value.phase)
        val second = FakeChatsBackend()
        vm.setQuery("dos")
        advanceTimeBy(260); runCurrent()
        assertEquals(listOf("uno", "dos"), b.searches)
        b.searchResult = Result.success(results("Nuevo"))
        b.searchGate!!.complete(Unit)
        runCurrent()
        // The first search was dropped: only the answer for the second text is shown.
        assertEquals("Nuevo", vm.state.value.results.chats.single().title)
        assertEquals(0, second.searches.size)
    }

    @Test fun offlineSearchesTheSavedChats() = runTest(dispatcher) {
        val b = FakeChatsBackend()
        b.connectionState.value = ConnectionState.Offline(null, null)
        b.savedResult = results("Guardado")
        val vm = SearchViewModel(b, 250)
        runCurrent()
        vm.setQuery("gu")
        advanceTimeBy(260); runCurrent()
        assertTrue(b.searches.isEmpty())
        assertEquals(SearchPhase.Offline, vm.state.value.phase)
        assertEquals("Guardado", vm.state.value.results.chats.single().title)
    }

    @Test fun aFailureIsAnError() = runTest(dispatcher) {
        val b = FakeChatsBackend()
        b.searchResult = Result.failure(LinkException(LinkError.Timeout))
        val vm = SearchViewModel(b, 250)
        runCurrent()
        vm.setQuery("zz")
        advanceTimeBy(260); runCurrent()
        assertEquals(SearchPhase.Error, vm.state.value.phase)
    }
}

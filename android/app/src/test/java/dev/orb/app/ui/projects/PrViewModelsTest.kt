package dev.orb.app.ui.projects

import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.Json
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class PrViewModelsTest {
    private val dispatcher = StandardTestDispatcher()

    @Before fun setUp() = kotlinx.coroutines.Dispatchers.setMain(dispatcher)
    @After fun tearDown() = kotlinx.coroutines.Dispatchers.resetMain()

    @Test fun parsesTheListAndTheDetailWithChecks() {
        val list = PrParser.list(
            Json.parseToJsonElement("""[{"number":4,"title":"Uno","headRefName":"dev","baseRefName":"main","isDraft":true,"author":"ana","reviewDecision":null,"mergeable":"MERGEABLE"},{"x":1}]"""),
        )
        assertEquals(1, list.size)
        assertEquals(PrRow(4, "Uno", "dev", "main", true, "ana", null, null, "MERGEABLE"), list[0])
        val d = PrParser.detail(
            Json.parseToJsonElement(
                """{"number":4,"title":"Uno","body":"b","state":"OPEN","headRefName":"dev","baseRefName":"main","isDraft":false,"author":"ana","mergeable":"CONFLICTING",
                    "additions":5,"deletions":1,"changedFiles":2,"checks":[{"name":"build","status":"COMPLETED","conclusion":"SUCCESS"},{"name":"lint","status":"IN_PROGRESS","conclusion":null},{"name":"t","status":"COMPLETED","conclusion":"FAILURE"}]}""",
            ),
        )!!
        assertTrue(d.open)
        assertEquals(listOf(true, false, false), d.checks.map { it.passed })
        assertEquals(listOf(false, false, true), d.checks.map { it.failed })
        assertEquals("1 de 3 correctas · 1 con fallo", ProjectTexts.checksSummary(d.checks))
        assertEquals("Tiene conflictos", ProjectTexts.mergeable(d.mergeable))
        assertNull(PrParser.detail(Json.parseToJsonElement("""{"title":"sin número"}""")))
    }

    @Test fun listLoadsAndShowsThePcErrorAsItComes() = runTest(dispatcher) {
        val b = FakeProjectsBackend()
        b.prList = Result.success(listOf(PrRow(4, "Uno", "dev", "main", false, "ana", null, null, null)))
        val vm = PrListViewModel(b, "app")
        advanceUntilIdle()
        assertEquals(1, vm.state.value.prs.size)
        assertNull(vm.state.value.error)
        b.prList = Result.failure(LinkException(LinkError.Refused(500, "No has iniciado sesión en gh", null)))
        vm.refresh()
        advanceUntilIdle()
        assertEquals("No has iniciado sesión en gh", vm.state.value.error)
        assertFalse(vm.state.value.loading)
    }

    @Test fun detailLoadsAndKeepsTheLastAnswerWhenARefreshFails() = runTest(dispatcher) {
        val b = FakeProjectsBackend()
        b.prResults[4] = Result.success(prDetail(4))
        val vm = PrDetailViewModel(b, "app", 4)
        advanceUntilIdle()
        assertEquals("OPEN", vm.state.value.pr?.state)
        b.prResults[4] = Result.failure(LinkException(LinkError.Timeout))
        vm.refresh()
        advanceUntilIdle()
        assertEquals(4, vm.state.value.pr?.number)
        assertTrue(vm.state.value.error != null)
    }
}

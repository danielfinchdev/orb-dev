package dev.orb.app.ui.projects

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onLast
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.orb.app.link.api.ApiMethods
import dev.orb.app.link.api.ConfirmAction
import dev.orb.app.link.api.Confirmed
import dev.orb.app.link.api.UserConfirmation
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkException
import dev.orb.app.ui.theme.OrbTheme
import dev.orb.app.ui.theme.ThemeChoice
import kotlinx.coroutines.CompletableDeferred
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

@OptIn(UserConfirmation::class)
private fun token(target: String, action: ConfirmAction = ConfirmAction.MergePr) = Confirmed(action, target)

@OptIn(ExperimentalCoroutinesApi::class)
class PrMergeViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @Before fun setUp() = kotlinx.coroutines.Dispatchers.setMain(dispatcher)
    @After fun tearDown() = kotlinx.coroutines.Dispatchers.resetMain()

    private fun TestScope.vm(b: FakeProjectsBackend, number: Int = 4): PrDetailViewModel {
        val vm = PrDetailViewModel(b, "app", number)
        backgroundScope.launch { vm.state.collect { } }
        runCurrent()
        advanceUntilIdle()
        return vm
    }

    private fun backend(detail: PrDetail = prDetail(4)) = FakeProjectsBackend().also { it.prResults[detail.number] = Result.success(detail) }

    @Test fun mergeAsksThePcOnceThenReadsTheRealState() = runTest(dispatcher) {
        val b = backend()
        val vm = vm(b)
        assertTrue(vm.state.value.canMerge)
        vm.merge("squash", token("app#4"))
        advanceUntilIdle()
        assertEquals(listOf("pr app#4", "merge app#4 squash", "pr app#4"), b.calls)
        assertEquals("MERGED", vm.state.value.pr?.state)
        assertFalse(vm.state.value.canMerge)
        assertFalse(vm.state.value.merging)
    }

    @Test fun aTokenForAnotherPullRequestOrActionNeverReachesThePc() = runTest(dispatcher) {
        val b = backend()
        val vm = vm(b)
        vm.merge("merge", token("app#5"))
        vm.merge("merge", token("app#4", ConfirmAction.TrashSession))
        vm.merge("force", token("app#4"))
        advanceUntilIdle()
        assertEquals(listOf("pr app#4"), b.calls)
    }

    @Test fun aSecondTapWhileTheMergeRunsIsIgnored() = runTest(dispatcher) {
        val b = backend()
        val vm = vm(b)
        val gate = CompletableDeferred<Unit>()
        b.gate = gate
        vm.merge("merge", token("app#4"))
        vm.merge("merge", token("app#4"))
        vm.merge("squash", token("app#4"))
        runCurrent()
        assertTrue(vm.state.value.merging)
        assertEquals(1, b.calls.count { it.startsWith("merge") })
        gate.complete(Unit)
        advanceUntilIdle()
        assertEquals(1, b.calls.count { it.startsWith("merge") })
    }

    @Test fun mergedClosedAndDraftOffNoMerge() = runTest(dispatcher) {
        for (d in listOf(prDetail(4, state = "MERGED"), prDetail(4, state = "CLOSED"), prDetail(4, draft = true))) {
            val b = backend(d)
            val vm = vm(b)
            assertFalse(vm.state.value.canMerge)
            vm.merge("merge", token("app#4"))
            advanceUntilIdle()
            assertTrue(b.calls.none { it.startsWith("merge") })
        }
    }

    @Test fun aPcWithoutMergeHidesIt() = runTest(dispatcher) {
        val b = backend()
        b.unavailable = setOf(ApiMethods.PROJECTS_MERGE_PR.name)
        val vm = vm(b)
        assertFalse(vm.state.value.canMerge)
    }

    @Test fun anErrorShowsThePcsWordsAndIsNeverRetried() = runTest(dispatcher) {
        val b = backend()
        b.mergeResult = Result.failure(LinkException(LinkError.Refused(500, "gh no tiene la sesión iniciada", null)))
        val vm = vm(b)
        vm.merge("merge", token("app#4"))
        advanceUntilIdle()
        advanceUntilIdle()
        assertEquals("gh no tiene la sesión iniciada", vm.state.value.error)
        assertEquals(1, b.calls.count { it.startsWith("merge") })
        assertEquals("OPEN", vm.state.value.pr?.state)
        // The person may decide to try again; nothing does it for them.
        assertTrue(vm.state.value.canMerge)
        assertFalse(vm.state.value.merging)
    }

    @Test fun offlineDoesNotCallThePc() = runTest(dispatcher) {
        val b = backend()
        val vm = vm(b)
        b.connectionState.value = ConnectionState.Offline(null, null)
        advanceUntilIdle()
        vm.merge("merge", token("app#4"))
        advanceUntilIdle()
        assertTrue(b.calls.none { it.startsWith("merge") })
    }

    @Test fun ifTheStateCannotBeReadBackTheButtonStaysHidden() = runTest(dispatcher) {
        val b = backend()
        val vm = vm(b)
        // The next read of the pull request fails once the merge has been sent.
        b.gate = null
        b.mergeResult = Result.success(Unit)
        b.prResults.remove(4)
        vm.merge("merge", token("app#4"))
        advanceUntilIdle()
        assertFalse(vm.state.value.canMerge)
        assertEquals(1, b.calls.count { it.startsWith("merge") })
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class PrMergeScreenTest {
    @get:Rule val rule = createComposeRule()

    @Before fun setUp() = Dispatchers.setMain(Dispatchers.Unconfined)
    @After fun tearDown() = Dispatchers.resetMain()

    private fun show(b: FakeProjectsBackend) {
        rule.setContent { OrbTheme(ThemeChoice.Orbita, dark = false, dynamic = false) { PrDetailScreen(PrDetailViewModel(b, "app", 4), {}) } }
        rule.waitForIdle()
    }

    private fun backend(d: PrDetail = prDetail(4)) = FakeProjectsBackend().also { it.prResults[4] = Result.success(d) }

    @Test fun theDialogNamesThePullRequestAndMethodBeforeAnythingIsSent() {
        val b = backend()
        show(b)
        rule.onNodeWithText("Fusionar").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("app · #4 Arreglar el pie").assertIsDisplayed()
        rule.onNodeWithText("Merge (commit de fusión)").assertIsDisplayed()
        rule.onNodeWithText("Squash (un solo commit)").assertIsDisplayed()
        rule.onNodeWithText("Rebase").assertIsDisplayed()
        assertTrue(b.calls.none { it.startsWith("merge") })
        rule.onNodeWithText("Cancelar").performClick()
        rule.waitForIdle()
        assertTrue(b.calls.none { it.startsWith("merge") })
    }

    @Test fun confirmingSendsTheChosenMethodAndShowsTheNewState() {
        val b = backend()
        show(b)
        rule.onNodeWithText("Fusionar").performClick()
        rule.onNodeWithText("Squash (un solo commit)").performClick()
        // The dialog's own button is the second «Fusionar» on screen.
        rule.onAllFusionar().performClick()
        rule.waitForIdle()
        assertEquals(1, b.calls.count { it == "merge app#4 squash" })
        rule.onNodeWithText("Fusionada").assertIsDisplayed()
        assertEquals(0, rule.onAllNodesWithTextCount("Fusionar"))
    }

    @Test fun aMergedPullRequestHasNoButton() {
        show(backend(prDetail(4, state = "MERGED")))
        assertEquals(0, rule.onAllNodesWithTextCount("Fusionar"))
    }

    @Test fun thePcsErrorIsShownAsItComes() {
        val b = backend()
        b.mergeResult = Result.failure(LinkException(LinkError.Refused(500, "La rama está protegida", null)))
        show(b)
        rule.onNodeWithText("Fusionar").performClick()
        rule.onAllFusionar().performClick()
        rule.waitForIdle()
        rule.onNodeWithText("La rama está protegida").assertIsDisplayed()
    }
}

private fun androidx.compose.ui.test.junit4.ComposeTestRule.onAllNodesWithTextCount(t: String) =
    onAllNodesWithText(t).fetchSemanticsNodes().size

private fun androidx.compose.ui.test.junit4.ComposeTestRule.onAllFusionar() = onAllNodesWithText("Fusionar").onLast()

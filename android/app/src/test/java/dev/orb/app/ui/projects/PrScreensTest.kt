package dev.orb.app.ui.projects

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkException
import dev.orb.app.ui.theme.OrbTheme
import dev.orb.app.ui.theme.ThemeChoice
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class PrScreensTest {
    @get:Rule val rule = createComposeRule()

    @Before fun setUp() = Dispatchers.setMain(Dispatchers.Unconfined)
    @After fun tearDown() = Dispatchers.resetMain()

    @Test fun listShowsPrsAndOpensOne() {
        val b = FakeProjectsBackend()
        b.prList = Result.success(listOf(PrRow(4, "Arreglar el pie", "dev", "main", false, "ana", null, null, null)))
        var opened = 0
        rule.setContent { OrbTheme(ThemeChoice.Orbita, dark = false, dynamic = false) { PrListScreen(PrListViewModel(b, "app"), {}, { opened = it }) } }
        rule.waitForIdle()
        rule.onNodeWithText("#4 Arreglar el pie").performClick()
        assertEquals(4, opened)
    }

    @Test fun listShowsThePcErrorWithRetry() {
        val b = FakeProjectsBackend()
        b.prList = Result.failure(LinkException(LinkError.Refused(500, "gh no está instalado", null)))
        rule.setContent { OrbTheme(ThemeChoice.Orbita, dark = false, dynamic = false) { PrListScreen(PrListViewModel(b, "app"), {}, {}) } }
        rule.waitForIdle()
        rule.onNodeWithText("gh no está instalado").assertIsDisplayed()
        rule.onNodeWithText("Reintentar").assertIsDisplayed()
    }

    @Test fun detailShowsStateBranchAndChecks() {
        val b = FakeProjectsBackend()
        b.prResults[4] = Result.success(prDetail(4, checks = listOf(PrCheck("build", "COMPLETED", "SUCCESS"), PrCheck("lint", "COMPLETED", "FAILURE"))))
        rule.setContent { OrbTheme(ThemeChoice.Orbita, dark = false, dynamic = false) { PrDetailScreen(PrDetailViewModel(b, "app", 4), {}) } }
        rule.waitForIdle()
        rule.onNodeWithText("Abierta").assertIsDisplayed()
        rule.onNodeWithText("dev → main").assertIsDisplayed()
        rule.onNodeWithText("1 de 2 correctas · 1 con fallo").assertIsDisplayed()
        rule.onNodeWithText("✗ lint").assertIsDisplayed()
    }
}

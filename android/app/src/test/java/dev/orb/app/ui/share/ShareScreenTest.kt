package dev.orb.app.ui.share

import android.net.Uri
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import dev.orb.app.attach.AttachController
import dev.orb.app.attach.AttachIo
import dev.orb.app.attach.AttachTexts
import dev.orb.app.attach.AttachUploader
import dev.orb.app.attach.SourceInfo
import dev.orb.app.attach.UploadPolicy
import dev.orb.app.share.ShareRequest
import dev.orb.app.ui.chats.ChatRow
import dev.orb.app.ui.chats.row
import dev.orb.app.ui.theme.OrbPaletteChoice
import dev.orb.app.ui.theme.OrbTheme
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ShareScreenTest {
    @get:Rule val rule = createComposeRule()
    @get:Rule val tmp = TemporaryFolder()

    private class Backend : ShareBackend {
        val sent = ArrayList<Pair<ShareDest, String>>()
        override fun recents(): Flow<List<ChatRow>> = flowOf(listOf(row("7", title = "Versión 2.0 de la app", project = "app-movil")))
        override suspend fun projects() = listOf("app-movil")
        override suspend fun send(dest: ShareDest, text: String, images: List<String>): Result<Unit> { sent += dest to text; return Result.success(Unit) }
    }

    private fun screen(request: ShareRequest, backend: Backend, closed: MutableList<Unit> = ArrayList()): ShareViewModel {
        val io = object : AttachIo {
            override fun info(uri: Uri) = SourceInfo("x", null)
            override fun read(uri: Uri, maxBytes: Long): ByteArray? = null
        }
        val attach = AttachController(
            CoroutineScope(SupervisorJob() + Dispatchers.Unconfined), io, AttachUploader { _, _, _ -> Result.success("up") },
            { UploadPolicy(1000, setOf("png", "txt")) }, tmp.newFolder(), Dispatchers.Unconfined, reduce = { it },
        )
        val vm = ShareViewModel(backend, request, attach, Dispatchers.Unconfined)
        rule.setContent { OrbTheme(OrbPaletteChoice.Grafito, dark = false) { ShareScreen(vm, onClose = { closed += Unit }) } }
        rule.waitForIdle()
        return vm
    }

    @Test fun showsTheDestinationsOfTheMockupAndSendsToTheChosenOne() {
        val backend = Backend()
        screen(ShareRequest("Mira esto", emptyList(), 0, false), backend)
        rule.onNodeWithText(AttachTexts.SHARE_TITLE).assertIsDisplayed()
        rule.onNodeWithText("Texto").assertIsDisplayed()
        rule.onNodeWithText(AttachTexts.SHARE_TO).assertIsDisplayed()
        rule.onNodeWithText("Versión 2.0 de la app").assertIsDisplayed()
        rule.onNodeWithText(AttachTexts.SHARE_NEW_ORBE).performScrollTo().assertIsDisplayed()
        rule.onNodeWithText(AttachTexts.SHARE_NEW_ORBE).assertIsSelected()
        rule.onNodeWithText("Versión 2.0 de la app").performClick()
        rule.onNodeWithText("Versión 2.0 de la app").assertIsSelected()
        rule.onNodeWithText(AttachTexts.SHARE_SEND).performClick()
        rule.waitForIdle()
        assertEquals("Mira esto", backend.sent.single().second)
    }

    @Test fun cancelDropsTheShareAndCloses() {
        val closed = ArrayList<Unit>()
        screen(ShareRequest("Hola", emptyList(), 0, false), Backend(), closed)
        rule.onNodeWithText(AttachTexts.SHARE_CANCEL).performClick()
        assertTrue(closed.isNotEmpty())
    }

    @Test fun anEmptyShareSaysSoAndOnlyOffersCancel() {
        screen(ShareRequest(null, emptyList(), 0, false), Backend())
        rule.onNodeWithText(AttachTexts.SHARE_EMPTY).assertIsDisplayed()
        rule.onNodeWithText(AttachTexts.SHARE_SEND).assertDoesNotExist()
    }
}

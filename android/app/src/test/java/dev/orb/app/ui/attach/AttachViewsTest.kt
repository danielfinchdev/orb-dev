package dev.orb.app.ui.attach

import android.net.Uri
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import dev.orb.app.attach.AttachController
import dev.orb.app.attach.AttachIo
import dev.orb.app.attach.AttachState
import dev.orb.app.attach.AttachTexts
import dev.orb.app.attach.AttachType
import dev.orb.app.attach.AttachUploader
import dev.orb.app.attach.Attachment
import dev.orb.app.attach.SourceInfo
import dev.orb.app.attach.UploadPolicy
import dev.orb.app.ui.chats.ChatTexts
import dev.orb.app.ui.chats.Composer
import dev.orb.app.ui.theme.OrbTheme
import dev.orb.app.ui.theme.ThemeChoice
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class AttachViewsTest {
    @get:Rule val rule = createComposeRule()
    @get:Rule val tmp = TemporaryFolder()

    private val noLaunch = AttachLaunchers({}, {}, {})

    private fun sheet(policy: UploadPolicy, launchers: AttachLaunchers = noLaunch) {
        rule.setContent { OrbTheme(ThemeChoice.Orbita, dark = false, dynamic = false) { AttachSheet(policy, launchers, onDismiss = {}) } }
        rule.waitForIdle()
    }

    @Test fun theSheetOffersCameraGalleryAndFilesWhenThePcTakesThem() {
        sheet(UploadPolicy(1000, setOf("png", "pdf")))
        rule.onNodeWithText(AttachTexts.CAMERA).assertIsDisplayed()
        rule.onNodeWithText(AttachTexts.GALLERY).assertIsDisplayed()
        rule.onNodeWithText(AttachTexts.FILE).assertIsDisplayed()
        rule.onNodeWithText(AttachTexts.ENCRYPT_HINT).assertIsDisplayed()
    }

    @Test fun anOlderPcHidesFiles() {
        sheet(UploadPolicy.Legacy)
        rule.onNodeWithText(AttachTexts.GALLERY).assertIsDisplayed()
        rule.onNodeWithText(AttachTexts.FILE).assertDoesNotExist()
    }

    @Test fun eachRowCallsItsLauncher() {
        val seen = ArrayList<String>()
        sheet(UploadPolicy(1000, setOf("png", "pdf")), AttachLaunchers({ seen += "cam" }, { seen += "gal" }, { seen += "file" }))
        rule.onNodeWithText(AttachTexts.CAMERA).performClick()
        rule.onNodeWithText(AttachTexts.GALLERY).performClick()
        rule.onNodeWithText(AttachTexts.FILE).performClick()
        assertEquals(listOf("cam", "gal", "file"), seen)
    }

    private fun strip(items: List<Attachment>, notice: String? = null, onRemove: (Long) -> Unit = {}, onRetry: (Long) -> Unit = {}) {
        rule.setContent { OrbTheme(ThemeChoice.Orbita, dark = false, dynamic = false) { AttachStrip(items, notice, onRemove, onRetry) } }
        rule.waitForIdle()
    }

    private fun item(id: Long, state: AttachState, error: String? = null, retry: Boolean = false) =
        Attachment(id, "captura-$id.png", AttachType.Png, state, error = error, canRetry = retry)

    @Test fun theStripShowsProgressAndTheErrorWithRetry() {
        var retried = -1L
        var removed = -1L
        strip(
            listOf(item(1, AttachState.Uploading), item(2, AttachState.Failed, AttachTexts.UPLOAD_FAILED, retry = true)),
            onRemove = { removed = it }, onRetry = { retried = it },
        )
        rule.onNodeWithText(AttachTexts.UPLOADING).assertIsDisplayed()
        rule.onNodeWithText("${AttachTexts.UPLOAD_FAILED}. ${AttachTexts.RETRY}").performClick()
        assertEquals(2L, retried)
        rule.onAllNodesWithContentDescription(AttachTexts.REMOVE)[0].performClick()
        assertEquals(1L, removed)
    }

    @Test fun aNoticeShowsWithoutChips() {
        strip(emptyList(), AttachTexts.TOO_MANY)
        rule.onNodeWithText(AttachTexts.TOO_MANY).assertIsDisplayed()
    }

    // --- In the composer ---

    private class GatedUploader : AttachUploader {
        val gate = CompletableDeferred<Unit>()
        override suspend fun upload(bytes: ByteArray, mime: String?, name: String?): Result<String> {
            gate.await()
            return Result.success("subido.png")
        }
    }

    @Test fun sendWaitsForTheUploadAndThePlusOpensTheSheet() {
        val up = GatedUploader()
        val io = object : AttachIo {
            override fun info(uri: Uri) = SourceInfo("a.pdf", "application/pdf")
            override fun read(uri: Uri, maxBytes: Long) = ByteArray(10)
        }
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)
        val c = AttachController(scope, io, up, { UploadPolicy(1000, setOf("png", "pdf")) }, File(tmp.newFolder(), "w"), Dispatchers.Unconfined)
        val sent = ArrayList<String>()
        rule.setContent {
            OrbTheme(ThemeChoice.Orbita, dark = false, dynamic = false) {
                Composer(online = true, busy = false, mode = null, canSetMode = false, onSend = { sent += it }, onStop = {}, onMode = {}, attach = c)
            }
        }
        rule.onNodeWithContentDescription(ChatTexts.MESSAGE_FIELD).performTextInput("Mira esto")
        c.addUris(listOf(Uri.parse("content://x/1")))
        rule.waitForIdle()
        // Still uploading: the message must not leave without its file.
        rule.onNodeWithContentDescription(ChatTexts.SEND).assertIsNotEnabled()
        up.gate.complete(Unit)
        rule.waitUntil(3_000) { c.items.value.single().state == AttachState.Ready }
        rule.onNodeWithContentDescription(ChatTexts.SEND).assertIsEnabled()
        rule.onNodeWithContentDescription(ChatTexts.SEND).performClick()
        assertEquals(listOf("Mira esto"), sent)
        assertTrue(c.remoteNames() == listOf("subido.png"))

        rule.onNodeWithContentDescription(AttachTexts.ADD).performClick()
        rule.onNodeWithText(AttachTexts.CAMERA).assertIsDisplayed()
        c.close()
    }

    @Test fun withoutAnAttachControllerThereIsNoPlus() {
        rule.setContent {
            OrbTheme(ThemeChoice.Orbita, dark = false, dynamic = false) {
                Composer(online = true, busy = false, mode = null, canSetMode = false, onSend = {}, onStop = {}, onMode = {})
            }
        }
        rule.onNodeWithContentDescription(AttachTexts.ADD).assertDoesNotExist()
    }
}

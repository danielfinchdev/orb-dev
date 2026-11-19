package dev.orb.app.ui.attach

import android.net.Uri
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.performTouchInput
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
import dev.orb.app.ui.theme.OrbPaletteChoice
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
        rule.setContent { OrbTheme(OrbPaletteChoice.Grafito, dark = false) { AttachSheet(policy, launchers, onDismiss = {}) } }
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
        rule.setContent { OrbTheme(OrbPaletteChoice.Grafito, dark = false) { AttachStrip(items, notice, onRemove, onRetry) } }
        rule.waitForIdle()
    }

    private fun item(id: Long, state: AttachState, error: String? = null, retry: Boolean = false) =
        Attachment(id, "captura-$id.png", AttachType.Png, state, error = error, canRetry = retry)

    @Test fun theStripShowsProgressAndAFailedCardOffersRetryAndRemoveInASheet() {
        var retried = -1L
        var removed = -1L
        strip(
            listOf(item(1, AttachState.Uploading), item(2, AttachState.Failed, AttachTexts.UPLOAD_FAILED, retry = true)),
            onRemove = { removed = it }, onRetry = { retried = it },
        )
        rule.onNodeWithContentDescription(AttachTexts.UPLOADING).assertIsDisplayed()
        // Loose cards with the whole name and no button on them.
        rule.onNodeWithText("captura-1.png").assertIsDisplayed()
        assertEquals(0, rule.onAllNodesWithContentDescription(AttachTexts.REMOVE).fetchSemanticsNodes().size)
        rule.onNodeWithText("${AttachTexts.UPLOAD_FAILED}. ${AttachTexts.RETRY}").performClick()
        rule.onNodeWithText(AttachTexts.RETRY).performClick()
        assertEquals(2L, retried)
        rule.onAllNodesWithText("captura-1.png")[0].performClick()
        rule.onNodeWithText(AttachTexts.REMOVE_ONE).performClick()
        assertEquals(1L, removed)
    }

    @Test fun aLongPressOpensTheSameSheetAndAGoodCardHasNoRetry() {
        var removed = -1L
        strip(listOf(item(1, AttachState.Ready)), onRemove = { removed = it })
        rule.onNodeWithText("captura-1.png").performTouchInput { longClick() }
        rule.onNodeWithText(AttachTexts.RETRY).assertDoesNotExist()
        rule.onNodeWithText(AttachTexts.REMOVE_ONE).performClick()
        assertEquals(1L, removed)
    }

    @Test fun aScreenReaderGetsRemoveAndRetryAsActionsOfTheCard() {
        strip(listOf(item(1, AttachState.Failed, AttachTexts.UPLOAD_FAILED, retry = true)))
        val node = rule.onNodeWithText("${AttachTexts.UPLOAD_FAILED}. ${AttachTexts.RETRY}", useUnmergedTree = false).fetchSemanticsNode()
        val labels = node.config[androidx.compose.ui.semantics.SemanticsActions.CustomActions].map { it.label }
        assertEquals(listOf(AttachTexts.RETRY, AttachTexts.REMOVE_ONE), labels)
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
            OrbTheme(OrbPaletteChoice.Grafito, dark = false) {
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
            OrbTheme(OrbPaletteChoice.Grafito, dark = false) {
                Composer(online = true, busy = false, mode = null, canSetMode = false, onSend = {}, onStop = {}, onMode = {})
            }
        }
        rule.onNodeWithContentDescription(AttachTexts.ADD).assertDoesNotExist()
    }

    @Test fun thePlusTurnsIntoACloseWhileTheTrayIsOpenAndBack() {
        val c = AttachController(
            CoroutineScope(SupervisorJob() + Dispatchers.Unconfined), object : AttachIo {
                override fun info(uri: Uri) = SourceInfo("a.pdf", "application/pdf")
                override fun read(uri: Uri, maxBytes: Long) = ByteArray(10)
            },
            AttachUploader { _, _, _ -> Result.success("x") }, { UploadPolicy(1000, setOf("png", "pdf")) }, File(tmp.newFolder(), "w"), Dispatchers.Unconfined,
        )
        rule.setContent {
            OrbTheme(OrbPaletteChoice.Grafito, dark = false) {
                Composer(online = true, busy = false, mode = null, canSetMode = false, onSend = {}, onStop = {}, onMode = {}, attach = c)
            }
        }
        rule.onNodeWithContentDescription(AttachTexts.ADD).assertIsDisplayed()
        rule.onNodeWithContentDescription(ChatTexts.ATTACH_CLOSE).assertDoesNotExist()
        rule.onNodeWithContentDescription(AttachTexts.ADD).performClick()
        rule.waitForIdle()
        rule.onNodeWithContentDescription(ChatTexts.ATTACH_CLOSE).assertExists()
        rule.onNodeWithText(AttachTexts.CAMERA_META).assertIsDisplayed()
        rule.onNodeWithText(AttachTexts.GALLERY_META).assertIsDisplayed()
        c.close()
    }

    @Test fun aFailedCardKeepsItsRetryAndAWorkingOneHasNoExtraText() {
        strip(listOf(item(1, AttachState.Preparing)))
        rule.onNodeWithContentDescription(AttachTexts.PREPARING).assertIsDisplayed()
        rule.onNodeWithText("captura-1.png").assertIsDisplayed()
    }
}

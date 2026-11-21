package dev.orb.app.ui.share

import android.net.Uri
import dev.orb.app.attach.AttachController
import dev.orb.app.attach.AttachIo
import dev.orb.app.attach.AttachState
import dev.orb.app.attach.AttachTexts
import dev.orb.app.attach.AttachUploader
import dev.orb.app.attach.SourceInfo
import dev.orb.app.attach.UploadPolicy
import dev.orb.app.share.ShareRequest
import dev.orb.app.share.SharedFile
import dev.orb.app.ui.chats.ChatKind
import dev.orb.app.ui.chats.ChatRef
import dev.orb.app.ui.chats.ChatRow
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

@OptIn(ExperimentalCoroutinesApi::class)
class ShareViewModelTest {
    @get:Rule val tmp = TemporaryFolder()

    private class Backend : ShareBackend {
        val sent = ArrayList<Pair<String, List<String>>>()
        override fun recents(): Flow<List<ChatRow>> = emptyFlow()
        override suspend fun projects() = emptyList<String>()
        override suspend fun send(dest: ShareDest, text: String, images: List<String>): Result<Unit> {
            sent += text to images
            return Result.success(Unit)
        }
    }

    private val io = object : AttachIo {
        override fun info(uri: Uri) = SourceInfo("x", null)
        override fun read(uri: Uri, maxBytes: Long): ByteArray? = null
    }

    @Before fun setUp() = Dispatchers.setMain(Dispatchers.Unconfined)
    @After fun tearDown() = Dispatchers.resetMain()

    private fun model(request: ShareRequest, backend: Backend): ShareViewModel {
        val attach = AttachController(
            CoroutineScope(SupervisorJob() + Dispatchers.Unconfined), io, AttachUploader { _, _, _ -> Result.success("up-1") },
            { UploadPolicy(1000, setOf("png", "txt")) }, tmp.newFolder(), Dispatchers.Unconfined, reduce = { it },
        )
        return ShareViewModel(backend, request, attach, Dispatchers.Unconfined)
    }

    private fun picture(): SharedFile = SharedFile(tmp.newFile().apply { writeBytes(ByteArray(5)) }, "foto.png", "image/png")

    @Test fun aSharedPictureWithoutTextGetsAnEditableDefaultAndCanBeSent() {
        val backend = Backend()
        val vm = model(ShareRequest(null, listOf(picture()), 0, false), backend)
        vm.choose(ShareDest.Chat(ChatRef(ChatKind.Agent, "s1"))) // only assistants take attachments
        assertEquals(AttachTexts.SHARE_DEFAULT_TEXT, vm.state.value.text)
        assertEquals(AttachState.Ready, vm.attach.items.value.single().state)
        vm.send()
        assertEquals(AttachTexts.SHARE_DEFAULT_TEXT, backend.sent.single().first)
        assertEquals(listOf("up-1"), backend.sent.single().second)
    }

    @Test fun clearingTheSuggestedTextStillSendsTheAttachment() {
        val backend = Backend()
        val vm = model(ShareRequest(null, listOf(picture()), 0, false), backend)
        vm.choose(ShareDest.Chat(ChatRef(ChatKind.Agent, "s1"))) // only assistants take attachments
        vm.setText("")
        vm.send()
        assertEquals(1, backend.sent.size)
    }

    @Test fun nothingAtAllStillAsksForAMessage() {
        val backend = Backend()
        val vm = model(ShareRequest("  ", emptyList(), 0, false), backend)
        vm.send()
        assertTrue(backend.sent.isEmpty())
        assertEquals(AttachTexts.SHARE_NEEDS_TEXT, vm.state.value.message)
    }

    @Test fun theBadgeNamesOneFileCountsSeveralOrSaysText() {
        assertEquals("captura.png", sharedLabel(listOf("captura.png"), false))
        assertEquals("3 archivos", sharedLabel(listOf("a", "b", "c"), true))
        assertEquals("Texto", sharedLabel(emptyList(), true))
        assertEquals(null, sharedLabel(emptyList(), false))
    }
}

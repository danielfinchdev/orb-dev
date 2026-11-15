package dev.orb.app.ui.chats

import dev.orb.app.attach.AttachController
import dev.orb.app.attach.AttachIo
import dev.orb.app.attach.AttachUploader
import dev.orb.app.attach.UploadPolicy
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ChatAttachSendTest {
    private val dispatcher = StandardTestDispatcher()
    @get:Rule val tmp = TemporaryFolder()

    @Before fun setUp() = Dispatchers.setMain(dispatcher)
    @After fun tearDown() = Dispatchers.resetMain()

    private fun controller(): AttachController {
        val io = object : AttachIo {
            override fun info(uri: android.net.Uri) = throw UnsupportedOperationException()
            override fun read(uri: android.net.Uri, maxBytes: Long) = null
        }
        return AttachController(
            CoroutineScope(SupervisorJob() + Dispatchers.Unconfined), io, AttachUploader { _, _, _ -> Result.success("sube.pdf") },
            { UploadPolicy(1000, setOf("pdf")) }, tmp.newFolder(), Dispatchers.Unconfined,
        )
    }

    @Test fun anOrbeMessageCarriesTheUploadedNamesAndClearsTheStrip() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(emptyList())
        val c = controller()
        val vm = OrbeChatViewModel(b, 7, dispatcher = dispatcher, attach = c)
        runCurrent()
        c.addBytes("a.pdf", "application/pdf", ByteArray(5))
        vm.send("Lee esto")
        runCurrent()
        assertTrue(b.calls.contains("send Lee esto +sube.pdf"))
        assertTrue(c.items.value.isEmpty())
    }

    @Test fun aDirectMessageCarriesThemToo() = runTest(dispatcher) {
        val b = FakeDirectChatBackend()
        val c = controller()
        val vm = DirectChatViewModel(b, "s1", dispatcher = dispatcher, attach = c)
        runCurrent()
        c.addBytes("a.pdf", "application/pdf", ByteArray(5))
        vm.send("Lee esto")
        runCurrent()
        assertTrue(b.calls.any { it.endsWith("Lee esto +sube.pdf") })
        assertTrue(c.items.value.isEmpty())
    }
}

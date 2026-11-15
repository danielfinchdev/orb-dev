package dev.orb.app.attach

import android.net.Uri
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class AttachControllerTest {
    @get:Rule val tmp = TemporaryFolder()

    private class FakeIo(val files: Map<String, Pair<SourceInfo, ByteArray>>) : AttachIo {
        override fun info(uri: Uri) = files.getValue(uri.toString()).first
        override fun read(uri: Uri, maxBytes: Long) = files.getValue(uri.toString()).second.takeIf { it.size <= maxBytes }
    }

    private class Uploads {
        val calls = ArrayList<Triple<Int, String?, String?>>()
        var fail = false
        var n = 0
        val uploader = AttachUploader { bytes, mime, name ->
            calls += Triple(bytes.size, mime, name)
            if (fail) Result.failure(RuntimeException("x")) else Result.success("up-${++n}")
        }
    }

    private fun TestScope.controller(
        io: FakeIo, up: Uploads, policy: UploadPolicy = UploadPolicy(1000, setOf("png", "jpg", "pdf", "md")), max: Int = MAX_ATTACHMENTS,
    ) = AttachController(
        backgroundScope, io, up.uploader, { policy }, tmp.newFolder(), StandardTestDispatcher(testScheduler),
        reduce = { it.copyOf(it.size / 2) }, maxItems = max,
    )

    private fun uri(s: String) = Uri.parse("content://x/$s")

    private fun io(vararg e: Triple<String, String, Pair<String?, Int>>) =
        FakeIo(e.associate { (key, name, m) -> uri(key).toString() to (SourceInfo(name, m.first) to ByteArray(m.second) { 1 }) })

    @Test fun aPictureIsReducedUploadedAndThenCarriedByItsName() = runTest {
        val up = Uploads()
        val c = controller(io(Triple("a", "a.png", "image/png" to 400)), up)
        c.addUris(listOf(uri("a")))
        // The provider is asked off the caller's thread, so nothing shows before the worker runs.
        assertTrue(c.items.value.isEmpty())
        runCurrent()
        val item = c.items.value.single()
        assertEquals(AttachState.Ready, item.state)
        assertEquals(AttachType.Jpg, item.type)
        assertEquals(listOf("up-1"), c.remoteNames())
        // Reduced to half by the stand-in, and a picture's name is not sent.
        assertEquals(Triple(200, "image/jpeg", null), up.calls.single())
        assertTrue(item.file!!.exists())
        assertFalse(c.busy)
    }

    @Test fun removingAChipWhilePreparingLeavesNoFileBehind() = runTest {
        val up = Uploads()
        val dir = tmp.newFolder()
        val c = AttachController(
            backgroundScope, io(Triple("a", "a.pdf", "application/pdf" to 50)), up.uploader,
            { UploadPolicy(1000, setOf("pdf")) }, dir, StandardTestDispatcher(testScheduler),
        )
        c.addUris(listOf(uri("a")))
        runCurrent()
        assertEquals(AttachState.Ready, c.items.value.single().state)
        c.remove(c.items.value.single().id)
        assertTrue(dir.listFiles().orEmpty().isEmpty())
        // Removed while still Preparing: the chip exists but the worker has not written the file yet.
        val c2 = AttachController(
            backgroundScope, io(Triple("b", "b.pdf", "application/pdf" to 50)), up.uploader,
            { UploadPolicy(1000, setOf("pdf")) }, dir, StandardTestDispatcher(testScheduler),
        )
        c2.addBytes("b.pdf", "application/pdf", ByteArray(10))
        val id = c2.items.value.single().id
        c2.remove(id)
        runCurrent()
        assertTrue(c2.items.value.isEmpty())
        assertTrue(dir.listFiles().orEmpty().isEmpty())
        assertEquals(1, up.calls.size)
    }

    @Test fun aChipRemovedInTheMiddleOfPreparingLeavesNoFile() = runTest {
        val up = Uploads()
        val dir = tmp.newFolder()
        lateinit var c: AttachController
        c = AttachController(
            backgroundScope, io(Triple("a", "a.png", "image/png" to 50)), up.uploader,
            { UploadPolicy(1000, setOf("png", "jpg")) }, dir, StandardTestDispatcher(testScheduler),
            reduce = { c.remove(c.items.value.single().id); it },
        )
        c.addUris(listOf(uri("a")))
        runCurrent()
        assertTrue(c.items.value.isEmpty())
        assertTrue(dir.listFiles().orEmpty().isEmpty())
        assertTrue(up.calls.isEmpty())
    }

    @Test fun startupCleaningKeepsOnlyAFreshCameraPhoto() {
        val root = tmp.newFolder()
        val fresh = java.io.File(root, "cam-1.jpg").apply { writeBytes(ByteArray(3)) }
        val old = java.io.File(root, "cam-2.jpg").apply { writeBytes(ByteArray(3)); setLastModified(1_000) }
        val folder = java.io.File(root, "chat-uuid").apply { mkdirs() }
        java.io.File(folder, "1.jpg").writeBytes(ByteArray(3))
        val other = java.io.File(root, "x.jpg").apply { writeBytes(ByteArray(3)) }
        AttachController.purgeLeftovers(root, nowMs = fresh.lastModified() + 1_000)
        assertTrue(fresh.exists())
        assertFalse(old.exists() || folder.exists() || other.exists())
    }

    @Test fun aFileKeepsItsNameForThePcAndItsBytes() = runTest {
        val up = Uploads()
        val c = controller(io(Triple("n", "notas.md", "text/plain" to 50)), up)
        c.addUris(listOf(uri("n")))
        runCurrent()
        assertEquals(Triple(50, "text/markdown", "notas.md"), up.calls.single())
        assertEquals(AttachType.Md, c.items.value.single().type)
    }

    @Test fun whatThePcDoesNotTakeIsRefusedWithAReason() = runTest {
        val up = Uploads()
        val c = controller(io(Triple("p", "a.pdf", "application/pdf" to 10)), up, UploadPolicy.Legacy)
        c.addUris(listOf(uri("p")))
        runCurrent()
        assertTrue(c.items.value.isEmpty())
        assertEquals(AttachTexts.NOT_ACCEPTED, c.notice.value)
        assertTrue(up.calls.isEmpty())
    }

    @Test fun neverMoreThanTheLimit() = runTest {
        val up = Uploads()
        val c = controller(io(Triple("a", "a.png", "image/png" to 10), Triple("b", "b.png", "image/png" to 10), Triple("c", "c.png", "image/png" to 10)), up, max = 2)
        c.addUris(listOf(uri("a"), uri("b"), uri("c")))
        runCurrent()
        assertEquals(2, c.items.value.size)
        assertEquals(AttachTexts.TOO_MANY, c.notice.value)
    }

    @Test fun aFileOverThePcLimitFailsWithoutRetry() = runTest {
        val up = Uploads()
        val c = controller(io(Triple("p", "big.pdf", "application/pdf" to 5000)), up)
        c.addUris(listOf(uri("p")))
        runCurrent()
        val item = c.items.value.single()
        assertEquals(AttachState.Failed, item.state)
        assertFalse(item.canRetry)
        assertTrue(up.calls.isEmpty())
        assertTrue(c.remoteNames().isEmpty())
    }

    @Test fun aFailedUploadCanBeRetriedFromTheSavedFile() = runTest {
        val up = Uploads().also { it.fail = true }
        val c = controller(io(Triple("p", "a.pdf", "application/pdf" to 100)), up)
        c.addUris(listOf(uri("p")))
        runCurrent()
        val failed = c.items.value.single()
        assertEquals(AttachState.Failed, failed.state)
        assertTrue(failed.canRetry)
        assertEquals(AttachTexts.UPLOAD_FAILED, failed.error)
        up.fail = false
        c.retry(failed.id)
        runCurrent()
        assertEquals(AttachState.Ready, c.items.value.single().state)
        assertEquals(2, up.calls.size)
        assertNull(c.items.value.single().error)
    }

    @Test fun removingOrDiscardingDeletesThePreparedFiles() = runTest {
        val up = Uploads()
        val c = controller(io(Triple("a", "a.png", "image/png" to 10), Triple("b", "b.pdf", "application/pdf" to 10)), up)
        c.addUris(listOf(uri("a"), uri("b")))
        runCurrent()
        val (a, b) = c.items.value
        c.remove(a.id)
        assertFalse(a.file!!.exists())
        assertEquals(listOf(b.id), c.items.value.map { it.id })
        c.discard()
        assertFalse(b.file!!.exists())
        assertTrue(c.items.value.isEmpty())
    }

    @Test fun bytesInHandGoThroughTheSamePath() = runTest {
        val up = Uploads()
        val c = controller(io(), up)
        c.addBytes("foto.jpg", "image/jpeg", ByteArray(100))
        runCurrent()
        assertEquals(listOf("up-1"), c.remoteNames())
    }
}

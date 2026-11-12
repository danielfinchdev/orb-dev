package dev.orb.app.share

import android.content.Intent
import android.net.Uri
import dev.orb.app.attach.SourceInfo
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
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ShareReaderTest {
    @get:Rule val tmp = TemporaryFolder()

    private class FakeShareIo(val items: Map<String, Pair<SourceInfo, Int>>) : ShareIo {
        override fun info(uri: Uri) = items.getValue(uri.toString()).first
        override fun copy(uri: Uri, dest: File, maxBytes: Long): Long {
            val size = items.getValue(uri.toString()).second
            if (size > maxBytes) return -1
            dest.writeBytes(ByteArray(size))
            return size.toLong()
        }
    }

    private fun u(s: String) = Uri.parse("content://x/$s")

    /** (key, mime, name to size) */
    private fun io(vararg i: Triple<String, String?, Pair<String, Int>>) =
        FakeShareIo(i.associate { (k, mime, nameSize) -> u(k).toString() to (SourceInfo(nameSize.first, mime) to nameSize.second) })

    private fun send(text: String? = null, subject: String? = null, uris: List<Uri> = emptyList(), type: String = "text/plain") =
        Intent(if (uris.size > 1) Intent.ACTION_SEND_MULTIPLE else Intent.ACTION_SEND).apply {
            this.type = type
            text?.let { putExtra(Intent.EXTRA_TEXT, it) }
            subject?.let { putExtra(Intent.EXTRA_SUBJECT, it) }
            if (uris.size == 1) putExtra(Intent.EXTRA_STREAM, uris[0])
            if (uris.size > 1) putParcelableArrayListExtra(Intent.EXTRA_STREAM, ArrayList(uris))
        }

    private fun read(i: Intent, io: ShareIo = io()) = ShareReader.read(i, io, tmp.newFolder())

    @Test fun otherIntentsAreIgnored() {
        assertNull(read(Intent(Intent.ACTION_MAIN)))
        assertNull(ShareReader.read(null, io(), tmp.newFolder()))
    }

    @Test fun textWithItsSubject() {
        val r = read(send("https://ejemplo.org", "Una pagina"))!!
        assertEquals("Una pagina\nhttps://ejemplo.org", r.text)
        assertTrue(r.files.isEmpty())
        assertFalse(r.isEmpty)
    }

    @Test fun aSubjectAlreadyInTheTextIsNotRepeated() {
        assertEquals("Hola mundo", read(send("Hola mundo", "Hola"))!!.text)
    }

    @Test fun oneSharedPictureIsCopiedToTheCache() {
        val dir = tmp.newFolder()
        val r = ShareReader.read(send(uris = listOf(u("a")), type = "image/png"), io(Triple("a", "image/png", "foto.png" to 300)), dir)!!
        val f = r.files.single()
        assertEquals("foto.png", f.name)
        assertTrue(f.file.exists() && f.file.parentFile == dir)
        r.deleteFiles()
        assertFalse(f.file.exists())
    }

    @Test fun severalItemsKeepTheSupportedOnesAndCountTheRest() {
        val i = io(
            Triple("a", "image/jpeg", "a.jpg" to 10), Triple("b", "application/zip", "b.zip" to 10),
            Triple("c", "application/pdf", "c.pdf" to 10),
        )
        val r = read(send(uris = listOf(u("a"), u("b"), u("c")), type = "*/*"), i)!!
        assertEquals(listOf("a.jpg", "c.pdf"), r.files.map { it.name })
        assertEquals(1, r.skipped)
    }

    @Test fun anUnsupportedOnlyShareIsEmptyAndSaysSo() {
        val r = read(send(uris = listOf(u("b")), type = "application/zip"), io(Triple("b", "application/zip", "b.zip" to 10)))!!
        assertTrue(r.isEmpty)
        assertEquals(1, r.skipped)
    }

    @Test fun tooBigItemsAreLeftOut() {
        val big = (ShareReader.MAX_FILE_BYTES + 1).toInt()
        val r = read(send(uris = listOf(u("a")), type = "image/png"), io(Triple("a", "image/png", "a.png" to big)))!!
        assertTrue(r.files.isEmpty())
        assertEquals(1, r.skipped)
    }

    @Test fun neverMoreThanSixFiles() {
        val keys = (1..9).map { "f$it" }
        val i = io(*keys.map { Triple(it, "image/png", "$it.png" to 5) }.toTypedArray())
        val r = read(send(uris = keys.map(::u), type = "image/*"), i)!!
        assertEquals(6, r.files.size)
        assertEquals(3, r.skipped)
    }

    @Test fun aVeryLongTextIsCutToWhatAMessageHolds() {
        val r = read(send("x".repeat(ShareReader.MAX_TEXT + 500)))!!
        assertEquals(ShareReader.MAX_TEXT, r.text!!.length)
        assertTrue(r.textCut)
    }

    @Test fun aSharedFileWithoutATypeIsRecognizedByItsName() {
        val r = read(send(uris = listOf(u("n")), type = "text/*"), io(Triple("n", null, "notas.md" to 20)))!!
        assertEquals("notas.md", r.files.single().name)
    }
}

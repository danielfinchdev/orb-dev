package dev.orb.app.ui.scan

import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import dev.orb.app.link.payload.LinkPayloadException
import dev.orb.app.link.payload.parseLinkPayload
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class QrReaderTest {
    private val link = "http://192.168.1.20:3131/#vincular=ABCDEF&pc=" + "A".repeat(43) + "&v=4&n=DanLaptop"

    /** The brightness plane a camera would give for [text] drawn as a QR, [scale] pixels per module, with a quiet border. */
    private fun frame(text: String, scale: Int = 6, inverted: Boolean = false): Triple<ByteArray, Int, Int> {
        val matrix = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, 0, 0, mapOf(EncodeHintType.MARGIN to 4))
        val w = matrix.width * scale
        val h = matrix.height * scale
        val luma = ByteArray(w * h) { i ->
            val dark = matrix.get(i % w / scale, i / w / scale)
            (if (dark != inverted) 0 else 255).toByte()
        }
        return Triple(luma, w, h)
    }

    private fun read(f: Triple<ByteArray, Int, Int>) = ZxingQrReader().read(f.first, f.second, f.third)

    @Test fun anOrbQrIsReadAndParsedAsALink() {
        val text = read(frame(link))
        assertEquals(link, text)
        val payload = parseLinkPayload(text)
        assertEquals("ABCDEF", payload.code)
        assertEquals("DanLaptop", payload.name)
    }

    @Test fun aQrDrawnLightOnDarkIsReadToo() {
        assertEquals(link, read(frame(link, inverted = true)))
    }

    @Test fun aFrameWithoutAQrReadsNothing() {
        val blank = ByteArray(300 * 300) { 128.toByte() }
        assertNull(ZxingQrReader().read(blank, 300, 300))
        assertNull(ZxingQrReader().read(ByteArray(10), 300, 300))
    }

    @Test fun aQrThatIsNotAnOrbLinkIsReadButParsingRefusesIt() {
        val text = read(frame("https://example.com/promo"))
        assertNotNull(text)
        try {
            parseLinkPayload(text)
            fail("must not be accepted")
        } catch (e: LinkPayloadException) {
            assertTrue(scanHint(e.key).isNotEmpty())
        }
    }
}

package dev.orb.app.ui.scan

import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.LuminanceSource
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.ReaderException
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader

/** Turns one camera frame into the text of the QR in it. Kept behind an interface so the scanner can be tested without a camera. */
interface QrReader {
    /** [luma] is the brightness plane, [width] × [height] bytes with no row padding; null when there is no QR in the frame. */
    fun read(luma: ByteArray, width: Int, height: Int): String?
}

/** ZXing, bundled in the app: the frame is read on the phone and never leaves it. */
class ZxingQrReader : QrReader {
    private val reader = QRCodeReader()
    private val hints = mapOf(DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE), DecodeHintType.TRY_HARDER to true)

    override fun read(luma: ByteArray, width: Int, height: Int): String? {
        if (width <= 0 || height <= 0 || luma.size < width * height) return null
        val source = PlanarYUVLuminanceSource(luma, width, height, 0, 0, width, height, false)
        // A QR drawn light on dark (a dark theme on the PC) only reads once the brightness is inverted.
        return decode(source) ?: decode(source.invert())
    }

    private fun decode(source: LuminanceSource): String? = try {
        reader.decode(BinaryBitmap(HybridBinarizer(source)), hints).text
    } catch (e: ReaderException) {
        null
    } finally {
        reader.reset()
    }
}

package dev.orb.app.attach

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.ByteArrayOutputStream

@RunWith(RobolectricTestRunner::class)
// Real pixels and real decoding: the default shadow graphics decode anything and composite nothing.
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35])
class ImageReducerTest {
    private fun png(w: Int, h: Int, alpha: Boolean = false): ByteArray {
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        bmp.eraseColor(if (alpha) Color.TRANSPARENT else Color.RED)
        return ByteArrayOutputStream().also { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
    }

    private fun size(bytes: ByteArray): Pair<Int, Int> {
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, o)
        return o.outWidth to o.outHeight
    }

    @Test fun aBigPictureIsScaledToTheLongestSideKeepingItsShape() {
        val out = ImageReducer.reduce(png(4000, 2000), maxSide = 1000)!!
        assertEquals(1000 to 500, size(out))
        // JPEG magic.
        assertEquals(0xFF, out[0].toInt() and 0xFF)
        assertEquals(0xD8, out[1].toInt() and 0xFF)
    }

    @Test fun aSmallPictureKeepsItsSizeButBecomesJpeg() {
        assertEquals(300 to 200, size(ImageReducer.reduce(png(300, 200))!!))
    }

    @Test fun portraitIsScaledOnItsHeight() {
        assertEquals(500 to 1000, size(ImageReducer.reduce(png(2000, 4000), maxSide = 1000)!!))
    }

    @Test fun transparencyBecomesWhiteNotBlack() {
        val out = ImageReducer.reduce(png(40, 40, alpha = true))!!
        val px = BitmapFactory.decodeByteArray(out, 0, out.size).getPixel(5, 5)
        assertTrue("pixel ${Integer.toHexString(px)}", Color.red(px) > 200 && Color.green(px) > 200 && Color.blue(px) > 200)
    }

    @Test fun somethingThatIsNotAPictureGivesNothing() {
        val junk = ImageReducer.reduce(ByteArray(64) { 7 })
        assertNull("junk gave ${junk?.size}", junk)
        assertNotNull(ImageReducer.reduce(png(10, 10)))
    }
}

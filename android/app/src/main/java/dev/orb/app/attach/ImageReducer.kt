package dev.orb.app.attach

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.media.ExifInterface
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream

/** Shrinks a picture before it is encrypted and sent: phone cameras produce far more than a chat needs. */
object ImageReducer {
    const val MAX_SIDE = 2048
    const val QUALITY = 85

    /** → a JPEG whose longest side is at most [maxSide] and which keeps the photo's upright orientation; null if [bytes] is no picture. */
    fun reduce(bytes: ByteArray, maxSide: Int = MAX_SIDE, quality: Int = QUALITY): ByteArray? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        val w = bounds.outWidth
        val h = bounds.outHeight
        if (w <= 0 || h <= 0) return null
        // A power-of-two decode first keeps a 12 MP photo from being held at full size.
        var sample = 1
        while (maxOf(w, h) / (sample * 2) >= maxSide) sample *= 2
        val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return null
        val scale = minOf(1f, maxSide.toFloat() / maxOf(decoded.width, decoded.height))
        val matrix = Matrix().apply {
            if (scale < 1f) postScale(scale, scale)
            orientation(bytes)?.let { postConcat(it) }
        }
        var out = if (matrix.isIdentity) decoded else Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
        if (out !== decoded) decoded.recycle()
        // JPEG has no transparency: a transparent PNG would turn black.
        if (out.hasAlpha()) {
            val flat = Bitmap.createBitmap(out.width, out.height, Bitmap.Config.ARGB_8888)
            Canvas(flat).apply { drawColor(Color.WHITE); drawBitmap(out, 0f, 0f, null) }
            out.recycle()
            out = flat
        }
        val sink = ByteArrayOutputStream()
        val ok = out.compress(Bitmap.CompressFormat.JPEG, quality, sink)
        out.recycle()
        return if (ok) sink.toByteArray() else null
    }

    private fun orientation(bytes: ByteArray): Matrix? {
        val code = try {
            ExifInterface(ByteArrayInputStream(bytes)).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
        } catch (_: Exception) {
            return null
        }
        val m = Matrix()
        when (code) {
            ExifInterface.ORIENTATION_ROTATE_90 -> m.postRotate(90f)
            ExifInterface.ORIENTATION_ROTATE_180 -> m.postRotate(180f)
            ExifInterface.ORIENTATION_ROTATE_270 -> m.postRotate(270f)
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> m.postScale(-1f, 1f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> m.postScale(1f, -1f)
            ExifInterface.ORIENTATION_TRANSPOSE -> { m.postRotate(90f); m.postScale(-1f, 1f) }
            ExifInterface.ORIENTATION_TRANSVERSE -> { m.postRotate(270f); m.postScale(-1f, 1f) }
            else -> return null
        }
        return m
    }
}

package dev.orb.app.ui.shots

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.view.PixelCopy
import android.view.View
import android.view.Window
import android.view.WindowManager
import android.view.inspector.WindowInspector
import org.junit.Assume.assumeTrue
import org.robolectric.Shadows.shadowOf
import java.io.File

/**
 * Pictures of the real screens, to compare them with the design mockups without a phone.
 *
 * A test that takes pictures needs `@GraphicsMode(GraphicsMode.Mode.NATIVE)`, `@Config(sdk = [35], qualifiers = Shots.PHONE)`
 * and `createAndroidComposeRule<ComponentActivity>()`. Nothing is drawn or written unless ORB_SHOTS is set, so the
 * normal test run stays fast: `ORB_SHOTS=1 node scripts/android-native.mjs testDebugUnitTest --tests "*ShotsTest" --rerun`.
 * The files land in `android/app/build/screenshots`.
 */
object Shots {
    /** The size of the mockups: 390 × 844 dp, at 2 px per dp. */
    const val PHONE = "w390dp-h844dp-xhdpi"

    val enabled: Boolean get() = !System.getenv("ORB_SHOTS").isNullOrBlank()

    /** Skips the calling test when pictures were not asked for. */
    fun assumeEnabled() = assumeTrue("ORB_SHOTS is not set", enabled)

    /** Writes what the user would see: the activity plus every dialog, sheet and menu open above it. */
    fun save(activity: Activity, name: String): File {
        // Compose's own captureToImage waits for a redraw that never comes on Robolectric; PixelCopy with the hardware
        // renderer draws the real thing, text and shadows included.
        System.setProperty("robolectric.pixelCopyRenderMode", "hardware")
        shadowOf(Looper.getMainLooper()).idle()
        val base = activity.window.decorView
        val out = Bitmap.createBitmap(base.width, base.height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(out)
        val roots = WindowInspector.getGlobalWindowViews().filter { it.isShown && it.width > 0 && it.height > 0 }
        for (root in listOf(base) + roots.filter { it !== base }) {
            val lp = root.layoutParams as? WindowManager.LayoutParams
            if (root !== base && lp != null && lp.flags and WindowManager.LayoutParams.FLAG_DIM_BEHIND != 0) {
                canvas.drawColor(Color.argb((lp.dimAmount * 255).toInt().coerceIn(0, 255), 0, 0, 0))
            }
            val at = IntArray(2).also(root::getLocationOnScreen)
            canvas.drawBitmap(picture(root, if (root === base) activity.window else windowOf(root)), at[0].toFloat(), at[1].toFloat(), null)
        }
        val file = File(File("build/screenshots").apply { mkdirs() }, "$name.png")
        file.outputStream().use { out.compress(Bitmap.CompressFormat.PNG, 100, it) }
        return file
    }

    private fun picture(root: View, window: Window?): Bitmap {
        val bmp = Bitmap.createBitmap(root.width, root.height, Bitmap.Config.ARGB_8888)
        var copied = false
        if (window != null) {
            PixelCopy.request(window, bmp, { copied = it == PixelCopy.SUCCESS }, Handler(Looper.getMainLooper()))
            shadowOf(Looper.getMainLooper()).idle()
        }
        // A popup has no window of its own to copy from: draw its views instead (no shadows, same layout and text).
        if (!copied) root.draw(Canvas(bmp))
        return bmp
    }

    /** The window a dialog's root view belongs to; null for popups, which are bare views. */
    private fun windowOf(root: View): Window? = runCatching {
        generateSequence<Class<*>>(root.javaClass) { it.superclass }
            .firstNotNullOfOrNull { c -> runCatching { c.getDeclaredField("mWindow") }.getOrNull() }
            ?.apply { isAccessible = true }?.get(root) as? Window
    }.getOrNull()
}

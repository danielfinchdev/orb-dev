package dev.orb.app.ui

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.view.Window
import android.view.WindowManager
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalContext
import java.util.WeakHashMap

/**
 * FLAG_SECURE on a window while at least one reason asks for it. Several parts (the app lock, a screen that shows a secret)
 * want it independently, so each adds and removes only its own reason and the flag follows the union.
 */
object SecureWindow {
    private val reasons = WeakHashMap<Window, MutableSet<String>>()

    fun hold(window: Window, reason: String) = update(window) { it.add(reason) }

    fun release(window: Window, reason: String) = update(window) { it.remove(reason) }

    private fun update(window: Window, change: (MutableSet<String>) -> Unit) = synchronized(reasons) {
        val set = reasons.getOrPut(window) { mutableSetOf() }
        change(set)
        if (set.isEmpty()) window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        else window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
    }
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}

/** Keeps the window out of recents and screenshots while this is in the composition. */
@Composable
fun SecureWhileShown(reason: String) {
    val window = LocalContext.current.findActivity()?.window
    DisposableEffect(window, reason) {
        if (window != null) SecureWindow.hold(window, reason)
        onDispose { if (window != null) SecureWindow.release(window, reason) }
    }
}

package dev.orb.app

import android.os.Build
import android.os.Bundle
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.graphics.Insets
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  // Android's back button goes to the page (Tauri's app plugin → onBackButtonPress in src/ui/lib/app-bridge.js), which goes
  // back inside Orb and, on its first screen, sends the app to the background: never the WebView's own history.
  override val handleBackNavigation: Boolean = false

  override fun onCreate(savedInstanceState: Bundle?) {
    installSplashScreen() // Orb's colour and icon until the first frame (themes.xml › Theme.Orb.Starting)
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    edgeToEdgeInsets()
  }

  /**
   * Edge to edge, as Orb 3.8.0 had it (Capacitor's SystemBars): the page draws under the status and gesture bars and leaves
   * their room itself with env(safe-area-inset-*) (app.css). A WebView older than 140 does not report those insets: the
   * view is padded instead. The keyboard always pads the bottom, so the chat's box stays above it.
   */
  private fun edgeToEdgeInsets() {
    val types = WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
    val webView = webViewMajor()
    ViewCompat.setOnApplyWindowInsetsListener(window.decorView) { v, insets ->
      val bars = insets.getInsets(types)
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      val keyboard = insets.isVisible(WindowInsetsCompat.Type.ime())
      if (webView >= 140) {
        v.setPadding(0, 0, 0, if (keyboard) ime.bottom else 0)
        // https://issues.chromium.org/issues/457682720: before 144 the bottom inset is wrong with the keyboard open.
        val bottom = if (keyboard && webView < 144) 0 else bars.bottom
        WindowInsetsCompat.Builder(insets).setInsets(types, Insets.of(bars.left, bars.top, bars.right, bottom)).build()
      } else {
        v.setPadding(bars.left, bars.top, bars.right, if (keyboard) ime.bottom else bars.bottom)
        WindowInsetsCompat.Builder(insets).setInsets(types, Insets.of(0, 0, 0, 0)).build()
      }
    }
  }

  private fun webViewMajor(): Int = try {
    val name = if (Build.VERSION.SDK_INT >= 26) WebView.getCurrentWebViewPackage()?.versionName else version
    name?.substringBefore('.')?.toIntOrNull() ?: 0
  } catch (e: Exception) {
    0
  }
}

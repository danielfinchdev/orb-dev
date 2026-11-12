package dev.orb.app.ui.web

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.view.ViewGroup
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.viewinterop.AndroidView
import androidx.webkit.WebViewAssetLoader
import java.io.ByteArrayInputStream

/** A refusal with no body: what a page gets for any URL the policy does not allow. */
private fun blocked() = WebResourceResponse("text/plain", "utf-8", 403, "Blocked", emptyMap(), ByteArrayInputStream(ByteArray(0)))

internal class LocalWebClient(context: Context) : WebViewClient() {
    private val loader = WebViewAssetLoader.Builder()
        .setDomain(LocalWebPolicy.HOST)
        .addPathHandler(LocalWebPolicy.ASSETS_PATH, WebViewAssetLoader.AssetsPathHandler(context))
        .build()

    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
        val url = request.url.toString()
        if (!LocalWebPolicy.isAllowed(url)) return blocked()
        return loader.shouldInterceptRequest(request.url) ?: blocked()
    }

    // Moving to another page of the same local origin is fine; anything else is refused.
    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = !LocalWebPolicy.isAllowed(request.url.toString())

    override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
        if (!LocalWebPolicy.isAllowed(url)) view.stopLoading()
    }

    // A crashed renderer would take the app with it; the page is just dropped.
    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean = true
}

/** Lets the screen that hosts a page talk to it: run its `window.orbBack()` or hand it something to receive. */
class WebController {
    internal var web: WebView? = null

    /** Calls `window.orbBack()`; false when there is no page yet (the caller leaves by itself). */
    fun back(): Boolean {
        val w = web ?: return false
        w.evaluateJavascript("(function(){return !!(window.orbBack && window.orbBack());})()", null)
        return true
    }

    /** Calls `window.orbReceive(message)`; [json] is JSON text, which is also a valid JavaScript expression. */
    fun send(json: String) {
        web?.evaluateJavascript("window.orbReceive && window.orbReceive($json)", null)
    }
}

/**
 * Hosts a page of `assets/web/` with the hardened settings of [LocalWebPolicy]. [page] is relative to `assets/web/`
 * (for example `games/index.html`); the phone's light or dark theme is passed in the URL. [bridge] is the page's only
 * way back into the app, exposed as `OrbHost`.
 *
 * The system back gesture first asks the page (`window.orbBack()`, true when it handled it) and only then leaves.
 */
@SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
@Composable
fun LocalWebView(page: String, dark: Boolean, background: Color, bridge: Any?, onBack: () -> Unit, modifier: Modifier = Modifier, controller: WebController? = null) {
    val holder = remember { arrayOfNulls<WebView>(1) }
    BackHandler {
        val web = holder[0]
        if (web == null) onBack() else web.evaluateJavascript("(function(){return !!(window.orbBack && window.orbBack());})()") { handled ->
            if (handled != "true") onBack()
        }
    }
    DisposableEffect(Unit) { onDispose { controller?.web = null; holder[0]?.let { it.removeJavascriptInterface(LocalWebPolicy.BRIDGE_NAME); it.destroy() }; holder[0] = null } }
    AndroidView(
        modifier = modifier,
        factory = { ctx ->
            WebView(ctx).also { web ->
                holder[0] = web
                controller?.web = web
                web.layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                web.setBackgroundColor(background.toArgb())
                LocalWebPolicy.configure(web.settings)
                // Downloads are ignored; the debugger is never attached.
                web.setDownloadListener { _, _, _, _, _ -> }
                WebView.setWebContentsDebuggingEnabled(false)
                if (bridge != null) web.addJavascriptInterface(bridge, LocalWebPolicy.BRIDGE_NAME)
                web.webViewClient = LocalWebClient(ctx)
                web.loadUrl(LocalWebPolicy.pageUrl(page, dark))
            }
        },
    )
}

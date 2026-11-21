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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import dev.orb.app.ui.kit.OrbButton
import dev.orb.app.ui.kit.OrbButtonKind
import androidx.compose.ui.Alignment
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.viewinterop.AndroidView
import androidx.webkit.WebViewAssetLoader
import java.io.ByteArrayInputStream
import java.util.concurrent.atomic.AtomicBoolean

/** A refusal with no body: what a page gets for any URL the policy does not allow. */
private fun blocked() = WebResourceResponse("text/plain", "utf-8", 403, "Blocked", emptyMap(), ByteArrayInputStream(ByteArray(0)))

internal class LocalWebClient(context: Context, private val onGone: () -> Unit = {}) : WebViewClient() {
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

    // A crashed renderer would take the app with it: the dead view is removed and destroyed, and the screen offers to reload.
    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
        (view.parent as? ViewGroup)?.removeView(view)
        view.destroy()
        onGone()
        return true
    }
}

/** Lets the screen that hosts a page talk to it: run its `window.orbBack()` or hand it something to receive. */
class WebController {
    internal var web: WebView? = null

    /** Calls `window.orbBack()` and reports whether the page took it; with no page, or none that answers, it is false (the caller leaves by itself). */
    fun back(onResult: (handled: Boolean) -> Unit) {
        val w = web ?: return onResult(false)
        w.evaluateJavascript(BACK_SCRIPT) { onResult(it == "true") }
    }

    /** Calls `window.orbReceive(message)`; [json] is JSON text, which is also a valid JavaScript expression. */
    fun send(json: String) {
        web?.evaluateJavascript("window.orbReceive && window.orbReceive($json)", null)
    }
}

private const val BACK_SCRIPT = "(function(){return !!(window.orbBack && window.orbBack());})()"

/** Runs [action] the first time only: a page can ask to close twice (its own button and the back arrow) and the screen must pop once. */
class OnceAction(private val action: () -> Unit) {
    private val done = AtomicBoolean(false)
    fun run() { if (done.compareAndSet(false, true)) action() }
}

/**
 * Hosts a page of `assets/web/` with the hardened settings of [LocalWebPolicy]. [page] is relative to `assets/web/`
 * (for example `games/index.html`); the phone's light or dark theme is passed in the URL. [bridge] is the page's only
 * way back into the app, exposed as `OrbHost`.
 *
 * [handleBack] false leaves the back gesture alone; [errorContent] replaces the Pizarra's "page stopped" screen.
 *
 * The system back gesture first asks the page (`window.orbBack()`, true when it handled it) and only then leaves.
 */
@SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
@Composable
fun LocalWebView(page: String, dark: Boolean, background: Color, bridge: Any?, onBack: () -> Unit, modifier: Modifier = Modifier, controller: WebController? = null, onGone: () -> Unit = {},
    handleBack: Boolean = true, domStorage: Boolean = true, errorContent: (@Composable (reload: () -> Unit) -> Unit)? = null,
) {
    val holder = remember { arrayOfNulls<WebView>(1) }
    var gone by remember { mutableStateOf(false) }
    var generation by remember { mutableIntStateOf(0) }
    // An embedded page (a chat block) must not take the system back gesture from the screen around it.
    if (handleBack) BackHandler {
        val web = holder[0]
        if (web == null) onBack() else web.evaluateJavascript(BACK_SCRIPT) { handled -> if (handled != "true") onBack() }
    }
    DisposableEffect(Unit) { onDispose { controller?.web = null; holder[0]?.let { it.removeJavascriptInterface(LocalWebPolicy.BRIDGE_NAME); it.destroy() }; holder[0] = null } }
    if (gone) {
        if (errorContent != null) { errorContent { gone = false; generation++ }; return }
        Column(modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
            Text(WhiteboardTexts.GONE_TITLE, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
            OrbButton(WhiteboardTexts.RELOAD, { gone = false; generation++ }, Modifier.padding(top = 8.dp), kind = OrbButtonKind.Ghost)
        }
        return
    }
    key(generation) { AndroidView(
        modifier = modifier,
        factory = { ctx ->
            WebView(ctx).also { web ->
                holder[0] = web
                controller?.web = web
                web.layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                web.setBackgroundColor(background.toArgb())
                LocalWebPolicy.configure(web.settings, domStorage)
                // Downloads are ignored; the debugger is never attached.
                web.setDownloadListener { _, _, _, _, _ -> }
                WebView.setWebContentsDebuggingEnabled(false)
                if (bridge != null) web.addJavascriptInterface(bridge, LocalWebPolicy.BRIDGE_NAME)
                web.webViewClient = LocalWebClient(ctx) {
                    controller?.web = null
                    holder[0] = null
                    gone = true
                    onGone()
                }
                LocalWebPolicy.blockServiceWorkers()
                web.loadUrl(LocalWebPolicy.pageUrl(page, dark))
            }
        },
    ) }
}

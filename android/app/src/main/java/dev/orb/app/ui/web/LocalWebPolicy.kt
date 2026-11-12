package dev.orb.app.ui.web

import android.os.Build
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import androidx.webkit.ServiceWorkerClientCompat
import androidx.webkit.ServiceWorkerControllerCompat
import androidx.webkit.WebViewFeature
import java.io.ByteArrayInputStream
import java.net.URI

/**
 * What a local web page (games, Pizarra) may load. Everything is served from the app's `assets/web/` under one
 * virtual https origin; any other URL is refused, so a page can never reach the network.
 */
object LocalWebPolicy {
    const val HOST = "appassets.androidplatform.net"

    /** The URL prefix the asset loader maps onto `assets/`; only `web/` below it is reachable. */
    const val ASSETS_PATH = "/assets/"
    const val ALLOWED_PREFIX = "/assets/web/"

    const val BRIDGE_NAME = "OrbHost"

    /** The only URL pattern that is served: https, the virtual host, no credentials, no port, a path under `assets/web/`. */
    fun isAllowed(url: String?): Boolean {
        if (url.isNullOrBlank()) return false
        val uri = try { URI(url) } catch (_: Exception) { return false }
        if (uri.scheme != "https" || uri.host != HOST || uri.port != -1 || uri.userInfo != null) return false
        // `rawPath` keeps escapes, so «%2e%2e» cannot slip past the prefix check; the normalised form must still be inside.
        val raw = uri.rawPath ?: return false
        if (raw.contains('%') || raw.contains('\\')) return false
        val normal = uri.normalize().rawPath ?: return false
        return normal.startsWith(ALLOWED_PREFIX) && !normal.contains("/../")
    }

    fun pageUrl(page: String, dark: Boolean): String = "https://$HOST${ALLOWED_PREFIX}$page?theme=${if (dark) "dark" else "light"}"

    /** No page here registers a service worker; if one ever runs, every request it makes is refused. */
    fun blockServiceWorkers() {
        try {
            if (!WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_BASIC_USAGE) || !WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_SHOULD_INTERCEPT_REQUEST)) return
            ServiceWorkerControllerCompat.getInstance().setServiceWorkerClient(object : ServiceWorkerClientCompat() {
                override fun shouldInterceptRequest(request: WebResourceRequest): WebResourceResponse =
                    WebResourceResponse("text/plain", "utf-8", 403, "Blocked", emptyMap(), ByteArrayInputStream(ByteArray(0)))
            })
        } catch (_: Exception) { /* a hardening extra: pages work without it */ }
    }

    /** The page's settings: no file or content access, no network cache, no popups, no downloads, no safe-browsing lookups. */
    @Suppress("SetJavaScriptEnabled")
    fun configure(s: WebSettings) {
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.allowFileAccess = false
        s.allowContentAccess = false
        @Suppress("DEPRECATION")
        s.allowFileAccessFromFileURLs = false
        @Suppress("DEPRECATION")
        s.allowUniversalAccessFromFileURLs = false
        s.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        s.javaScriptCanOpenWindowsAutomatically = false
        s.setSupportMultipleWindows(false)
        s.setGeolocationEnabled(false)
        s.cacheMode = WebSettings.LOAD_NO_CACHE
        s.mediaPlaybackRequiresUserGesture = false
        s.setSupportZoom(false)
        s.builtInZoomControls = false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) s.safeBrowsingEnabled = false
    }
}

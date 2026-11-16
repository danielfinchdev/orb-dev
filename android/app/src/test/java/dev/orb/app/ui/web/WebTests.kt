package dev.orb.app.ui.web

import android.webkit.WebView
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

class WebPolicyTest {
    private val base = "https://appassets.androidplatform.net/assets/web"

    @Test fun servesOnlyTheWebFolderOfTheAssets() {
        assertTrue(LocalWebPolicy.isAllowed("$base/games/index.html?theme=dark"))
        assertTrue(LocalWebPolicy.isAllowed("$base/games/assets/index-abc.js"))
        assertTrue(LocalWebPolicy.isAllowed("$base/games/rhosgfx/wK.svg"))
    }

    @Test fun anythingElseIsBlocked() {
        val urls = listOf(
            null, "", "   ", "not a url",
            "http://appassets.androidplatform.net/assets/web/games/index.html",
            "https://example.com/assets/web/games/index.html",
            "https://appassets.androidplatform.net.evil.com/assets/web/x",
            "https://evil.com@appassets.androidplatform.net/assets/web/x",
            "https://appassets.androidplatform.net:8443/assets/web/x",
            "https://appassets.androidplatform.net/assets/other/x",
            "https://appassets.androidplatform.net/assets/webx/x",
            "https://appassets.androidplatform.net/res/x",
            "https://appassets.androidplatform.net/",
            "file:///android_asset/web/games/index.html",
            "content://dev.orb/x", "javascript:alert(1)", "data:text/html,hi", "blob:https://appassets.androidplatform.net/1",
            "ftp://appassets.androidplatform.net/assets/web/x",
        )
        for (u in urls) assertFalse("must be blocked: $u", LocalWebPolicy.isAllowed(u))
    }

    @Test fun pathTricksDoNotEscapeTheFolder() {
        for (u in listOf("$base/../../res/x", "$base/games/../../other/x", "$base/%2e%2e/x", "$base/games/%2E%2E/%2E%2E/x", "$base\\..\\x")) {
            assertFalse("must be blocked: $u", LocalWebPolicy.isAllowed(u))
        }
        // A harmless «..» that stays inside the folder is fine once normalised.
        assertTrue(LocalWebPolicy.isAllowed("$base/games/../games/index.html"))
    }

    @Test fun pageUrlCarriesTheTheme() {
        assertEquals("$base/games/index.html?theme=dark", LocalWebPolicy.pageUrl("games/index.html", dark = true))
        assertEquals("$base/games/index.html?theme=light", LocalWebPolicy.pageUrl("games/index.html", dark = false))
        assertTrue(LocalWebPolicy.isAllowed(LocalWebPolicy.pageUrl("games/index.html", dark = true)))
    }
}

class GamesBridgeTest {
    @Test fun onlyKnownGamesAndSaneScoresAreKept() {
        assertTrue(GamesBridge.acceptBest("snake", 0))
        assertTrue(GamesBridge.acceptBest("g2048", 123456))
        assertFalse(GamesBridge.acceptBest("snake", -1))
        assertFalse(GamesBridge.acceptBest("snake", GamesBridge.MAX_SCORE + 1))
        assertFalse(GamesBridge.acceptBest("../../etc", 5))
        assertFalse(GamesBridge.acceptBest(null, 5))
        assertFalse(GamesBridge.acceptBest("", 5))
    }

    @Test fun savedBestReachesTheCallbackOnlyWhenAccepted() {
        val got = ArrayList<Pair<String, Int>>()
        val bridge = GamesBridge(onBest = { g, s -> got += g to s }, onClose = {})
        bridge.saveBest("tetris", 900)
        bridge.saveBest("nope", 900)
        bridge.saveBest("tetris", -4)
        assertEquals(listOf("tetris" to 900), got)
    }

    @Test fun theBridgeExposesExactlyTwoMethods() {
        val exposed = GamesBridge::class.java.declaredMethods.filter { m -> m.isAnnotationPresent(android.webkit.JavascriptInterface::class.java) }.map { it.name }.sorted()
        assertEquals(listOf("close", "saveBest"), exposed)
    }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class WebSettingsTest {
    @Test fun theWebViewIsLockedDown() {
        val web = WebView(ApplicationProvider.getApplicationContext())
        LocalWebPolicy.configure(web.settings)
        val s = web.settings
        assertFalse(s.allowFileAccess)
        assertFalse(s.allowContentAccess)
        assertEquals(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW, s.mixedContentMode)
        assertFalse(s.javaScriptCanOpenWindowsAutomatically)
        assertFalse(s.supportMultipleWindows())
        assertFalse(s.safeBrowsingEnabled)
        assertTrue(s.javaScriptEnabled)
    }

    @Test fun blockedRequestsGetAnEmptyForbiddenResponse() {
        val ctx = ApplicationProvider.getApplicationContext<android.content.Context>()
        val client = LocalWebClient(ctx)
        val web = WebView(ctx)
        val req = object : android.webkit.WebResourceRequest {
            override fun getUrl() = android.net.Uri.parse("https://example.com/x.js")
            override fun isForMainFrame() = false
            override fun isRedirect() = false
            override fun hasGesture() = false
            override fun getMethod() = "GET"
            override fun getRequestHeaders(): Map<String, String> = emptyMap()
        }
        val res = client.shouldInterceptRequest(web, req)!!
        assertEquals(403, res.statusCode)
        assertEquals(0, res.data.readBytes().size)
        assertTrue(client.shouldOverrideUrlLoading(web, req))
    }
}

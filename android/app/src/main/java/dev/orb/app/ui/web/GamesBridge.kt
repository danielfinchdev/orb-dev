package dev.orb.app.ui.web

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface

/** The records the games keep on the phone: the best score of each game, never lowered. */
class GameRecords(private val context: Context) {
    private val prefs get() = context.getSharedPreferences("orb_games", Context.MODE_PRIVATE)

    fun best(game: String): Int = prefs.getInt(game, 0)

    fun save(game: String, score: Int) {
        if (score > best(game)) prefs.edit().putInt(game, score).apply()
    }
}

/**
 * The page's only door to the app, exposed as `OrbHost`: two methods and nothing else. Arguments are checked here,
 * because they come from a page.
 */
class GamesBridge(private val onBest: (String, Int) -> Unit, private val onClose: () -> Unit) {
    @JavascriptInterface
    fun saveBest(game: String?, score: Int) {
        if (acceptBest(game, score)) onBest(game!!, score)
    }

    @JavascriptInterface
    fun close() {
        // Bridge calls arrive on a WebView thread; the app's UI is touched on the main one.
        Handler(Looper.getMainLooper()).post(onClose)
    }

    companion object {
        val GAMES = setOf("snake", "tetris", "chess", "runner", "g2048", "breakout", "invaders", "pacman")
        const val MAX_SCORE = 10_000_000

        fun acceptBest(game: String?, score: Int): Boolean = game in GAMES && score in 0..MAX_SCORE
    }
}

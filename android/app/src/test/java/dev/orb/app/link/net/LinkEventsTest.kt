package dev.orb.app.link.net

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.OkHttpClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CopyOnWriteArrayList

/**
 * The live stream, in real time with tiny limits: the watchdog and the socket are real I/O, which virtual time cannot
 * drive (it would jump past the silence before the bytes arrive).
 */
class LinkEventsTest {
    private val timeouts = Timeouts(me = 2_000, events = 2_000, eventsIdle = 500)

    private fun live(block: suspend CoroutineScope.(Rig, LinkClient, CopyOnWriteArrayList<LinkEvent>) -> Unit) = runBlocking {
        // the fake PC and the client share one clock that follows the real time
        val start = System.currentTimeMillis()
        val r = Rig(listOf("https://orb.tail1234.ts.net"), { System.currentTimeMillis() - start })
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val http = OkHttpClient.Builder().addInterceptor(r.pc).build()
        val c = LinkClient(r.session, http, r.clock, scope, timeouts = timeouts, backoff = { 30 })
        val got = CopyOnWriteArrayList<LinkEvent>()
        scope.launch(start = CoroutineStart.UNDISPATCHED) { c.events.collect { got += it } }
        try {
            block(r, c, got)
        } finally {
            c.stop()
            scope.cancel()
        }
    }

    private fun eventually(ms: Long = 5_000, what: String, cond: () -> Boolean) {
        val end = System.nanoTime() + ms * 1_000_000
        while (!cond()) {
            if (System.nanoTime() > end) throw AssertionError("timed out waiting for $what")
            Thread.sleep(10)
        }
    }

    private fun chat(vararg pairs: Pair<String, Any>): JsonObject = buildJsonObject {
        for ((k, v) in pairs) when (v) {
            is Boolean -> put(k, v)
            is Int -> put(k, v)
            else -> put(k, v.toString())
        }
    }

    @Test
    fun `events are opened with the stream key and decoded, and the client asks for deltas`() = live { r, c, got ->
        c.start()
        eventually(what = "stream") { r.pc.streamsOpened.get() == 1 }
        assertTrue("asks for deltas (d: 1)", r.pc.eventsAsked)
        r.pc.emit("notice", chat("text" to "hola"))
        // not for us: another key's line, or junk, is ignored without breaking the stream
        r.pc.ping()
        eventually(what = "event") { got.any { it.name == "notice" } }
        assertEquals("hola", ((got.first { it.name == "notice" }.payload) as JsonObject).str("text"))
        assertTrue(c.connection.value is ConnectionState.Online)
    }

    @Test
    fun `chat deltas are made whole and a lost place asks for a reload`() = live { r, c, got ->
        c.start()
        eventually(what = "stream") { r.pc.streamsOpened.get() == 1 }
        r.pc.emit("chat:state", chat("conversation" to "c1", "busy" to true, "partial" to "Hel"))
        r.pc.emit("chat:state", chat("conversation" to "c1", "busy" to true, "append" to "lo", "base" to 3))
        eventually(what = "two states") { got.count { it.name == "chat:state" } == 2 }
        assertEquals("Hello", ((got.last { it.name == "chat:state" }.payload) as JsonObject).str("partial"))
        r.pc.emit("chat:state", chat("conversation" to "c1", "busy" to true, "append" to "x", "base" to 99))
        eventually(what = "reload") { got.any { it.name == LinkEvent.RELOAD } }
        assertEquals("c1", (got.first { it.name == LinkEvent.RELOAD }.payload as JsonObject).str("conversation"))
    }

    @Test
    fun `the pcs pings keep a quiet stream alive`() = live { r, c, _ ->
        c.start()
        eventually(what = "stream") { r.pc.streamsOpened.get() == 1 }
        // 1.5 s of pings only: three times the idle limit, still the same stream.
        repeat(10) { r.pc.ping(); Thread.sleep(150) }
        assertEquals(1, r.pc.streamsOpened.get())
    }

    @Test
    fun `silence for the idle limit drops the stream and opens a new one`() = live { r, c, _ ->
        c.start()
        eventually(what = "stream") { r.pc.streamsOpened.get() == 1 }
        eventually(what = "reconnect") { r.pc.streamsOpened.get() == 2 }
        assertEquals("never two at once", 1, r.pc.maxOpenStreams.get())
    }

    @Test
    fun `a second stream replaces the first and never runs beside it`() = live { r, c, _ ->
        c.start()
        eventually(what = "stream") { r.pc.streamsOpened.get() == 1 }
        c.reconnectEvents()
        eventually(what = "second stream") { r.pc.streamsOpened.get() == 2 }
        assertEquals(1, r.pc.maxOpenStreams.get())
        eventually(what = "first closed") { r.pc.openStreams.get() == 1 }
    }

    @Test
    fun `pause drops the stream and resume brings it back`() = live { r, c, _ ->
        c.start()
        eventually(what = "stream") { r.pc.streamsOpened.get() == 1 }
        c.pause()
        eventually(what = "closed") { r.pc.openStreams.get() == 0 }
        Thread.sleep(300)
        assertEquals(1, r.pc.streamsOpened.get())
        c.resume()
        eventually(what = "reopened") { r.pc.streamsOpened.get() == 2 }
    }

    @Test
    fun `a pause that lands while the stream is being opened leaves nothing open`() = live { r, c, _ ->
        // The background pause arrives exactly when the PC receives the events request, the narrowest window.
        r.pc.onEventsRequest = { c.pause() }
        c.start()
        eventually(what = "stream asked") { r.pc.streamsOpened.get() == 1 }
        eventually(what = "closed") { r.pc.openStreams.get() == 0 }
        Thread.sleep(700)
        assertEquals(1, r.pc.streamsOpened.get())
        assertEquals(0, r.pc.openStreams.get())
    }

    @Test
    fun `the last event id is sent back when the stream is opened again`() = live { r, c, got ->
        c.start()
        eventually(what = "stream") { r.pc.streamsOpened.get() == 1 }
        r.pc.emit("notice", chat("text" to "uno"), id = "boot1.4")
        // A ping carries no id: it must not change what is sent back.
        r.pc.ping()
        eventually(what = "event") { got.any { it.name == "notice" } }
        c.reconnectEvents()
        eventually(what = "second stream") { r.pc.streamsOpened.get() == 2 }
        assertEquals(listOf<String?>(null, "boot1.4"), r.pc.lastEventIds.toList())
    }

    @Test
    fun `a resync makes the screens read their state again`() = live { r, c, got ->
        c.start()
        eventually(what = "stream") { r.pc.streamsOpened.get() == 1 }
        // Both ways the PC may say it: a sealed event and a bare `event: resync` block.
        r.pc.emit("resync", chat(), id = "boot2.0")
        eventually(what = "resync") { got.any { it.name == LinkEvent.RESYNC } }
        assertTrue(got.any { it.name == "board:changed" } && got.any { it.name == "inbox:changed" })
        got.clear()
        r.pc.raw("event: resync\nid: boot2.1\n\n")
        eventually(what = "bare resync") { got.any { it.name == LinkEvent.RESYNC } }
        c.reconnectEvents()
        eventually(what = "second stream") { r.pc.streamsOpened.get() == 2 }
        assertEquals("boot2.1", r.pc.lastEventIds.last())
    }

    @Test
    fun `the silence limit of a stream is 40 seconds and the pc pings every 15`() {
        assertEquals(40_000L, Timeouts().eventsIdle)
        assertEquals(4_000L, Timeouts().connect)
        assertEquals(45_000L, Timeouts().call)
        assertEquals(8_000L, Timeouts().me)
    }
}

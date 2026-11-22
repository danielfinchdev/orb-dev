package dev.orb.app.link.net

import dev.orb.app.ui.offline.OfflineTexts
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The link's resilience on virtual time, with a fake PC and fake clocks: resends, racing addresses, waits and the clock guard. */
@OptIn(ExperimentalCoroutinesApi::class)
class LinkResilienceTest {
    private val ts = "https://orb.tail1234.ts.net"
    private val home = "http://192.168.1.5:3131"

    private fun TestScope.rig(urls: List<String> = listOf(ts), at: Int = 0) = Rig(urls, { currentTime }, at)

    private fun TestScope.client(r: Rig, scope: CoroutineScope = backgroundScope) =
        LinkClient(r.session, r.pc.client(), r.clock, scope, io = Dispatchers.Unconfined)

    private fun Result<*>.error(): LinkError = (exceptionOrNull() as LinkException).error

    // ---- a call with no answer goes once more, with the same nonce

    @Test
    fun `a call whose connection reset is sent once more with the same nonce and runs once`() = runTest {
        val r = rig()
        r.pc.resetOnce += "orb.tail1234.ts.net"
        var runs = 0
        r.pc.callResult = { _, _ -> runs++; buildJsonObject { put("ok", true) } }
        assertTrue(client(r).call("chat.send").isSuccess)
        val nonces = r.pc.log.mapNotNull { it.nonce }
        assertEquals(2, nonces.size)
        assertEquals("the repeat carries the same nonce", nonces[0], nonces[1])
        assertEquals(1, runs)
    }

    @Test
    fun `a call is repeated only once`() = runTest {
        val r = rig()
        r.pc.resetAfterReceive += "orb.tail1234.ts.net"
        assertEquals(LinkError.Timeout, client(r).call("chat.send").error())
        assertEquals(2, r.pc.log.size)
    }

    @Test
    fun `a repeated nonce refused by a pc that kept no answer is not an unlink`() = runTest {
        val r = rig()
        r.pc.resetOnce += "orb.tail1234.ts.net"
        r.pc.ranBeforeReset = true
        val c = client(r)
        // The old PC calls the repeat a replay (401): that is no proof the link is gone.
        assertEquals(LinkError.Timeout, c.call("chat.send").error())
        assertFalse(c.connection.value is ConnectionState.Unlinked)
    }

    @Test
    fun `a 410 gone on the repeat is an unknown result that never unlinks and reads everything again`() = runTest {
        val r = rig()
        r.pc.resetOnce += "orb.tail1234.ts.net"
        r.pc.ranBeforeReset = true
        r.pc.goneOnReplay = true
        val c = client(r)
        val seen = ArrayList<String>()
        backgroundScope.launch(start = kotlinx.coroutines.CoroutineStart.UNDISPATCHED) { c.events.collect { seen += it.name } }
        assertEquals(LinkError.Timeout, c.call("chat.send").error())
        assertFalse(c.connection.value is ConnectionState.Unlinked)
        runCurrent()
        assertTrue(LinkEvent.RESYNC in seen)
        assertEquals(2, r.pc.log.size)
    }

    @Test
    fun `a me is never repeated with the same nonce`() = runTest {
        val r = rig()
        r.pc.resetOnce += "orb.tail1234.ts.net"
        assertEquals(LinkError.Offline, client(r).me().error())
        assertEquals(1, r.pc.log.size)
    }

    // ---- all addresses at once

    @Test
    fun `me asks every address at the same moment and keeps the one that answers`() = runTest {
        val r = rig(listOf(ts, home))
        r.pc.down += "orb.tail1234.ts.net"
        val c = client(r)
        assertTrue(c.me().isSuccess)
        assertEquals("no waiting for the first to fail", listOf(0L, 0L), r.pc.tries.toList())
        assertEquals(1, c.currentSession.at)
        assertEquals(home, (c.connection.value as ConnectionState.Online).base)
    }

    @Test
    fun `a plain 401 from a stranger on one address does not beat the real pc on the other`() = runTest {
        val r = rig(listOf(home, "http://192.168.1.77:3131"))
        // The second address belongs to someone else on the Wi-Fi: it answers 401 to everything.
        val real = r.pc.client()
        val http = okhttp3.OkHttpClient.Builder().addInterceptor { chain ->
            if (chain.request().url.host == "192.168.1.77") {
                okhttp3.Response.Builder().request(chain.request()).protocol(okhttp3.Protocol.HTTP_1_1).code(401).message("x")
                    .body("{}".toResponseBody()).build()
            } else real.newCall(chain.request()).execute()
        }.build()
        val c = LinkClient(r.session, http, r.clock, backgroundScope, io = Dispatchers.Unconfined)
        assertTrue(c.me().isSuccess)
        assertEquals(0, c.currentSession.at)
    }

    @Test
    fun `when every address fails the most telling failure is told`() = runTest {
        val r = rig(listOf(ts, home))
        r.pc.down += "orb.tail1234.ts.net"
        r.pc.slow += "192.168.1.5"
        val c = client(r)
        assertEquals(LinkError.Timeout, c.me().error())
        assertTrue(c.connection.value is ConnectionState.Offline)
    }

    @Test
    fun `a call still goes to one address at a time`() = runTest {
        val r = rig(listOf(ts, home))
        assertTrue(client(r).call("chat.send").isSuccess)
        assertEquals(listOf("orb.tail1234.ts.net"), r.pc.log.map { it.host })
    }

    // ---- waits, «Reintentar ahora», and what is said after 30 s

    @Test
    fun `retry now cuts the wait even in the middle of the longest one`() = runTest {
        val r = rig(listOf(home))
        r.pc.down += "192.168.1.5"
        val c = client(r)
        c.start()
        // Walk to the 30 s wait: attempts at 0, 1, 3, 8, 18 and 48 s.
        advanceTimeBy(48_500)
        runCurrent()
        val before = r.pc.tries.size
        assertEquals(6, before)
        c.resume()
        runCurrent()
        assertEquals("an attempt at once", before + 1, r.pc.tries.size)
        c.stop()
    }

    @Test
    fun `after 30 seconds without a link the band says what is wrong and what to check`() = runTest {
        val r = rig(listOf(home))
        r.pc.down += "192.168.1.5"
        val c = client(r)
        c.start()
        runCurrent()
        val first = c.connection.value as ConnectionState.Offline
        assertNotNull(first.since)
        assertFalse(OfflineTexts.isStuck(first, r.clock.nowMs()))
        assertTrue(OfflineTexts.band(first, r.clock.nowMs())!!.startsWith("Sin conexión con tu PC."))
        advanceTimeBy(31_000)
        runCurrent()
        val later = c.connection.value as? ConnectionState.Offline ?: ConnectionState.Offline(null, null, first.since)
        val text = OfflineTexts.band(later, r.clock.nowMs())!!
        assertTrue(text, text.startsWith("Tu PC no responde por Wi-Fi ni por Tailscale. ¿Está Orb abierto?"))
        c.stop()
    }

    @Test
    fun `the time without a link starts again after the pc answers`() = runTest {
        val r = rig(listOf(home))
        r.pc.down += "192.168.1.5"
        val c = client(r)
        assertTrue(c.me().isFailure)
        val since = (c.connection.value as ConnectionState.Offline).since
        assertNotNull(since)
        r.pc.down.clear()
        assertTrue(c.me().isSuccess)
        advanceTimeBy(60_000)
        r.pc.down += "192.168.1.5"
        assertTrue(c.me().isFailure)
        assertTrue((c.connection.value as ConnectionState.Offline).since!! > since!!)
    }

    // ---- safety: a 401 over plain http and the clock

    @Test
    fun `a 401 over plain http on the live stream never unlinks`() = runTest {
        val r = rig(listOf(home))
        r.pc.reply = FakePc.Reply.Unlinked401
        val c = client(r)
        c.start()
        advanceTimeBy(5_000)
        runCurrent()
        assertFalse(c.connection.value is ConnectionState.Unlinked)
        c.stop()
    }

    @Test
    fun `over plain http a clock past the pcs window is not corrected`() = runTest {
        val r = rig(listOf(home))
        r.pc.pcOffset = 6 * 60_000L
        assertEquals(LinkError.Refused(409, "reloj", null), client(r).call("app.state").error())
    }

    @Test
    fun `a repeat that gets a 409 is not sealed again`() = runTest {
        val r = rig()
        r.pc.resetOnce += "orb.tail1234.ts.net"
        r.pc.pcOffset = 3_600_000L
        assertEquals(LinkError.Timeout, client(r).call("chat.send").error())
        val nonces = r.pc.log.mapNotNull { it.nonce }
        assertEquals(2, nonces.size)
        assertEquals(nonces[0], nonces[1])
    }

    @Test
    fun `a pc that answers me sealed but with an error is offline and the time runs`() = runTest {
        val r = rig()
        r.pc.reply = FakePc.Reply.WrongNonce
        val c = client(r)
        c.start()
        runCurrent()
        val st = c.connection.value
        assertTrue(st.toString(), st is ConnectionState.Offline)
        assertNotNull((st as ConnectionState.Offline).since)
        c.stop()
    }

    @Test
    fun `a pc on the wifi cannot move the clock of the phone by hours`() = runTest {
        val r = rig(listOf(home))
        r.pc.pcOffset = 3_600_000L
        val c = client(r)
        assertEquals(LinkError.Refused(409, "reloj", null), c.call("app.state").error())
        // The next request is still stamped with the phone's own clock: nothing was moved.
        r.pc.pcOffset = 0
        assertTrue(c.call("app.state").isSuccess)
    }

    @Test
    fun `the same big correction over https is taken`() = runTest {
        val r = rig(listOf(ts))
        r.pc.pcOffset = 3_600_000L
        assertTrue(client(r).call("app.state").isSuccess)
    }

    // ---- what «Este móvil» shows

    @Test
    fun `each address keeps the last time it worked and why the last try failed`() = runTest {
        val r = rig(listOf(ts, home))
        r.pc.down += "orb.tail1234.ts.net"
        val c = client(r)
        assertTrue(c.me().isSuccess)
        val byUrl = c.paths.value.associateBy { it.url }
        assertEquals(PathError.UNREACHABLE, byUrl[ts]!!.lastError)
        assertNull(byUrl[ts]!!.lastOkAt)
        assertNotNull(byUrl[home]!!.lastOkAt)
        assertNull(byUrl[home]!!.lastError)
    }

    @Test
    fun `the doors the pc reports are read and a missing list is no problem`() = runTest {
        val r = rig()
        val c = client(r)
        assertTrue(c.me().isSuccess)
        assertTrue(c.pcEntries.value.isEmpty())
        r.pc.meResult = JsonObject(r.pc.meResult + ("entries" to JsonArray(listOf(
            buildJsonObject { put("tipo", "wifi"); put("url", home); put("abierta", true); put("ultimoOk", "2026-11-22T10:00:00.000Z") },
            buildJsonObject { put("tipo", "tailscale"); put("url", ts); put("abierta", false); put("ultimoError", "no responde") },
            JsonPrimitive("junk"),
        ))))
        assertTrue(c.me().isSuccess)
        val e = c.pcEntries.value
        assertEquals(listOf("wifi", "tailscale"), e.map { it.type })
        assertEquals(false, e[1].open)
        assertEquals("no responde", e[1].lastError)
    }

    @Test
    fun `the pc giving up on a call after its limit is a timeout and is not sent again`() = runTest {
        val r = rig()
        r.pc.callResult = { _, _ -> buildJsonObject { put("ok", false); put("status", 504); put("reason", "timeout"); put("error", "tarde") } }
        assertEquals(LinkError.Timeout, client(r).call("git.push").error())
        assertEquals(1, r.pc.log.size)
    }

    // ---- the reader

    @Test
    fun `the sse reader gives the id and the event name of a block`() {
        val buf = Buffer().writeUtf8("id: a1.7\ndata: {\"x\":1}\n\nevent: resync\n\n: ping\n\nid: a1.8\n\n")
        val reader = SseReader(buf)
        assertEquals(SseLine.Data("{\"x\":1}", "a1.7", null), reader.next())
        assertEquals(SseLine.Data("", null, "resync"), reader.next())
        assertEquals(SseLine.Comment, reader.next())
        assertEquals(SseLine.Comment, reader.next())
        assertEquals(SseLine.Data("", "a1.8", null), reader.next())
        assertNull(reader.next())
    }
}

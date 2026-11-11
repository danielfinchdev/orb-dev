package dev.orb.app.link.net

import dev.orb.app.link.crypto.LinkCrypto
import dev.orb.app.link.payload.orderBases
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

const val DEVICE_ID = "11111111-2222-3333-4444-555555555555"

/** A fake PC and the session that is linked to it. */
class Rig(urls: List<String>, elapsed: () -> Long = { 0L }, at: Int = 0) {
    val clock = TestClock(elapsed)
    val pc = FakePc(clock)
    private val phone = LinkCrypto.newKeyPair()
    val session = LinkSession(DEVICE_ID, phone.priv, pc.keys.pub, urls, at)

    init {
        pc.deviceId = DEVICE_ID
        pc.devPub = phone.pub
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class LinkClientTest {
    private val ts = "https://orb.tail1234.ts.net"
    private val home = "http://192.168.1.5:3131"

    private fun TestScope.rig(urls: List<String> = listOf(ts), at: Int = 0) = Rig(urls, { currentTime }, at)

    private fun TestScope.client(r: Rig, scope: CoroutineScope = backgroundScope, timeouts: Timeouts = Timeouts()) =
        LinkClient(r.session, r.pc.client(), r.clock, scope, io = Dispatchers.Unconfined, timeouts = timeouts)

    private fun Result<*>.error(): LinkError = (exceptionOrNull() as LinkException).error

    @Test
    fun `a sealed call round trips and carries the device header`() = runTest {
        val r = rig()
        r.pc.callResult = { m, p -> buildJsonObject { put("ok", true); put("result", buildJsonObject { put("method", m); put("params", p) }) } }
        val res = client(r).call("inbox.list", buildJsonObject { put("a", 1) })
        val out = res.getOrThrow() as JsonObject
        assertEquals("inbox.list", out.str("method"))
        assertEquals("1", ((out["params"] as JsonObject)["a"] as JsonPrimitive).content)
        assertEquals("call", r.pc.log.single().kind)
    }

    @Test
    fun `an answer with the wrong nonce, the wrong aad, no seal or tampered is rejected`() = runTest {
        for (mode in listOf(FakePc.Reply.WrongNonce, FakePc.Reply.WrongAad, FakePc.Reply.Unsealed, FakePc.Reply.Tampered)) {
            val r = rig()
            r.pc.reply = mode
            val res = client(r).call("app.state")
            assertEquals(mode.name, LinkError.BadAnswer, res.error())
        }
    }

    @Test
    fun `a 409 with the pc time fixes the clock and the request is retried once with a new nonce`() = runTest {
        val r = rig()
        r.pc.pcOffset = 3_600_000 // the phone is an hour behind
        val c = client(r)
        assertTrue(c.call("app.state").isSuccess)
        assertEquals(2, r.pc.log.size)
        assertEquals(2, r.pc.log.mapNotNull { it.nonce }.toSet().size)
        // The skew is kept: the next call is accepted at the first try.
        assertTrue(c.call("app.state").isSuccess)
        assertEquals(3, r.pc.log.size)
    }

    @Test
    fun `a second 409 is a refusal, not a loop`() = runTest {
        val r = rig()
        r.pc.stubbornClock = true
        val res = client(r).call("app.state")
        assertEquals(LinkError.Refused(409, "reloj", null), res.error())
        assertEquals(2, r.pc.log.size)
    }

    @Test
    fun `no request ever reuses a nonce`() = runTest {
        val r = rig()
        val c = client(r)
        repeat(25) { assertTrue(c.call("app.state").isSuccess) }
        // The fake PC answers a repeated nonce with 401, which would have made these calls fail as NotLinked.
        assertEquals(25, r.pc.seenNonces.size)
    }

    @Test
    fun `timeout and offline are told apart and the state follows`() = runTest {
        val r = rig(listOf(home))
        val c = client(r)
        r.pc.down += "192.168.1.5"
        assertEquals(LinkError.Offline, c.call("app.state").error())
        assertTrue(c.connection.value is ConnectionState.Offline)
        r.pc.down.clear()
        r.pc.slow += "192.168.1.5"
        assertEquals(LinkError.Timeout, c.call("app.state").error())
    }

    @Test
    fun `a call that timed out is not sent to the next address but a me is`() = runTest {
        val r = rig(listOf(ts, home))
        r.pc.slow += "orb.tail1234.ts.net"
        val c = client(r)
        assertEquals(LinkError.Timeout, c.call("chat.send").error())
        assertTrue("the second address never saw the call", r.pc.log.none { it.host == "192.168.1.5" })
        assertEquals("the next request starts at the next address", 1, c.currentSession.at)
        // A quick check that changes nothing may go on to the next address.
        val c2 = client(r)
        assertTrue(c2.me().isSuccess)
        assertEquals(listOf("192.168.1.5"), r.pc.log.map { it.host })
    }

    @Test
    fun `addresses are tried https first then tailscale then the home network`() = runTest {
        val ordered = orderBases(listOf(home, "http://100.101.102.103:3131", ts))
        assertEquals(listOf(ts, "http://100.101.102.103:3131", home), ordered)
        val r = rig(ordered)
        r.pc.down += "orb.tail1234.ts.net"
        r.pc.down += "100.101.102.103"
        val c = client(r)
        assertTrue(c.me().isSuccess)
        assertEquals(listOf("192.168.1.5"), r.pc.log.map { it.host })
        assertEquals(2, c.currentSession.at)
        // The one that worked is remembered: the next request goes straight there.
        r.pc.log.clear()
        assertTrue(c.call("app.state").isSuccess)
        assertEquals(listOf("192.168.1.5"), r.pc.log.map { it.host })
    }

    @Test
    fun `plain http to a public address is never requested`() = runTest {
        val r = rig(listOf("http://203.0.113.9:3131"))
        val c = client(r)
        assertEquals(LinkError.Offline, c.call("app.state").error())
        assertEquals(0, r.pc.tries.size)
    }

    @Test
    fun `the last working address is reported to be saved`() = runTest {
        val r = rig(listOf(ts, home))
        r.pc.down += "orb.tail1234.ts.net"
        val saved = ArrayList<Int>()
        val c = LinkClient(r.session, r.pc.client(), r.clock, backgroundScope, io = Dispatchers.Unconfined, onSessionChanged = { saved += it.at })
        assertTrue(c.me().isSuccess)
        assertEquals(listOf(1), saved)
    }

    @Test
    fun `401 unlinks the phone`() = runTest {
        val r = rig()
        r.pc.reply = FakePc.Reply.Unlinked401
        val c = client(r)
        assertEquals(LinkError.NotLinked, c.call("app.state").error())
        assertEquals(ConnectionState.Unlinked, c.connection.value)
    }

    @Test
    fun `me sends the protocols and says the app is too old on 426`() = runTest {
        val r = rig()
        r.pc.meUpdate = true
        val c = client(r)
        assertEquals(LinkError.Update(UpdateSide.App), c.me().error())
        assertEquals(ConnectionState.UpdateApp, c.connection.value)
    }

    @Test
    fun `a pc that needs a newer protocol is UpdateApp and an old pc is UpdatePc`() = runTest {
        val r = rig()
        r.pc.meResult = buildJsonObject { put("name", "Orb"); put("v", 5); put("min", 5) }
        val c = client(r)
        assertEquals(LinkError.Update(UpdateSide.App), c.me().error())
        assertEquals(ConnectionState.UpdateApp, c.connection.value)

        val r2 = rig()
        r2.pc.meResult = buildJsonObject { put("name", "Orb"); put("v", 3); put("min", 2) }
        val c2 = client(r2)
        assertEquals(LinkError.Update(UpdateSide.Pc), c2.me().error())
        assertEquals(ConnectionState.UpdatePc, c2.connection.value)
    }

    @Test
    fun `me announces the client and goes online with the pc name and methods`() = runTest {
        val r = rig()
        r.pc.meResult = buildJsonObject {
            put("name", "Orb de Dani"); put("v", 4); put("min", 2); put("version", "3.8.4")
            put("methods", kotlinx.serialization.json.JsonArray(listOf(JsonPrimitive("pc.screenshot"))))
        }
        val c = client(r)
        val info = c.me().getOrThrow()
        val st = c.connection.value as ConnectionState.Online
        assertEquals(ts, st.base)
        assertEquals("Orb de Dani", st.pcName)
        assertEquals(PcVersions(4, 2, "3.8.4"), st.versions)
        assertTrue(c.pcSupports("pc.screenshot"))
        assertFalse(c.pcSupports("projects.mergePr"))
        assertEquals(setOf("pc.screenshot"), info.methods)
    }

    @Test
    fun `a pc that needs attention is said as such`() = runTest {
        val r = rig()
        r.pc.reply = FakePc.Reply.Attention503
        val c = client(r)
        assertEquals(LinkError.Attention("migration"), c.call("app.state").error())
        assertEquals(ConnectionState.Attention("migration"), c.connection.value)
    }

    @Test
    fun `the pc refusing a call keeps its words and reason`() = runTest {
        val r = rig()
        r.pc.callResult = { _, _ -> buildJsonObject { put("ok", false); put("status", 403); put("error", "no permitido"); put("reason", "grant") } }
        val c = client(r)
        assertEquals(LinkError.Refused(403, "no permitido", "grant"), c.call("tasks.create").error())
        r.pc.callResult = { _, _ -> buildJsonObject { put("ok", false); put("status", 426); put("update", "me"); put("error", "actualiza") } }
        assertEquals(LinkError.Update(UpdateSide.App), c.call("tasks.create").error())
    }

    @Test
    fun `retry delays grow 3 6 12 24 30 30 seconds`() {
        assertEquals(listOf(3000L, 6000L, 12000L, 24000L, 30000L, 30000L), (0..5).map { retryDelay(it) })
    }

    @Test
    fun `while the pc is off the link retries with growing pauses and resume tries at once`() = runTest {
        val r = rig(listOf(home))
        r.pc.down += "192.168.1.5"
        val c = client(r)
        c.start()
        runCurrent()
        assertEquals(listOf(0L), r.pc.tries)
        val first = c.connection.value as ConnectionState.Offline
        assertEquals(r.clock.base + 3000, first.nextRetryAt)
        advanceTimeBy(105_001)
        assertEquals(listOf(0L, 3_000L, 9_000L, 21_000L, 45_000L, 75_000L, 105_000L), r.pc.tries.toList())

        // Back from the background (or «reintentar»): an attempt at once, and the pauses start again at 3 s.
        r.pc.tries.clear()
        val now = currentTime
        c.resume()
        runCurrent()
        assertEquals(listOf(now), r.pc.tries.toList())
        advanceTimeBy(3_001)
        assertEquals(2, r.pc.tries.size)
        c.stop()
    }

    @Test
    fun `pause stops the retries until resume`() = runTest {
        val r = rig(listOf(home))
        r.pc.down += "192.168.1.5"
        val c = client(r)
        c.start()
        runCurrent()
        c.pause()
        val n = r.pc.tries.size
        advanceTimeBy(120_000)
        assertEquals(n, r.pc.tries.size)
        c.resume()
        runCurrent()
        assertEquals(n + 1, r.pc.tries.size)
        c.stop()
    }

    @Test
    fun `an upload is sealed with the image aad and returns the name the pc gave`() = runTest {
        val r = rig()
        val c = client(r)
        val png = byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 1, 2, 3)
        assertEquals("123-abcd.png", c.upload(png, "image/png").getOrThrow())
        assertTrue(r.pc.uploads.single().contentEquals(png))
        // not sent again to another address after a timeout
        val r2 = rig(listOf(ts, home))
        r2.pc.slow += "orb.tail1234.ts.net"
        assertEquals(LinkError.Timeout, client(r2).upload(png, "image/png").error())
        assertTrue(r2.pc.uploads.isEmpty())
    }

    @Test
    fun `an upload survives a clock that is off`() = runTest {
        val r = rig()
        r.pc.pcOffset = 3_600_000
        assertTrue(client(r).upload(byteArrayOf(1), "image/png").isSuccess)
    }

    @Test
    fun `a notification action sends only its token and an expired one is not an unlink`() = runTest {
        val r = rig()
        val c = client(r)
        assertTrue(c.noteAction("tok").isSuccess)
        r.pc.noteActionOk = false
        assertEquals(LinkError.Refused(401, "caducado", null), c.noteAction("old").error())
        assertTrue(c.connection.value !is ConnectionState.Unlinked)
    }

    @Test
    fun `an answer far bigger than a plain error body is a bad answer, not memory`() = runTest {
        val r = rig()
        r.pc.reply = FakePc.Reply.Huge
        assertEquals(LinkError.BadAnswer, client(r).call("app.state").error())
    }

    @Test
    fun `a body that breaks while reading a 503 on the stream does not stop the link`() = runTest {
        val r = rig()
        r.pc.eventsMode = FakePc.EventsMode.BrokenBody503
        val c = client(r)
        c.start()
        runCurrent()
        assertEquals(1, r.pc.eventsRequests.get())
        advanceTimeBy(3_001)
        assertEquals("it kept trying", 2, r.pc.eventsRequests.get())
        c.stop()
    }

    @Test
    fun `repeated 409 on the stream never loops faster than the pauses`() = runTest {
        val r = rig()
        r.pc.pcOffset = 3_600_000 // me() fixes the clock; the stream then keeps saying 409
        r.pc.eventsMode = FakePc.EventsMode.ClockOff409
        val c = client(r)
        c.start()
        runCurrent()
        advanceTimeBy(30_000)
        // 3 s, then 6 s, 12 s... (the clock did not change, so no quick retry): 4 attempts at 0, 3, 9, 21 s
        assertEquals(4, r.pc.eventsRequests.get())
        c.stop()
    }

    @Test
    fun `a nonce is not re-sent by the http stack after a dropped connection`() = kotlinx.coroutines.runBlocking {
        val server = okhttp3.mockwebserver.MockWebServer()
        server.enqueue(okhttp3.mockwebserver.MockResponse().setSocketPolicy(okhttp3.mockwebserver.SocketPolicy.DISCONNECT_AFTER_REQUEST))
        server.enqueue(okhttp3.mockwebserver.MockResponse().setBody("{}"))
        server.start()
        try {
            val base = "http://127.0.0.1:${server.port}"
            val r = Rig(listOf(base))
            val c = LinkClient(r.session, okhttp3.OkHttpClient(), r.clock, kotlinx.coroutines.CoroutineScope(Dispatchers.Default))
            val err = c.call("chat.send").error()
            assertTrue(err is LinkError.Offline || err is LinkError.Timeout)
            assertEquals("one request, never re-sent with the same nonce", 1, server.requestCount)
            assertTrue(c.connection.value !is ConnectionState.Unlinked)
        } finally {
            server.shutdown()
        }
    }
}

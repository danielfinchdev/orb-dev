package dev.orb.app.link.net

import dev.orb.app.link.crypto.B64
import dev.orb.app.link.crypto.LinkCrypto
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okio.Buffer
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SmallPartsTest {
    private fun state(vararg p: Pair<String, Any?>): JsonObject = buildJsonObject {
        for ((k, v) in p) when (v) {
            null -> put(k, JsonPrimitive(null as String?))
            is Boolean -> put(k, v)
            is Int -> put(k, v)
            else -> put(k, v.toString())
        }
    }

    // ------------------------------------------------------------------ streamText / ChatStreams

    @Test
    fun `a whole partial text, or none, is the text`() {
        assertEquals("abc", streamText("old", state("partial" to "abc")))
        assertEquals("", streamText(null, state("busy" to true)))
    }

    @Test
    fun `an append continues from base of what is held`() {
        assertEquals("Hello", streamText("Hel", state("append" to "lo", "base" to 3)))
        assertEquals("Hexy", streamText("Hello", state("append" to "xy", "base" to 2)))
    }

    @Test
    fun `an append that does not follow what is held is a lost place`() {
        assertNull(streamText(null, state("append" to "x", "base" to 0)))
        assertNull(streamText("Hel", state("append" to "x", "base" to 4)))
        assertNull(streamText("Hel", state("append" to "x", "base" to -1)))
        assertNull(streamText("Hel", state("append" to "x")))
    }

    @Test
    fun `positions are utf-16 code units like javascript strings`() {
        val held = "a😀" // a + one emoji = 3 code units
        assertEquals(3, held.length)
        assertEquals("a😀!", streamText(held, state("append" to "!", "base" to 3)))
    }

    @Test
    fun `chat streams keeps the text per conversation and asks for a reload when it loses its place`() {
        val streams = ChatStreams()
        val first = streams.apply(state("conversation" to "c1", "busy" to true, "partial" to "Hel"))!!
        assertEquals("Hel", first.str("partial"))
        val next = streams.apply(state("conversation" to "c1", "busy" to true, "append" to "lo", "base" to 3))!!
        assertEquals("Hello", next.str("partial"))
        assertNull("append and base are gone", next["append"])
        assertEquals("Hello", streams.held("c1"))
        // another conversation is independent
        assertNull(streams.held("c2"))
        // not busy any more: nothing is held
        streams.apply(state("conversation" to "c1", "busy" to false, "partial" to "Hello"))
        assertNull(streams.held("c1"))
        // lost place
        assertNull(streams.apply(state("conversation" to "c1", "busy" to true, "append" to "x", "base" to 1)))
    }

    // ------------------------------------------------------------------ SSE

    private fun sse(text: String): List<SseLine> {
        val r = SseReader(Buffer().writeUtf8(text))
        val out = ArrayList<SseLine>()
        while (true) out += r.next() ?: break
        return out
    }

    @Test
    fun `the sse reader keeps comments, joins data lines and ignores other fields`() {
        val lines = sse(": hola\n\n: ping\n\ndata: abc\n\ndata: x\ndata: y\n\nevent: z\ndata:q\n\n")
        assertEquals(
            listOf(SseLine.Comment, SseLine.Comment, SseLine.Comment, SseLine.Comment, SseLine.Data("abc"), SseLine.Data("xy"), SseLine.Data("q")),
            lines,
        )
    }

    // ------------------------------------------------------------------ stored session

    private val priv = ByteArray(32) { (it + 1).toByte() }
    private val pcPub = LinkCrypto.publicKeyOf(ByteArray(32) { (it + 40).toByte() })

    @Test
    fun `a session stored by the 3_8_1 app is read`() {
        // Exactly the keys web-bridge.js › pairWith writes: priv and pc are base64url, fp is the PC fingerprint.
        val old = """{"id":"11111111-2222-3333-4444-555555555555","priv":"${B64.enc(priv)}","pc":"${B64.enc(pcPub)}","fp":"${LinkCrypto.fingerprint(pcPub)}","urls":["https://orb.tail1234.ts.net","http://192.168.1.5:3131"],"at":1,"name":"Orb de Dani"}"""
        val s = LinkSessionCodec.decode(old)!!
        assertEquals("11111111-2222-3333-4444-555555555555", s.id)
        assertArrayEquals(priv, s.priv)
        assertArrayEquals(pcPub, s.pcPub)
        assertEquals(listOf("https://orb.tail1234.ts.net", "http://192.168.1.5:3131"), s.urls)
        assertEquals(1, s.at)
        assertEquals("Orb de Dani", s.name)
        assertEquals(LinkCrypto.fingerprint(pcPub), s.pc)
        assertArrayEquals(LinkCrypto.sessionKey(priv, pcPub), s.key)
    }

    @Test
    fun `the 3_8_0 shape without fp and name still reads and a bad one does not`() {
        val min = """{"id":"x","priv":"${B64.enc(priv)}","pc":"${B64.enc(pcPub)}","urls":["http://192.168.1.5:3131"]}"""
        val s = LinkSessionCodec.decode(min)!!
        assertEquals(0, s.at)
        assertNull(s.name)
        assertNull(LinkSessionCodec.decode(null))
        assertNull(LinkSessionCodec.decode("not json"))
        assertNull(LinkSessionCodec.decode("""{"id":"x","priv":"AAAA","pc":"AAAA","urls":["http://a"]}"""))
        assertNull("no usable address", LinkSessionCodec.decode("""{"id":"x","priv":"${B64.enc(priv)}","pc":"${B64.enc(pcPub)}","urls":["ftp://a"]}"""))
        assertEquals("an index out of range falls back to 0", 0, LinkSessionCodec.decode(min.replace("}", ""","at":7}"""))!!.at)
    }

    @Test
    fun `encoding writes the same fields the old app reads and round trips`() {
        val s = LinkSession("id-1", priv, pcPub, listOf("https://a.ts.net", "http://192.168.1.5:3131"), 1, "Orb")
        val text = LinkSessionCodec.encode(s)
        val o = kotlinx.serialization.json.Json.parseToJsonElement(text) as JsonObject
        assertEquals(setOf("id", "priv", "pc", "fp", "urls", "at", "name"), o.keys)
        assertEquals(B64.enc(priv), o.str("priv"))
        assertEquals(B64.enc(pcPub), o.str("pc"))
        val back = LinkSessionCodec.decode(text)!!
        assertEquals(s.urls, back.urls)
        assertEquals(1, back.at)
        assertNotNull(back.name)
        assertTrue("the private key never reaches a log", !s.toString().contains(B64.enc(priv)))
    }

    @Test
    fun `the sse reader refuses a line or an event over the cap`() {
        fun fails(text: String): Boolean = try {
            val r = SseReader(Buffer().writeUtf8(text), maxBytes = 16)
            while (r.next() != null) { /* drain */ }
            false
        } catch (e: java.io.IOException) { true }
        assertTrue(fails("data: " + "x".repeat(100) + "\n\n"))
        assertTrue("many small lines add up", fails("data: 0123456789\ndata: 0123456789\n\n"))
        assertTrue("no newline within the cap", fails("x".repeat(100)))
        assertTrue(!fails("data: ok\n\n"))
    }
}

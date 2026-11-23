package dev.orb.app.link.crypto

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.AfterClass
import org.junit.Test

/** Every case of `vectors/crypto.json` (generated from the PC's real code) must be reproduced byte for byte. */
class LinkCryptoVectorsTest {
    companion object {
        private val v: JsonObject = Json.parseToJsonElement(
            LinkCryptoVectorsTest::class.java.getResourceAsStream("/vectors/crypto.json")!!.readBytes().toString(Charsets.UTF_8)
        ).jsonObject
        private val counts = linkedMapOf<String, Int>()

        private fun hit(section: String) { counts[section] = (counts[section] ?: 0) + 1 }

        @AfterClass @JvmStatic fun summary() {
            println("crypto vectors asserted: " + counts.entries.joinToString(", ") { "${it.key}=${it.value}" } + " (total ${counts.values.sum()})")
        }

        fun hex(b: ByteArray) = b.joinToString("") { "%02x".format(it.toInt() and 0xFF) }
        fun unhex(h: String) = ByteArray(h.length / 2) { h.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
        private fun JsonObject.s(k: String) = getValue(k).jsonPrimitive.content
        private fun JsonObject.o(k: String) = getValue(k).jsonObject
        private fun JsonObject.a(k: String) = getValue(k).jsonArray
        private fun JsonObject.bytes(k: String) = unhex(s(k))
        private fun JsonObject.throws() = this["throws"]?.jsonPrimitive?.boolean == true
        private fun JsonArray.objs() = map { it.jsonObject }
        private fun mustThrow(what: String, block: () -> Unit) {
            try { block() } catch (e: LinkCryptoException) { return }
            fail("expected LinkCryptoException: $what")
        }
    }

    private val privs: Map<String, ByteArray> by lazy { v.o("x25519").a("keys").objs().associate { it.s("name") to it.bytes("priv") } }
    private fun kdfOf(o: JsonObject) = PairKdf.fromJson(o)!!

    @Test fun constants() {
        val c = v.o("constants")
        assertEquals(c.getValue("CLOCK_SKEW_MS").jsonPrimitive.long, LinkCrypto.CLOCK_SKEW_MS)
        val k = c.o("PAIR_KDF")
        assertEquals(KdfCost(k.getValue("N").jsonPrimitive.long, k.getValue("r").jsonPrimitive.long, k.getValue("p").jsonPrimitive.long), LinkCrypto.PAIR_KDF)
        assertEquals(c.s("MAC_PHONE"), LinkCrypto.MAC_PHONE)
        val id = c.s("aadSampleId")
        assertEquals(c.s("macPcSample"), LinkCrypto.macPc(id))
        val a = c.o("AAD")
        assertEquals(a.s("pair"), LinkCrypto.Aad.pair)
        assertEquals(a.s("pairChallenge"), LinkCrypto.Aad.pairChallenge)
        assertEquals(a.s("paired"), LinkCrypto.Aad.paired(id))
        assertEquals(a.s("request"), LinkCrypto.Aad.request(id))
        assertEquals(a.s("response"), LinkCrypto.Aad.response(id))
        assertEquals(a.s("event"), LinkCrypto.Aad.event(id))
        assertEquals(a.s("upload"), LinkCrypto.Aad.upload(id))
        repeat(9) { hit("constants") }
    }

    @Test fun base64() {
        for (e in v.o("b64").a("enc").objs()) {
            assertEquals(e.s("b64"), B64.enc(e.bytes("bytes")))
            hit("b64.enc")
        }
        for (d in v.o("b64").a("dec").objs()) {
            val input = d.s("input")
            if (d.throws()) mustThrow("b64.dec('$input')") { B64.dec(input) }
            else assertEquals("b64.dec('$input')", d.s("bytes"), hex(B64.dec(input)))
            hit("b64.dec")
        }
    }

    @Test fun x25519() {
        val x = v.o("x25519")
        for (k in x.a("keys").objs()) {
            val priv = k.bytes("priv")
            val pub = LinkCrypto.publicKeyOf(priv)
            assertEquals(k.s("pub"), hex(pub))
            assertEquals(k.s("pubB64"), B64.enc(pub))
            assertEquals(k.s("fingerprint"), LinkCrypto.fingerprint(pub))
            hit("x25519.keys")
        }
        for (sh in x.a("shared").objs()) {
            val peerPub = LinkCrypto.publicKeyOf(privs.getValue(sh.s("peer")))
            assertEquals("${sh.s("priv")} x ${sh.s("peer")}", sh.s("secret"), hex(LinkCrypto.sharedSecret(privs.getValue(sh.s("priv")), peerPub)))
            hit("x25519.shared")
        }
    }

    // The JS throws for every low-order or non-canonical peer. Kotlin must never return a value where the JS throws.
    @Test fun lowOrderPeers() {
        val cases = v.o("x25519").a("lowOrder").objs()
        assertTrue(cases.size >= 14)
        for (c in cases) {
            val priv = c.bytes("priv")
            val peer = c.bytes("peerPub")
            val code = c.s("code")
            val name = c.s("name")
            val calls = mapOf<String, () -> ByteArray>(
                "sharedSecret" to { LinkCrypto.sharedSecret(priv, peer) },
                "pairingKey" to { LinkCrypto.pairingKey(priv, peer, code) },
                "sessionKey" to { LinkCrypto.sessionKey(priv, peer) },
            )
            for ((fn, call) in calls) {
                val js = c.o(fn)
                val got = try { hex(call()) } catch (e: LinkCryptoException) { null }
                if (js.throws()) assertEquals("$name $fn: JS throws, Kotlin must too", null, got)
                else assertEquals("$name $fn", js.s("value"), got)
                hit("x25519.lowOrder")
            }
        }
    }

    @Test fun keys() {
        val k = v.o("keys")
        for (p in k.a("pairing").objs()) {
            assertEquals(p.s("key"), hex(LinkCrypto.pairingKey(p.bytes("priv"), p.bytes("peerPub"), p.s("code"))))
            hit("keys.pairing")
        }
        for (s in k.a("session").objs()) {
            assertEquals(s.s("key"), hex(LinkCrypto.sessionKey(s.bytes("priv"), s.bytes("peerPub"))))
            hit("keys.session")
        }
    }

    @Test fun shortSecret() {
        for (s in v.a("shortSecret").objs()) {
            assertEquals(s.s("secret"), LinkCrypto.shortSecret(s.s("code"), s.s("pcPubB64")))
            hit("shortSecret")
        }
    }

    @Test fun linkSecret() {
        for (s in v.a("linkSecret").objs()) {
            assertEquals(s.s("secret"), LinkCrypto.linkSecret(s.s("code"), s.s("saltB64")))
            hit("linkSecret")
        }
    }

    @Test fun verifier() {
        val vf = v.o("verifier")
        for (s in vf.a("seeds").objs()) {
            val kp = LinkCrypto.verifierFromSeed(s.bytes("seed"))
            assertEquals(s.s("priv"), hex(kp.priv))
            assertEquals(s.s("pub"), hex(kp.pub))
            hit("verifier.seeds")
        }
        for (o in vf.a("of").objs()) {
            val password = o.s("password")
            assertEquals(o.s("passwordUtf8Hex"), hex(password.toByteArray(Charsets.UTF_8)))
            val kp = LinkCrypto.verifierOf(password, kdfOf(o.o("kdf")))
            assertEquals("verifierOf('$password')", o.s("priv"), hex(kp.priv))
            assertEquals(o.s("pub"), hex(kp.pub))
            hit("verifier.of")
        }
        for (c in vf.a("kdfCases").objs()) {
            val kdf: JsonElement = c.getValue("kdf")
            assertEquals(c.s("label"), c.getValue("ok").jsonPrimitive.boolean, LinkCrypto.pairKdfOk(kdf))
            hit("verifier.kdfCases")
        }
        val rej = vf.o("verifierOfRejects")
        assertTrue(rej.throws())
        try {
            LinkCrypto.verifierOf("x", kdfOf(rej.o("kdf")))
            fail("verifierOf must refuse a cheap cost")
        } catch (e: LinkCryptoException) {
            assertEquals(rej.s("code"), e.code)
        }
        hit("verifier.verifierOfRejects")
    }

    @Test fun pake() {
        val p = v.o("pake")
        for (t in p.a("transcripts").objs()) {
            val tr = LinkCrypto.pakeTranscript(t.s("via"), t.bytes("devPub"), t.bytes("pcPub"), t.s("sid"), kdfOf(t.o("kdf")))
            assertEquals(t.s("transcript"), hex(tr))
            hit("pake.transcripts")
        }
        for (k in p.a("keys").objs()) {
            val key = LinkCrypto.pakeKey(k.s("secret"), k.bytes("dhDevice"), k.bytes("dhPassword"), k.bytes("transcript"))
            assertEquals(k.s("key"), hex(key))
            assertEquals(k.s("macPhone"), hex(LinkCrypto.pakeMac(key, LinkCrypto.MAC_PHONE)))
            for (m in k.a("macPc").objs()) {
                assertEquals(m.s("label"), LinkCrypto.macPc(m.s("id")))
                assertEquals(m.s("mac"), hex(LinkCrypto.pakeMac(key, m.s("label"))))
                hit("pake.macPc")
            }
            hit("pake.keys")
        }
        // sameBytes: equal, different content, different length, null
        assertTrue(LinkCrypto.sameBytes(byteArrayOf(1, 2), byteArrayOf(1, 2)))
        assertFalse(LinkCrypto.sameBytes(byteArrayOf(1, 2), byteArrayOf(1, 3)))
        assertFalse(LinkCrypto.sameBytes(byteArrayOf(1, 2), byteArrayOf(1)))
        assertFalse(LinkCrypto.sameBytes(null, byteArrayOf(1)))
        assertFalse(LinkCrypto.sameBytes(byteArrayOf(1), null))
    }

    @Test fun seal() {
        val s = v.o("seal")
        val aads = s.o("aads")
        val id = v.o("constants").s("aadSampleId")
        val byName = mapOf(
            "pair" to LinkCrypto.Aad.pair, "pairChallenge" to LinkCrypto.Aad.pairChallenge, "paired" to LinkCrypto.Aad.paired(id),
            "request" to LinkCrypto.Aad.request(id), "response" to LinkCrypto.Aad.response(id), "event" to LinkCrypto.Aad.event(id),
            "upload" to LinkCrypto.Aad.upload(id)
        )
        for ((name, text) in aads) { assertEquals(name, text.jsonPrimitive.content, byName.getValue(name)); hit("seal.aads") }

        for (c in s.a("cases").objs()) {
            val key = c.bytes("key")
            val nonce = c.bytes("nonce")
            val aad = c.s("aad")
            assertEquals(c.s("aad"), byName.getValue(c.s("aadName")))
            val plaintext = c.s("plaintext")
            val value = Json.parseToJsonElement(plaintext)
            // The serializer must emit what JSON.stringify emitted. The one known difference is how kotlinx prints the
            // double 1e21 (1.0E21): valid JSON that the PC parses to the same number, so it is normalised here.
            assertEquals("serialization of ${c.s("valueId")}", plaintext, Json.encodeToString(JsonElement.serializer(), value).replace("1.0E21", "1e+21"))
            val box = c.o("box")
            val ct = sealWithNonce(key, nonce, plaintext.toByteArray(Charsets.UTF_8), aad)
            assertEquals(box.s("c"), B64.enc(ct))
            assertEquals(box.s("n"), B64.enc(nonce))
            assertEquals(c.s("bytes"), hex(nonce + ct))
            assertEquals(c.s("text"), box.s("n") + "." + box.s("c"))
            assertEquals(value, LinkCrypto.open(key, Box(box.s("n"), box.s("c")), aad))
            assertEquals(value, LinkCrypto.open(key, box, aad))
            assertEquals(value, LinkCrypto.openText(key, c.s("text"), aad))
            assertArrayEquals(plaintext.toByteArray(Charsets.UTF_8), LinkCrypto.openBytes(key, c.bytes("bytes"), aad))
            // The production path (random nonce) must open with the same key/aad, and as the PC would: text and bytes too.
            // (the app's own serializer may print a number differently, e.g. 1.0E21, so compare with its re-parse)
            val normalised = Json.parseToJsonElement(Json.encodeToString(JsonElement.serializer(), value))
            val fresh = LinkCrypto.seal(key, value, aad)
            assertEquals(24, B64.dec(fresh.n).size)
            assertEquals(normalised, LinkCrypto.open(key, fresh, aad))
            assertEquals(normalised, LinkCrypto.openText(key, LinkCrypto.sealText(key, value, aad), aad))
            assertNotEquals(fresh, LinkCrypto.seal(key, value, aad))
            hit("seal.cases")
        }

        val b = s.o("binary")
        val bKey = b.bytes("key")
        val bPlain = b.bytes("plaintext")
        val bCt = sealWithNonce(bKey, b.bytes("nonce"), bPlain, b.s("aad"))
        assertEquals(b.s("bytes"), hex(b.bytes("nonce") + bCt))
        assertArrayEquals(bPlain, LinkCrypto.openBytes(bKey, b.bytes("bytes"), b.s("aad")))
        val freshBytes = LinkCrypto.sealBytes(bKey, bPlain, b.s("aad"))
        assertEquals(24 + bPlain.size + 16, freshBytes.size)
        assertArrayEquals(bPlain, LinkCrypto.openBytes(bKey, freshBytes, b.s("aad")))
        hit("seal.binary")

        for (n in s.a("negatives").objs()) {
            val key = n.bytes("key")
            assertTrue(n.throws())
            mustThrow(n.s("label")) { LinkCrypto.open(key, n.getValue("box"), n.s("aad")) }
            hit("seal.negatives")
        }
        for (n in s.a("negativeBytes").objs()) {
            assertTrue(n.throws())
            mustThrow(n.s("label")) { LinkCrypto.openBytes(n.bytes("key"), n.bytes("bytes"), n.s("aad")) }
            hit("seal.negativeBytes")
        }
        val ot = s.o("openText")
        assertEquals(Json.parseToJsonElement(ot.s("plaintext")), LinkCrypto.openText(ot.bytes("key"), ot.s("text"), ot.s("aad")))
        hit("seal.openText")
        for (bad in ot.a("bad").objs()) {
            assertTrue(bad.throws())
            mustThrow("openText('${bad.s("text")}')") { LinkCrypto.openText(ot.bytes("key"), bad.s("text"), ot.s("aad")) }
            hit("seal.openText.bad")
        }
    }

    @Test fun downloadChannel() {
        val d = Json.parseToJsonElement(
            LinkCryptoVectorsTest::class.java.getResourceAsStream("/vectors/vector-descarga.json")!!.readBytes().toString(Charsets.UTF_8)
        ).jsonObject
        val b = d.o("binary")
        val key = b.bytes("key")
        val plain = b.bytes("plaintext")
        val aad = b.s("aad")
        assertEquals(aad, LinkCrypto.Aad.download(b.s("deviceId"), b.s("name")))
        val ct = sealWithNonce(key, b.bytes("nonce"), plain, aad)
        assertEquals(b.s("bytes"), hex(b.bytes("nonce") + ct))
        assertArrayEquals(plain, LinkCrypto.openBytes(key, b.bytes("bytes"), aad))
        assertArrayEquals(plain, LinkCrypto.openBytes(key, LinkCrypto.sealBytes(key, plain, aad), aad))
        hit("download.binary")
        for (n in d.a("negatives").objs()) {
            assertTrue(n.throws())
            mustThrow(n.s("label")) { LinkCrypto.openBytes(n.bytes("key"), n.bytes("bytes"), n.s("aad")) }
            hit("download.negatives")
        }
    }

    @Test fun roundTripBetweenTwoSides() {
        val phone = LinkCrypto.newKeyPair()
        val pc = LinkCrypto.newKeyPair()
        val k1 = LinkCrypto.sessionKey(phone.priv, pc.pub)
        val k2 = LinkCrypto.sessionKey(pc.priv, phone.pub)
        assertArrayEquals(k1, k2)
        assertArrayEquals(
            LinkCrypto.pairingKey(phone.priv, pc.pub, "code"),
            LinkCrypto.pairingKey(pc.priv, phone.pub, "code")
        )
        val id = "dev-7"
        val aads = listOf(
            LinkCrypto.Aad.pair, LinkCrypto.Aad.pairChallenge, LinkCrypto.Aad.paired(id), LinkCrypto.Aad.request(id),
            LinkCrypto.Aad.response(id), LinkCrypto.Aad.event(id), LinkCrypto.Aad.upload(id)
        )
        val value = Json.parseToJsonElement("""{"hello":"mundo","n":[1,2,3],"u":"ñ😀"}""")
        for (aad in aads) {
            val box = LinkCrypto.seal(k1, value, aad)
            assertEquals(value, LinkCrypto.open(k2, box, aad))
            for (other in aads.filter { it != aad }) mustThrow("wrong aad $other") { LinkCrypto.open(k2, box, other) }
            val otherKey = LinkCrypto.sessionKey(LinkCrypto.newKeyPair().priv, pc.pub)
            mustThrow("wrong key") { LinkCrypto.open(otherKey, box, aad) }
            val bytes = LinkCrypto.sealBytes(k1, byteArrayOf(1, 2, 3), aad)
            assertArrayEquals(byteArrayOf(1, 2, 3), LinkCrypto.openBytes(k2, bytes, aad))
            mustThrow("wrong key bytes") { LinkCrypto.openBytes(otherKey, bytes, aad) }
        }
        // A JSON null is a valid sealed value and must come back as null, not as a failure.
        assertEquals(JsonNull, LinkCrypto.open(k2, LinkCrypto.seal(k1, JsonNull, aads[0]), aads[0]))
        assertEquals(JsonPrimitive(42), LinkCrypto.open(k2, LinkCrypto.seal(k1, JsonPrimitive(42), aads[0]), aads[0]))
    }
}

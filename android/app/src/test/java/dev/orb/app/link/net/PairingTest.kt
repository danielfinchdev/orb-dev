package dev.orb.app.link.net

import dev.orb.app.link.crypto.B64
import dev.orb.app.link.crypto.LinkCrypto
import dev.orb.app.link.crypto.PairKdf
import dev.orb.app.link.payload.LinkPayload
import dev.orb.app.link.payload.LinkVia
import dev.orb.app.link.payload.normalCode
import dev.orb.app.link.payload.parseManual
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Pairing against a fake PC. The cheapest scrypt cost the phone accepts is 2^15, so each linking takes a moment. */
class PairingTest {
    private val base = "http://192.168.1.5:3131"
    private val code = "abc_DEF-123"
    private val password = "correct horse"
    private val kdf = PairKdf(1L shl 15, 8, 1, B64.enc(ByteArray(16) { it.toByte() }))

    private class Env(val pc: FakePc, val pairing: Pairing)

    private fun env(offset: Long = 0, verifierOf: (suspend (String, PairKdf) -> dev.orb.app.link.crypto.KeyPair)? = null): Env {
        val clock = TestClock()
        val pc = FakePc(clock)
        pc.pcOffset = offset
        val pairing = if (verifierOf != null) Pairing(pc.client(), clock, Dispatchers.Unconfined, verifierOf = verifierOf)
        else Pairing(pc.client(), clock, Dispatchers.Unconfined)
        return Env(pc, pairing)
    }

    private fun qr(e: Env) = LinkPayload(4.0, listOf(base), e.pc.pcB64, code, "Orb de Dani", null, LinkVia.QR)

    @Test
    fun `linking from a qr with the right password gives a session that talks to the pc`() = runBlocking {
        val e = env()
        e.pc.setupPairing(FakePc.PairSetup(code, password, kdf, "qr"))
        val link = e.pairing.resolve(qr(e)).getOrThrow()
        assertEquals(LinkCrypto.fingerprint(e.pc.keys.pub), link.fp)
        val ok = e.pairing.link(link, password, "Pixel (app)").getOrThrow()

        assertEquals(e.pc.pairedIds.single(), ok.session.id)
        assertEquals(listOf(base), ok.session.urls)
        assertArrayEquals(e.pc.keys.pub, ok.session.pcPub)
        assertEquals("Orb de Dani", ok.session.name)
        // The stored form is what the 3.8.1 app reads back.
        val back = LinkSessionCodec.decode(LinkSessionCodec.encode(ok.session))!!
        assertArrayEquals(ok.session.key, back.key)

        // Both sides derived the same session key: a sealed call works.
        val client = LinkClient(ok.session, e.pc.client(), TestClock(), kotlinx.coroutines.CoroutineScope(Dispatchers.Unconfined), io = Dispatchers.Unconfined)
        assertTrue(client.me().isSuccess)
    }

    // A one-use code (no master password): the QR's 128-bit secret, or the 8 typed characters stretched with the code's salt.
    private val secret128 = "AbCdEfGhIjKlMnOpQrStUv"

    @Test
    fun `a qr with the one-use secret links without a password and the session works`() = runBlocking {
        val e = env()
        e.pc.setupPairing(FakePc.PairSetup(secret128, "", kdf, "link", noPassword = true))
        val link = e.pairing.resolve(LinkPayload(4.0, listOf(base), e.pc.pcB64, secret128, "Orb de Dani", null, LinkVia.LINK)).getOrThrow()
        assertTrue(link.passwordFree)
        val ok = e.pairing.link(link, "", "Pixel (app)").getOrThrow()
        assertEquals(e.pc.pairedIds.single(), ok.session.id)
        val client = LinkClient(ok.session, e.pc.client(), TestClock(), kotlinx.coroutines.CoroutineScope(Dispatchers.Unconfined), io = Dispatchers.Unconfined)
        assertTrue(client.me().isSuccess)
    }

    @Test
    fun `a typed code the pc says needs no password is stretched with its salt`() = runBlocking {
        val e = env()
        val salt = B64.enc(ByteArray(16) { (it + 1).toByte() })
        e.pc.hello = buildJsonObject { put("v", 4); put("short", 4); put("salt", salt); put("pc", e.pc.pcB64); put("name", "Orb de Dani") }
        e.pc.setupPairing(FakePc.PairSetup(LinkCrypto.linkSecret("abcd-efgh", salt), "", kdf, "linkcode", noPassword = true))
        val typed = parseManual(code = "abcd-efgh", address = "192.168.1.5:3131")
        val link = e.pairing.resolve(typed).getOrThrow()
        assertEquals(LinkVia.LINKCODE, link.via)
        assertTrue(link.passwordFree)
        assertEquals(LinkCrypto.fingerprint(e.pc.keys.pub), link.fp)
        assertTrue(e.pc.pairedIds.isEmpty())
        e.pairing.link(link, "", "Pixel").getOrThrow()
        assertEquals(1, e.pc.pairedIds.size)
    }

    @Test
    fun `a typed code with another salt than the pcs does not link`() = runBlocking {
        val e = env()
        val salt = B64.enc(ByteArray(16) { (it + 1).toByte() })
        e.pc.hello = buildJsonObject { put("v", 4); put("short", 4); put("salt", salt); put("pc", e.pc.pcB64) }
        e.pc.setupPairing(FakePc.PairSetup(LinkCrypto.linkSecret("abcdefgh", B64.enc(ByteArray(16))), "", kdf, "linkcode", noPassword = true))
        val link = e.pairing.resolve(parseManual(code = "abcdefgh", address = "192.168.1.5:3131")).getOrThrow()
        val err = e.pairing.link(link, "", "Pixel").exceptionOrNull() as PairingException
        assertTrue(err.error is PairError.Refused)
        assertTrue(e.pc.pairedIds.isEmpty())
    }

    @Test
    fun `the owner saying no at the pc leaves nothing linked and says so`() = runBlocking {
        val e = env()
        e.pc.setupPairing(FakePc.PairSetup(secret128, "", kdf, "link", noPassword = true, declined = true))
        val link = e.pairing.resolve(LinkPayload(4.0, listOf(base), e.pc.pcB64, secret128, null, null, LinkVia.LINK)).getOrThrow()
        val err = (e.pairing.link(link, "", "Pixel").exceptionOrNull() as PairingException).error as PairError.Refused
        assertEquals("declined", err.reason)
        assertTrue(e.pc.pairedIds.isEmpty())
    }

    @Test
    fun `a wrong password is the pcs refusal with the tries left`() = runBlocking {
        val e = env()
        e.pc.setupPairing(FakePc.PairSetup(code, password, kdf, "qr"))
        val link = e.pairing.resolve(qr(e)).getOrThrow()
        val err = (e.pairing.link(link, "nope", "Pixel").exceptionOrNull() as PairingException).error as PairError.Refused
        assertEquals(403, err.status)
        assertEquals("password", err.reason)
        assertEquals(2, err.left)
        assertTrue(e.pc.pairedIds.isEmpty())
    }

    @Test
    fun `a pc that proves itself with a wrong mac is not accepted`() = runBlocking {
        val e = env()
        e.pc.setupPairing(FakePc.PairSetup(code, password, kdf, "qr"))
        e.pc.badPcMac = true
        val link = e.pairing.resolve(qr(e)).getOrThrow()
        val err = (e.pairing.link(link, password, "Pixel").exceptionOrNull() as PairingException).error
        assertEquals(PairError.BadAnswer, err)
    }

    @Test
    fun `a clock that is off is fixed with the pc time and reported`() = runBlocking {
        val e = env(offset = 3_600_000)
        e.pc.setupPairing(FakePc.PairSetup(code, password, kdf, "qr"))
        val ok = e.pairing.link(e.pairing.resolve(qr(e)).getOrThrow(), password, "Pixel").getOrThrow()
        assertEquals(3_600_000L, ok.skewMs)
    }

    @Test
    fun `a typed short code asks the pc for its key and links with the stretched code`() = runBlocking {
        val e = env()
        val pcB64 = e.pc.pcB64
        e.pc.hello = buildJsonObject {
            put("v", 4); put("short", 3); put("pc", pcB64); put("fp", "x"); put("name", "Orb de Dani")
            put("urls", JsonArray(listOf(JsonPrimitive(base), JsonPrimitive("https://orb.tail1234.ts.net"), JsonPrimitive("http://203.0.113.9:3131"))))
        }
        e.pc.setupPairing(FakePc.PairSetup(LinkCrypto.shortSecret(normalCode("abcd-efgh"), pcB64), password, kdf, "code3"))
        val link = e.pairing.resolve(parseManual(code = "abcd-efgh", address = base)).getOrThrow()
        // the first address stays first; the others come ordered and a public http one is dropped
        assertEquals(listOf(base, "https://orb.tail1234.ts.net"), link.urls)
        assertEquals(LinkCrypto.fingerprint(e.pc.keys.pub), link.fp)
        val ok = e.pairing.link(link, password, "Pixel").getOrThrow()
        assertEquals(listOf(base, "https://orb.tail1234.ts.net"), ok.session.urls)
    }

    @Test
    fun `an orb that does not tie the short code to its key is too old`() = runBlocking {
        val e = env()
        e.pc.hello = buildJsonObject { put("pc", e.pc.pcB64); put("short", 2) }
        val err = (e.pairing.resolve(parseManual(code = "abcd-efgh", address = base)).exceptionOrNull() as PairingException).error
        assertEquals(PairError.OldOrb, err)
        val none = env()
        assertEquals(PairError.NoShortCode, ((none.pairing.resolve(parseManual(code = "abcd-efgh", address = base)).exceptionOrNull()) as PairingException).error)
    }

    @Test
    fun `an unreachable pc is offline and says when it is the home network`() = runBlocking {
        val e = env()
        e.pc.setupPairing(FakePc.PairSetup(code, password, kdf, "qr"))
        e.pc.down += "192.168.1.5"
        val link = e.pairing.resolve(qr(e)).getOrThrow()
        val err = (e.pairing.link(link, password, "Pixel").exceptionOrNull() as PairingException).error
        assertEquals(PairError.Offline(overLan = true), err)
    }

    @Test
    fun `a pc asking for a cost the phone cannot pay is a typed error, not a crash`() = runBlocking {
        val e = env(verifierOf = { _, _ -> throw OutOfMemoryError("scrypt") })
        e.pc.setupPairing(FakePc.PairSetup(code, password, kdf, "qr"))
        val err = (e.pairing.link(e.pairing.resolve(qr(e)).getOrThrow(), password, "Pixel").exceptionOrNull() as PairingException).error
        assertEquals(PairError.KdfTooHeavy, err)
    }

    @Test
    fun `the heap pre-check maps to the same typed error`() = runBlocking {
        val e = env(verifierOf = { _, _ -> throw dev.orb.app.link.crypto.LinkCryptoException("kdfTooHeavy") })
        e.pc.setupPairing(FakePc.PairSetup(code, password, kdf, "qr"))
        val err = (e.pairing.link(e.pairing.resolve(qr(e)).getOrThrow(), password, "Pixel").exceptionOrNull() as PairingException).error
        assertEquals(PairError.KdfTooHeavy, err)
    }

    @Test
    fun `a pc asking for a cost under the floor is refused as a bad answer`() = runBlocking {
        val e = env()
        val weak = PairKdf(1L shl 10, 8, 1, B64.enc(ByteArray(16)))
        e.pc.setupPairing(FakePc.PairSetup(code, password, weak, "qr"), verifierOverride = LinkCrypto.verifierFromSeed(ByteArray(32)))
        val err = (e.pairing.link(e.pairing.resolve(qr(e)).getOrThrow(), password, "Pixel").exceptionOrNull() as PairingException).error
        assertEquals(PairError.BadAnswer, err)
    }

    private suspend fun linkWith(e: Env, code: String): PairError {
        val link = e.pairing.resolve(qr(e)).getOrThrow()
        return (e.pairing.link(link, password, "Pixel").exceptionOrNull() as PairingException).error
    }

    @Test
    fun `crypto that says the answer is bad is not the pc of this code, not an old qr`() = runBlocking {
        val e = env(verifierOf = { _, _ -> throw dev.orb.app.link.crypto.LinkCryptoException("badAnswer") })
        e.pc.setupPairing(FakePc.PairSetup(code, password, kdf, "qr"))
        assertEquals(PairError.BadAnswer, linkWith(e, code))
    }

    @Test
    fun `a password that cannot be encoded is an invalid input`() = runBlocking {
        val e = env(verifierOf = { _, _ -> throw dev.orb.app.link.crypto.LinkCryptoException("badString") })
        e.pc.setupPairing(FakePc.PairSetup(code, password, kdf, "qr"))
        val err = linkWith(e, code) as PairError.Refused
        assertEquals(INVALID_INPUT, err.reason)
        assertEquals(0, err.status)
        assertTrue(e.pc.pairedIds.isEmpty())
    }

    @Test
    fun `a code whose keys cannot be read is an old qr`() = runBlocking {
        val e = env()
        e.pc.setupPairing(FakePc.PairSetup(code, password, kdf, "qr"))
        val good = e.pairing.resolve(qr(e)).getOrThrow()
        val broken = dev.orb.app.link.net.ResolvedLink(good.urls, good.code, good.pc, ByteArray(31), good.fp, good.name, good.via)
        val err = (e.pairing.link(broken, password, "Pixel").exceptionOrNull() as PairingException).error
        assertEquals(PairError.OldQr, err)
    }
}

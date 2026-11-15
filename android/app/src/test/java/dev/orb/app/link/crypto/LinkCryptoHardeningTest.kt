package dev.orb.app.link.crypto

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Failure modes the PC's JS never has to think about: heap limits, lone surrogates, loose JSON numbers, test-only code. */
class LinkCryptoHardeningTest {
    private val salt = B64.enc(ByteArray(16) { it.toByte() })
    private fun kdf(n: Long) = PairKdf(n, 8, 1, salt)

    private fun codeOf(block: () -> Unit): String? = try { block(); null } catch (e: LinkCryptoException) { e.code }

    // ---- scrypt memory

    @Test fun verifierOfRefusesWhenTheHeapCannotHoldScrypt() {
        // 2^18 needs 256 MB of V alone.
        assertEquals("kdfTooHeavy", codeOf { LinkCrypto.verifierOf("pw", kdf(1L shl 18)) { 100L shl 20 } })
        // Exactly V without the margin is still not enough.
        assertEquals("kdfTooHeavy", codeOf { LinkCrypto.verifierOf("pw", kdf(1L shl 15)) { 128L * 8 * (1L shl 15) } })
    }

    @Test fun verifierOfRunsWhenTheHeapIsEnough() {
        val kp = LinkCrypto.verifierOf("pw", kdf(1L shl 15)) { 1L shl 30 }
        assertEquals(32, kp.pub.size)
    }

    @Test fun shortSecretChecksTheHeapToo() {
        assertEquals("kdfTooHeavy", codeOf { LinkCrypto.shortSecret("ABCDEFGH", "key") { 1L shl 20 } })
        assertTrue(LinkCrypto.shortSecret("ABCDEFGH", "key") { 1L shl 30 }.startsWith("corto3:"))
    }

    @Test fun theRealProbeReportsAPositiveHeap() {
        assertTrue(LinkCrypto.availableHeap() > 0)
    }

    // ---- lone surrogates

    private val lone = "ab\uD800cd"
    private val loneLow = "x\uDC00"
    private val key = ByteArray(32) { (it + 1).toByte() }
    private val pub = LinkCrypto.publicKeyOf(key)

    @Test fun loneSurrogatesNeverReachKeyDerivation() {
        for (bad in listOf(lone, loneLow, "\uD800", "\uDC00\uD800")) {
            assertEquals("badString", codeOf { LinkCrypto.pairingKey(key, pub, bad) })
            assertEquals("badString", codeOf { LinkCrypto.shortSecret(bad, "key") { 1L shl 30 } })
            assertEquals("badString", codeOf { LinkCrypto.shortSecret("ABCDEFGH", bad) { 1L shl 30 } })
            assertEquals("badString", codeOf { LinkCrypto.pakeKey(bad, key, key, key) })
            assertEquals("badString", codeOf { LinkCrypto.pakeTranscript(bad, pub, pub, "sid", kdf(1L shl 15)) })
            assertEquals("badString", codeOf { LinkCrypto.pakeTranscript("qr", pub, pub, bad, kdf(1L shl 15)) })
            assertEquals("badString", codeOf { LinkCrypto.verifierOf(bad, kdf(1L shl 15)) { 1L shl 30 } })
        }
    }

    @Test fun wellFormedPairsStillWork() {
        // An emoji is a valid surrogate pair and must derive normally.
        LinkCrypto.pairingKey(key, pub, "ok-😀")
        LinkCrypto.pakeKey("😀", key, key, key)
    }

    // ---- PairKdf.fromJson

    private fun kdfJson(n: String, r: String = "8", p: String = "1", s: String = "\"$salt\"") =
        Json.parseToJsonElement("""{"N":$n,"r":$r,"p":$p,"salt":$s}""") as JsonElement

    @Test fun pairKdfAcceptsPlainIntegers() {
        assertEquals(PairKdf(65536, 8, 1, salt), PairKdf.fromJson(kdfJson("65536")))
        assertEquals(PairKdf(65536, 8, 1, salt), PairKdf.fromJson(kdfJson("65536.0")))
        assertEquals(PairKdf(65536, 8, 1, salt), PairKdf.fromJson(kdfJson("6.5536e4")))
    }

    @Test fun pairKdfRejectsLooseNumbers() {
        for (bad in listOf("\"65536\"", "65536.5", "-1e400", "2147483648", "1e30", "null", "true", "[1]")) {
            assertNull("N=$bad", PairKdf.fromJson(kdfJson(bad)))
        }
        // Lenient parsing keeps unquoted words as primitives; toDouble would have taken "65536d" and "NaN".
        val lenient = Json { isLenient = true }
        for (bad in listOf("65536d", "NaN", "Infinity", "0x10000", "+65536", "065536", ".5")) {
            val el = lenient.parseToJsonElement("""{"N":$bad,"r":8,"p":1,"salt":"$salt"}""")
            assertNull("N=$bad", PairKdf.fromJson(el))
        }
        assertNull(PairKdf.fromJson(kdfJson("65536", s = "5")))
        assertNotNull(PairKdf.fromJson(kdfJson("65536")))
    }

    // ---- production code must not carry the test-only fixed-nonce cipher

    @Test fun mainSourcesNeverReferenceInsecureNonce() {
        val main = listOf(File("src/main"), File("android/app/src/main")).firstOrNull { it.isDirectory }
            ?: throw AssertionError("main sources not found from ${File(".").absolutePath}")
        val hits = main.walkTopDown().filter { it.isFile && it.extension in setOf("kt", "java") }
            .filter { f -> f.readText().let { "InsecureNonce" in it || "sealWithNonce" in it } }.map { it.path }.toList()
        assertTrue("fixed-nonce sealing found in main: $hits", hits.isEmpty())
    }
}

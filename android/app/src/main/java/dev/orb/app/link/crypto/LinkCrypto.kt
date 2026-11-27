package dev.orb.app.link.crypto

import com.google.crypto.tink.subtle.Hkdf
import com.google.crypto.tink.subtle.X25519
import com.google.crypto.tink.subtle.XChaCha20Poly1305
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.bouncycastle.crypto.generators.SCrypt
import java.math.BigDecimal
import java.security.GeneralSecurityException
import java.security.MessageDigest
import java.text.Normalizer
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/** Every failure of the link crypto. `code` is stable (`badAnswer`, `badMessage`, `badBase64`, `badKey`, `badString`, `kdfTooHeavy`) so callers can map it. */
class LinkCryptoException(val code: String, cause: Throwable? = null) : Exception(code, cause)

/** A sealed message: nonce and ciphertext, both base64url. */
data class Box(val n: String, val c: String)

class KeyPair(val priv: ByteArray, val pub: ByteArray)

/** The scrypt cost without the salt (the default the PC uses). */
data class KdfCost(val N: Long, val r: Long, val p: Long)

/** The scrypt cost the PC asks for during linking. `salt` stays the base64url text: the transcript binds that exact string. */
data class PairKdf(val N: Long, val r: Long, val p: Long, val salt: String) {
    companion object {
        private val JSON_NUMBER = Regex("-?(0|[1-9][0-9]*)([.][0-9]+)?([eE][+-]?[0-9]+)?")

        /** Null when the shape is wrong (missing or non-numeric field, fractional or out-of-Int-range number, salt not a string). */
        fun fromJson(el: JsonElement?): PairKdf? {
            val o = el as? JsonObject ?: return null
            fun num(k: String): Long? {
                val p = o[k] as? JsonPrimitive ?: return null
                if (p.isString || p is JsonNull) return null
                val text = p.content
                // Only a JSON number literal: toDoubleOrNull would also take "65536d", "NaN" or hex floats.
                if (!JSON_NUMBER.matches(text)) return null
                val bd = try { BigDecimal(text) } catch (_: NumberFormatException) { return null }
                if (bd.signum() == 0) return 0L
                val s = bd.stripTrailingZeros()
                // Whole numbers only (like Number.isInteger) and inside Int range, checked before any expansion.
                if (s.scale() > 0 || s.precision() - s.scale() > 10) return null
                return try { s.intValueExact().toLong() } catch (_: ArithmeticException) { null }
            }
            val salt = o["salt"] as? JsonPrimitive
            if (salt == null || !salt.isString) return null
            return PairKdf(num("N") ?: return null, num("r") ?: return null, num("p") ?: return null, salt.content)
        }
    }
}

/**
 * End-to-end crypto of the phone link: a byte-for-byte port of the PC's `src/shared/mobile-crypto.mjs`, proven by the
 * vectors that `scripts/android-vectors.mjs` generates from it. Scrypt-based functions block; use the `*Async` variants
 * from a coroutine so the main thread never waits on them.
 */
object LinkCrypto {
    const val CLOCK_SKEW_MS = 5 * 60_000L // a phone's clock may be a few minutes off
    val PAIR_KDF = KdfCost(N = 1L shl 16, r = 8, p = 1)
    const val MAC_PHONE = "orb-pake:movil"
    fun macPc(id: String) = "orb-pake:pc:$id"

    /** What each message is for: the device id plus the direction. Exact strings, the PC refuses anything else. */
    object Aad {
        const val pair = "orb:vincular"
        const val pairChallenge = "orb:vincular:reto"
        fun paired(id: String) = "orb:vinculado:$id"
        fun request(id: String) = "orb:peticion:$id"
        fun response(id: String) = "orb:respuesta:$id"
        fun event(id: String) = "orb:evento:$id"
        fun upload(id: String) = "orb:imagen:$id"
        fun download(deviceId: String, name: String) = "orb:descarga:$deviceId:$name"
    }

    private const val NONCE_LEN = 24
    private const val TAG_LEN = 16
    private val json = Json

    // Strict on purpose: toByteArray turns a lone surrogate into '?', the JS into U+FFFD, so the two sides would derive
    // different keys. Refusing is safe; every string that feeds a key or a MAC goes through here.
    private fun utf8(s: String): ByteArray {
        var i = 0
        while (i < s.length) {
            val c = s[i]
            if (Character.isHighSurrogate(c) && i + 1 < s.length && Character.isLowSurrogate(s[i + 1])) i += 2
            else if (Character.isSurrogate(c)) throw LinkCryptoException("badString")
            else i++
        }
        return s.toByteArray(Charsets.UTF_8)
    }

    // ---------------------------------------------------------------- keys

    fun newKeyPair(): KeyPair {
        val priv = X25519.generatePrivateKey()
        return KeyPair(priv, publicKeyOf(priv))
    }

    fun publicKeyOf(priv: ByteArray): ByteArray = wrap { X25519.publicFromPrivate(priv) }

    /** Throws on an all-zero result (low-order peer key). */
    fun sharedSecret(priv: ByteArray, peerPub: ByteArray): ByteArray = wrap { X25519.computeSharedSecret(priv, peerPub) }

    private fun derive(priv: ByteArray, peerPub: ByteArray, salt: String, info: String): ByteArray =
        wrap { Hkdf.computeHkdf("HmacSha256", sharedSecret(priv, peerPub), utf8(salt), utf8(info), 32) }

    /** The key that only proves the phone read this QR (one-time code + both keys). */
    fun pairingKey(priv: ByteArray, peerPub: ByteArray, code: String): ByteArray =
        derive(priv, peerPub, "orb-vincular:$code", "orb movil vincular v1")

    /** The key of every later message between this phone and this PC. */
    fun sessionKey(priv: ByteArray, peerPub: ByteArray): ByteArray =
        derive(priv, peerPub, "orb-movil", "orb movil sesion v1")

    /** Heap the JVM could still hand out: the ceiling minus what is in use. */
    internal fun availableHeap(): Long {
        val rt = Runtime.getRuntime()
        return rt.maxMemory() - (rt.totalMemory() - rt.freeMemory())
    }

    // Room for scrypt's V (128*r*N) plus its small working buffers and whatever else runs meanwhile.
    private const val SCRYPT_MARGIN = 8L shl 20

    private fun scrypt(password: ByteArray, salt: ByteArray, n: Int, r: Int, p: Int, available: () -> Long): ByteArray {
        val need = 128L * r * n + 128L * r * p + SCRYPT_MARGIN
        if (need > available()) throw LinkCryptoException("kdfTooHeavy")
        return try {
            SCrypt.generate(password, salt, n, r, p, 32)
        } catch (e: OutOfMemoryError) {
            throw LinkCryptoException("kdfTooHeavy")
        }
    }

    /** The typed short code stretched with scrypt and tied to the PC key it was typed for. Blocking, ~16 MB. */
    fun shortSecret(code: String, pcPubB64: String, available: () -> Long = ::availableHeap): String =
        "corto3:" + B64.enc(scrypt(utf8(code), utf8("orb-corto-v3:$pcPubB64"), 1 shl 14, 8, 1, available))

    suspend fun shortSecretAsync(code: String, pcPubB64: String): String =
        withContext(Dispatchers.Default) { shortSecret(code, pcPubB64) }

    // ---------------------------------------------------------------- linking with a one-use code, no password

    /** A link made with the QR's 128-bit secret (`link`) or with the 8 characters typed (`linkcode`) asks for no master password. */
    fun isPasswordFree(via: String): Boolean = via == "link" || via == "linkcode"

    /** The PAKE's cost fields of such a link: fixed and empty, there is no password to stretch. */
    val LINK_KDF = PairKdf(0, 0, 0, "")

    /** How long the phone waits for the PC's owner to say yes before it gives up. */
    const val LINK_GIVE_UP_MS = 2 * 60_000L

    /** The code as typed: upper case letters and digits only (src/shared/mobile-crypto.mjs > normalLinkCode). */
    fun normalLinkCode(code: String): String = code.uppercase(java.util.Locale.ROOT).filter { it in 'A'..'Z' || it in '0'..'9' }

    /**
     * The 8 typed characters stretched with the code's own salt mixed with the PC's key, so a table made for a salt a fake PC
     * chose is no good against another PC (src/shared/mobile-crypto.mjs > linkSecret). Blocking, 64 MB like the password's.
     */
    fun linkSecret(code: String, saltB64: String, pcPub: ByteArray, available: () -> Long = ::availableHeap): String {
        val salt = sha256(cat(utf8("orb-corto-v5"), field(B64.dec(saltB64)), field(pcPub)))
        return "corto5:" + B64.enc(scrypt(utf8(normalLinkCode(code)), salt, 1 shl 16, 8, 1, available))
    }

    suspend fun linkSecretAsync(code: String, saltB64: String, pcPub: ByteArray): String =
        withContext(Dispatchers.Default) { linkSecret(code, saltB64, pcPub) }

    /** A short readable fingerprint of a public key, shown on both sides to compare by eye. */
    fun fingerprint(pub: ByteArray): String =
        sha256(pub).copyOf(6).joinToString("") { "%02x".format(it.toInt() and 0xFF) }.chunked(4).joinToString("-")

    // ---------------------------------------------------------------- linking with the master password

    /**
     * The cost a PC may ask for: never cheaper than 2^15 (a fake PC could make the offline attack cheap) and never
     * more than 2^18. Production rules only, there is no relaxed cost for tests.
     */
    fun pairKdfOk(kdf: PairKdf?): Boolean {
        if (kdf == null) return false
        val s = try { B64.dec(kdf.salt) } catch (_: LinkCryptoException) { return false }
        val n = kdf.N
        return n >= (1L shl 15) && n <= (1L shl 18) && (n and (n - 1)) == 0L && kdf.r == 8L && kdf.p == 1L && s.size == 16
    }

    fun pairKdfOk(kdf: JsonElement?): Boolean = pairKdfOk(PairKdf.fromJson(kdf))

    fun verifierFromSeed(seed: ByteArray): KeyPair {
        val priv = wrap { Hkdf.computeHkdf("HmacSha256", seed, utf8("orb-verificador"), utf8("orb pake v1"), 32) }
        return KeyPair(priv, publicKeyOf(priv))
    }

    /**
     * The verifier key from the master password. Heavy: scrypt allocates 128*r*N bytes (64 MB at the PC's default
     * 2^16, 256 MB at the 2^18 ceiling); call [verifierOfAsync] from a coroutine.
     * @throws LinkCryptoException `badAnswer` when the PC's cost is outside what [pairKdfOk] allows, `kdfTooHeavy` when
     * the heap cannot hold it (checked before allocating), `badString` for a password with a lone surrogate.
     */
    fun verifierOf(password: String?, kdf: PairKdf, available: () -> Long = ::availableHeap): KeyPair {
        if (!pairKdfOk(kdf)) throw LinkCryptoException("badAnswer")
        val pw = utf8(Normalizer.normalize(password ?: "", Normalizer.Form.NFC))
        return verifierFromSeed(scrypt(pw, B64.dec(kdf.salt), kdf.N.toInt(), kdf.r.toInt(), kdf.p.toInt(), available))
    }

    suspend fun verifierOfAsync(password: String?, kdf: PairKdf): KeyPair =
        withContext(Dispatchers.Default) { verifierOf(password, kdf) }

    // A 2-byte big-endian length prefix; the length wraps at 65536 exactly like the JS Uint8Array writes.
    private fun field(b: ByteArray): ByteArray {
        val out = ByteArray(2 + b.size)
        out[0] = ((b.size shr 8) and 0xFF).toByte()
        out[1] = (b.size and 0xFF).toByte()
        b.copyInto(out, 2)
        return out
    }

    private fun field(s: String) = field(utf8(s))

    private fun cat(vararg parts: ByteArray): ByteArray {
        val out = ByteArray(parts.sumOf { it.size })
        var i = 0
        for (x in parts) { x.copyInto(out, i); i += x.size }
        return out
    }

    /** Everything both sides agreed on, hashed: a MAC of one exchange is worth nothing in another. */
    fun pakeTranscript(via: String, devPub: ByteArray, pcPub: ByteArray, sid: String, kdf: PairKdf): ByteArray =
        sha256(cat(field("orb-pake-v1"), field(via), field(devPub), field(pcPub), field(sid), field("${kdf.N}/${kdf.r}/${kdf.p}"), field(kdf.salt)))

    fun pakeKey(secret: String, dhDevice: ByteArray, dhPassword: ByteArray, transcript: ByteArray): ByteArray =
        wrap { Hkdf.computeHkdf("HmacSha256", cat(field(secret), field(dhDevice), field(dhPassword)), transcript, utf8("orb pake clave v1"), 32) }

    fun pakeMac(key: ByteArray, label: String): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(key, "HmacSHA256"))
        return mac.doFinal(utf8(label))
    }

    /** Constant-time comparison; false for null or different lengths. */
    fun sameBytes(a: ByteArray?, b: ByteArray?): Boolean {
        if (a == null || b == null || a.size != b.size) return false
        var d = 0
        for (i in a.indices) d = d or (a[i].toInt() xor b[i].toInt())
        return d == 0
    }

    // ---------------------------------------------------------------- sealing

    /** Seals a JSON value under a random 24-byte nonce. */
    fun seal(key: ByteArray, value: JsonElement, aad: String): Box {
        val sealed = sealBytes(key, utf8(json.encodeToString(JsonElement.serializer(), value)), aad)
        return Box(B64.enc(sealed.copyOfRange(0, NONCE_LEN)), B64.enc(sealed.copyOfRange(NONCE_LEN, sealed.size)))
    }

    /** Validates the box like the PC does (an object with two string fields) before touching the key. */
    fun open(key: ByteArray, box: JsonElement?, aad: String): JsonElement {
        val o = box as? JsonObject ?: throw LinkCryptoException("badMessage")
        val n = o["n"] as? JsonPrimitive
        val c = o["c"] as? JsonPrimitive
        if (n == null || c == null || !n.isString || !c.isString) throw LinkCryptoException("badMessage")
        return open(key, Box(n.content, c.content), aad)
    }

    /** Throws [LinkCryptoException] `badMessage` on any failure: bad base64, nonce not 24 bytes, wrong key/aad, tampering. */
    fun open(key: ByteArray, box: Box, aad: String): JsonElement {
        val nonce = try { B64.dec(box.n) } catch (e: LinkCryptoException) { throw LinkCryptoException("badMessage", e) }
        if (nonce.size != NONCE_LEN) throw LinkCryptoException("badMessage")
        val ct = try { B64.dec(box.c) } catch (e: LinkCryptoException) { throw LinkCryptoException("badMessage", e) }
        val plain = openBytes(key, nonce + ct, aad)
        return try {
            json.parseToJsonElement(String(plain, Charsets.UTF_8))
        } catch (e: Exception) {
            throw LinkCryptoException("badMessage", e)
        }
    }

    /** The same as one string, "nonce.ciphertext", for a header or one line of the live stream. */
    fun sealText(key: ByteArray, value: JsonElement, aad: String): String = seal(key, value, aad).let { "${it.n}.${it.c}" }

    /** Mirrors the PC: only the first two dot-separated parts count, a missing one makes the message invalid. */
    fun openText(key: ByteArray, text: String, aad: String): JsonElement {
        val parts = text.split('.')
        val n = parts.getOrNull(0)
        val c = parts.getOrNull(1)
        if (n == null || c == null) throw LinkCryptoException("badMessage")
        return open(key, Box(n, c), aad)
    }

    /** Raw bytes (pictures): nonce (24) followed by the ciphertext. */
    fun sealBytes(key: ByteArray, bytes: ByteArray, aad: String): ByteArray = wrap {
        // Tink draws the random nonce from SecureRandom and returns nonce || ciphertext, the PC's exact layout.
        XChaCha20Poly1305(key).encrypt(bytes, utf8(aad))
    }

    fun openBytes(key: ByteArray, bytes: ByteArray, aad: String): ByteArray {
        if (bytes.size < NONCE_LEN + TAG_LEN) throw LinkCryptoException("badMessage")
        try {
            return XChaCha20Poly1305(key).decrypt(bytes, utf8(aad))
        } catch (e: GeneralSecurityException) {
            throw LinkCryptoException("badMessage", e)
        }
    }

    // ---------------------------------------------------------------- helpers

    private fun sha256(b: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(b)

    // Tink signals bad keys with a checked exception; callers only need the typed one.
    private inline fun <T> wrap(block: () -> T): T = try {
        block()
    } catch (e: GeneralSecurityException) {
        throw LinkCryptoException("badKey", e)
    }
}

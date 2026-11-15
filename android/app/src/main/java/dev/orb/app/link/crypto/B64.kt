package dev.orb.app.link.crypto

/**
 * Base64url without padding, as strict as the PC's `b64.dec`: only `A-Za-z0-9-_` plus the standard `+` and `/`
 * (the PC accepts both alphabets), never `=`, spaces or anything else, and a length of 4n+1 is impossible.
 * Leftover bits of a last partial group are ignored, like `atob` does, so non-canonical tails still decode.
 */
object B64 {
    private const val ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"

    // 128 entries: -1 = not a base64 character. Anything above 127 is rejected before the lookup.
    private val REVERSE = IntArray(128) { -1 }.also { t ->
        ALPHABET.forEachIndexed { i, c -> t[c.code] = i }
        t['+'.code] = 62
        t['/'.code] = 63
    }

    fun enc(bytes: ByteArray): String {
        val out = StringBuilder((bytes.size * 4 + 2) / 3)
        var i = 0
        while (i + 3 <= bytes.size) {
            val n = ((bytes[i].toInt() and 0xFF) shl 16) or ((bytes[i + 1].toInt() and 0xFF) shl 8) or (bytes[i + 2].toInt() and 0xFF)
            out.append(ALPHABET[(n shr 18) and 63]).append(ALPHABET[(n shr 12) and 63])
                .append(ALPHABET[(n shr 6) and 63]).append(ALPHABET[n and 63])
            i += 3
        }
        when (bytes.size - i) {
            1 -> {
                val n = (bytes[i].toInt() and 0xFF) shl 16
                out.append(ALPHABET[(n shr 18) and 63]).append(ALPHABET[(n shr 12) and 63])
            }
            2 -> {
                val n = ((bytes[i].toInt() and 0xFF) shl 16) or ((bytes[i + 1].toInt() and 0xFF) shl 8)
                out.append(ALPHABET[(n shr 18) and 63]).append(ALPHABET[(n shr 12) and 63]).append(ALPHABET[(n shr 6) and 63])
            }
        }
        return out.toString()
    }

    /** @throws LinkCryptoException `badBase64` for any character or length the PC's decoder would refuse. */
    fun dec(text: String): ByteArray {
        if (text.length % 4 == 1) throw LinkCryptoException("badBase64")
        val out = ByteArray(text.length * 6 / 8)
        var acc = 0
        var bits = 0
        var o = 0
        for (ch in text) {
            val v = if (ch.code < 128) REVERSE[ch.code] else -1
            if (v < 0) throw LinkCryptoException("badBase64")
            acc = ((acc shl 6) or v) and 0xFFFF
            bits += 6
            if (bits >= 8) {
                bits -= 8
                out[o++] = ((acc shr bits) and 0xFF).toByte()
            }
        }
        return out
    }
}

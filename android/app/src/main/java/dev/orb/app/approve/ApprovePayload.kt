package dev.orb.app.approve

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.security.MessageDigest

/**
 * What the PC asks this phone to sign, byte for byte what the vault builds (src-tauri/vault/src/approve.rs › message): the tag,
 * the action, SHA-256 of the parameters' summary, a 32-byte nonce, the PC's orbId, this phone's device id, the PC's public key and
 * the expiry (ms, big endian), each field behind its own 4-byte big-endian length so no two requests share bytes.
 * The screen is painted from these decoded fields, never from anything that travelled beside them.
 */
class ApprovePayload(
    val action: String,
    val hash: ByteArray,
    val nonce: ByteArray,
    val orbId: String,
    val deviceId: String,
    val pcPub: ByteArray,
    val expires: Long,
) {
    fun encode(): ByteArray {
        val out = ByteArrayOutputStream()
        for (f in listOf(TAG, action.toByteArray(Charsets.UTF_8), hash, nonce, orbId.toByteArray(Charsets.UTF_8), deviceId.toByteArray(Charsets.UTF_8), pcPub, ByteBuffer.allocate(8).putLong(expires).array())) {
            out.write(ByteBuffer.allocate(4).putInt(f.size).array())
            out.write(f)
        }
        return out.toByteArray()
    }

    companion object {
        val TAG = "orb-approve-v1".toByteArray(Charsets.US_ASCII)
        private const val FIELDS = 8

        /** The fields of signed bytes, or null when they are not exactly a payload of this protocol. */
        fun decode(bytes: ByteArray): ApprovePayload? {
            val parts = ArrayList<ByteArray>(FIELDS)
            var at = 0
            while (at < bytes.size) {
                if (bytes.size - at < 4) return null
                val len = ByteBuffer.wrap(bytes, at, 4).int
                at += 4
                if (len < 0 || len > bytes.size - at) return null
                parts += bytes.copyOfRange(at, at + len)
                at += len
                if (parts.size > FIELDS) return null
            }
            if (parts.size != FIELDS || !parts[0].contentEquals(TAG)) return null
            val (action, hash, nonce, orbId, deviceId, pcPub, until) = parts.subList(1, FIELDS)
            if (hash.size != 32 || nonce.size != 32 || pcPub.size != 32 || until.size != 8) return null
            val names = listOf(action, orbId, deviceId).map { it.toNameOrNull() ?: return null }
            return ApprovePayload(names[0], hash, nonce, names[1], names[2], pcPub, ByteBuffer.wrap(until).long)
        }

        /** The names the protocol takes: letters, digits and `. _ - :`, never empty (the vault refuses anything else). */
        private fun ByteArray.toNameOrNull(): String? {
            if (isEmpty() || size > 128) return null
            if (!all { b -> val c = b.toInt().toChar(); c in 'a'..'z' || c in 'A'..'Z' || c in '0'..'9' || c == '.' || c == '_' || c == '-' || c == ':' }) return null
            return String(this, Charsets.US_ASCII)
        }

        fun sha256(text: String): ByteArray = MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8))
    }
}

private operator fun <T> List<T>.component6(): T = this[5]
private operator fun <T> List<T>.component7(): T = this[6]

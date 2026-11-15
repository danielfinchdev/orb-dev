package dev.orb.app.link.net

import dev.orb.app.link.crypto.B64
import dev.orb.app.link.crypto.LinkCrypto
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray

/**
 * This phone's link with one PC: its device id, its private key, the PC's public key and the addresses of the PC.
 * [key] (the session key) and [pc] (the PC's fingerprint) are derived, never stored.
 */
class LinkSession(
    val id: String,
    val priv: ByteArray,
    val pcPub: ByteArray,
    val urls: List<String>,
    val at: Int = 0,
    val name: String? = null,
) {
    val key: ByteArray by lazy { LinkCrypto.sessionKey(priv, pcPub) }
    val pc: String by lazy { LinkCrypto.fingerprint(pcPub) }

    fun copy(urls: List<String> = this.urls, at: Int = this.at, name: String? = this.name) = LinkSession(id, priv, pcPub, urls, at, name)

    // The private key must never reach a log or a crash report.
    override fun toString() = "LinkSession(id=$id, pc=$pc, urls=${urls.size})"
}

/**
 * The JSON kept under «orb.movil» in [dev.orb.app.SecureStore], the format the 3.8.x app writes (web-bridge.js ›
 * pairWith): `{id, priv, pc, fp, urls, at, name}` where `priv` is the phone's private key and `pc` the PC's public key
 * (both base64url), `fp` the PC's fingerprint, `urls` the PC's addresses and `at` the index of the one that answered last.
 * The session key is derived from the two keys, so it is never written.
 */
object LinkSessionCodec {
    private val json = Json

    /** Null when the text is not a usable link (the phone then links again). */
    fun decode(text: String?): LinkSession? {
        if (text.isNullOrBlank()) return null
        return try {
            val o = json.parseToJsonElement(text) as? JsonObject ?: return null
            fun str(k: String): String? = (o[k] as? JsonPrimitive)?.takeIf { it.isString }?.content
            val id = str("id") ?: return null
            val priv = B64.dec(str("priv") ?: return null)
            val pcPub = B64.dec(str("pc") ?: return null)
            if (priv.size != 32 || pcPub.size != 32) return null
            val urls = (o["urls"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content }
                ?.filter { it.startsWith("http://", true) || it.startsWith("https://", true) }
                .orEmpty()
            if (urls.isEmpty()) return null
            val at = (o["at"] as? JsonPrimitive)?.content?.toDoubleOrNull()?.toInt()?.takeIf { it in urls.indices } ?: 0
            LinkSession(id, priv, pcPub, urls, at, str("name"))
        } catch (e: Exception) {
            null
        }
    }

    fun encode(s: LinkSession): String = json.encodeToString(JsonObject.serializer(), buildJsonObject {
        put("id", s.id)
        put("priv", B64.enc(s.priv))
        put("pc", B64.enc(s.pcPub))
        put("fp", s.pc)
        putJsonArray("urls") { s.urls.forEach { add(JsonPrimitive(it)) } }
        put("at", s.at)
        if (s.name != null) put("name", s.name) else put("name", JsonNull)
    })
}

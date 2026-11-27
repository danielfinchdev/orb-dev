package dev.orb.app.approve

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import java.security.MessageDigest
import java.util.Base64

/** The three things the PC asks this phone to sign. The kind comes from the signed action, never from a field beside it. */
enum class ApproveKind { Enroll, Approve, Rebuild }

/** A request that passed every check: [payload] is what is shown and what is signed, [summary] the text that hashes to it. */
class ApproveRequest(val kind: ApproveKind, val payload: ApprovePayload, val bytes: ByteArray, val summary: String, val name: String?)

enum class ApproveReject { Malformed, Hash, Device, Pc, Expired, Orb, NotRegistered }

sealed interface ApproveCheck {
    class Ok(val request: ApproveRequest) : ApproveCheck
    class Rejected(val reason: ApproveReject) : ApproveCheck
}

/** What this phone knows about its own link and its key, to hold a request against. */
class ApproveContext(
    val deviceId: String,
    val pcPub: ByteArray,
    /** The PC's orbId as it was when this phone was registered (null before the first registration). */
    val pinnedOrbId: String?,
    /** This phone has a key the PC knows about (registered, and not invalidated since). */
    val registered: Boolean,
    val now: Long,
)

object ApproveRules {
    const val ENROLL = "approve.enroll"
    const val REBUILD = "master.rebuild"

    /** A challenge lives two minutes; a clock a little ahead of the PC's is forgiven, a request from far in the future is not. */
    const val MAX_AHEAD_MS = 3 * 60_000L

    /**
     * Holds an `approve` event against what this phone knows. The screen shows [ApproveRequest.payload]'s action and [ApproveRequest.summary]
     * only after the summary hashed to the very hash that is signed, and only for this phone, this PC and this moment.
     */
    fun check(event: JsonObject, c: ApproveContext): ApproveCheck {
        fun no(r: ApproveReject) = ApproveCheck.Rejected(r)
        val bytes = try { Base64.getDecoder().decode((event["payload"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return no(ApproveReject.Malformed)) } catch (e: IllegalArgumentException) { return no(ApproveReject.Malformed) }
        val summary = (event["summary"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return no(ApproveReject.Malformed)
        val p = ApprovePayload.decode(bytes) ?: return no(ApproveReject.Malformed)
        if (!MessageDigest.isEqual(ApprovePayload.sha256(summary), p.hash)) return no(ApproveReject.Hash)
        if (p.deviceId != c.deviceId) return no(ApproveReject.Device)
        if (!MessageDigest.isEqual(p.pcPub, c.pcPub)) return no(ApproveReject.Pc)
        if (p.expires <= c.now || p.expires - c.now > MAX_AHEAD_MS) return no(ApproveReject.Expired)
        val kind = when (p.action) { ENROLL -> ApproveKind.Enroll; REBUILD -> ApproveKind.Rebuild; else -> ApproveKind.Approve }
        if (c.pinnedOrbId != null && p.orbId != c.pinnedOrbId) return no(ApproveReject.Orb)
        var name: String? = null
        if (kind == ApproveKind.Enroll) {
            name = nameOf(summary) ?: return no(ApproveReject.Malformed)
        } else if (!c.registered || c.pinnedOrbId == null) {
            // A phone nobody registered (or whose key died) approves nothing, and never makes a key on its own.
            return no(ApproveReject.NotRegistered)
        }
        return ApproveCheck.Ok(ApproveRequest(kind, p, bytes, summary, name))
    }

    /** `{"name":"…"}` and nothing else: the registration's only parameter. */
    private fun nameOf(summary: String): String? = try {
        val o = Json.parseToJsonElement(summary).jsonObject
        (o["name"] as? JsonPrimitive)?.takeIf { o.size == 1 && it.isString }?.content?.takeIf { it.isNotBlank() }
    } catch (e: Exception) {
        null
    }
}

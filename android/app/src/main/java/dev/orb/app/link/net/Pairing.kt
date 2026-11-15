package dev.orb.app.link.net

import dev.orb.app.link.crypto.B64
import dev.orb.app.link.crypto.LinkCrypto
import dev.orb.app.link.crypto.LinkCrypto.Aad
import dev.orb.app.link.crypto.LinkCryptoException
import dev.orb.app.link.crypto.KeyPair
import dev.orb.app.link.crypto.PairKdf
import dev.orb.app.link.payload.LinkPayload
import dev.orb.app.link.payload.LinkVia
import dev.orb.app.link.payload.MIN_PROTOCOL
import dev.orb.app.link.payload.PROTOCOL
import dev.orb.app.link.payload.allowedBase
import dev.orb.app.link.payload.normalCode
import dev.orb.app.link.payload.orderBases
import dev.orb.app.link.payload.pairingSecret
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Why linking failed. The PC's own words ([Refused.error]) are shown as they come. */
sealed class PairError {
    /** No address answered. [overLan]: one of them was a home-network http address, where the PC's firewall is the usual cause. */
    data class Offline(val overLan: Boolean) : PairError()

    /** The PC's answer was not what the code and the password allow: not the PC of this code. */
    data object BadAnswer : PairError()

    /**
     * The PC refused. [reason]: `password` (wrong, [left] tries remain), `newCode` (too many: the code is void), `wait`,
     * `noMaster`, `noVerifier`, `tries`; [update] is `pair` when the app is too old to link (status 426).
     */
    data class Refused(val status: Int, val error: String, val reason: String?, val left: Int?, val update: String?) : PairError()

    /** The PC asks the password hash for a cost this phone cannot pay in memory (scrypt N = 2^18 needs ~256 MB). */
    data object KdfTooHeavy : PairError()

    /** A typed short code, and the Orb on that address does not answer `/api/hello` with a code on screen. */
    data object NoShortCode : PairError()

    /** An Orb that does not tie the short code to its key, or a QR without the PC's key. */
    data object OldOrb : PairError()
    data object OldQr : PairError()
}

/** [PairError.Refused.reason] of an input the phone itself rejected. */
const val INVALID_INPUT = "invalidInput"

class PairingException(val error: PairError) : Exception(error.toString())

/** A link ready to ask for the password: [fp] is shown so the person compares it with the PC's screen first. */
class ResolvedLink(val urls: List<String>, val code: String, val pc: String, val pcPub: ByteArray, val fp: String, val name: String?, val via: LinkVia)

class PairOk(val session: LinkSession, val info: JsonObject?, val skewMs: Long)

/**
 * Linking this phone with a PC (src/shared/mobile-crypto.mjs › linkDevice, tried over the QR's addresses in order like
 * web-bridge.js › pairWith). The master password never travels: both sides prove they know it with a key confirmation.
 */
class Pairing(
    private val http: OkHttpClient,
    private val clock: Clock = Clock.System,
    private val io: CoroutineDispatcher = Dispatchers.IO,
    private val timeouts: Timeouts = Timeouts(),
    // The scrypt step, injectable so a test can stand in for a phone that runs out of memory.
    private val verifierOf: suspend (String, PairKdf) -> KeyPair = { pw, kdf -> LinkCrypto.verifierOfAsync(pw, kdf) },
) {
    private fun overLan(urls: List<String>) = urls.any {
        it.startsWith("http://") && !Regex("\\.ts\\.net(:|/|$)|//100\\.(6[4-9]|[7-9]\\d|1[01]\\d|12[0-7])\\.").containsMatchIn(it)
    }

    // Same words as linkDevice in mobile-crypto.mjs: a challenge, MAC or cost that does not check is "not the PC of this
    // code"; only a code whose keys cannot be read at all is an old or damaged QR.
    private fun errorOf(e: LinkCryptoException): PairError = when (e.code) {
        "kdfTooHeavy" -> PairError.KdfTooHeavy
        "badAnswer" -> PairError.BadAnswer
        // Nothing was sent: the password has text the link cannot encode (a lone surrogate). Shaped as a refusal with status 0
        // so the screens that already show the PC's words need no new case.
        "badString" -> PairError.Refused(0, "invalid input", INVALID_INPUT, null, null)
        else -> PairError.OldQr
    }

    private fun fail(e: PairError): Nothing = throw PairingException(e)

    private inline fun <T> guarded(block: () -> T): Result<T> = try {
        Result.success(block())
    } catch (e: PairingException) {
        Result.failure(e)
    } catch (e: LinkCryptoException) {
        Result.failure(PairingException(errorOf(e)))
    }

    private suspend fun send(request: Request, ms: Long, urls: List<String>): Response = try {
        http.forRequest(ms, timeouts.connect).newCall(request).await()
    } catch (e: NetFailure) {
        fail(PairError.Offline(overLan(urls)))
    }

    private suspend fun Response.readObject(urls: List<String>): JsonObject = use {
        try { parseObject(text(io)) } catch (e: NetFailure) { fail(PairError.Offline(overLan(urls))) }
    }

    /**
     * What a QR does not carry when the code was typed: the Orb's key, which it gives while its code is on screen
     * (`GET /api/hello`). → the link with the key and its fingerprint.
     */
    suspend fun resolve(payload: LinkPayload): Result<ResolvedLink> = guarded {
        var urls = payload.urls
        var pc = payload.pc
        var name = payload.name
        if (pc == null) {
            val first = urls.firstOrNull() ?: fail(PairError.Offline(false))
            if (!allowedBase(first)) fail(PairError.Offline(false))
            val res = send(Request.Builder().url("$first/api/hello").get().build(), timeouts.hello, listOf(first))
            val ok = res.isSuccessful
            val d = res.readObject(listOf(first))
            pc = d["pc"].str()
            if (!ok || pc == null) fail(PairError.NoShortCode)
            // Only an Orb that ties the code to its own key (an older one, or an answer changed on the way: the QR).
            if (!((d["short"].num() ?: 0.0) >= 3)) fail(PairError.OldOrb)
            val others = (d["urls"] as? JsonArray)?.mapNotNull { it.str() }
            if (others != null) urls = listOf(first) + orderBases(others).filter { it != first }
            name = name ?: d["name"].str()
        }
        val pub = try { B64.dec(pc) } catch (e: LinkCryptoException) { fail(PairError.OldQr) }
        if (pub.size != 32) fail(PairError.OldQr)
        ResolvedLink(urls, payload.code, pc, pub, LinkCrypto.fingerprint(pub), name, payload.via)
    }

    /** Links with the PC's master password, trying the addresses in order. */
    suspend fun link(link: ResolvedLink, password: String, deviceName: String, kind: String = "phone"): Result<PairOk> = guarded {
        val via = if (link.via == LinkVia.CODE) "code3" else "qr"
        val secret = if (link.via == LinkVia.CODE) LinkCrypto.shortSecretAsync(normalCode(link.code), link.pc)
        else pairingSecret(LinkPayload(null, link.urls, link.pc, link.code, link.name, null, link.via))
        var last: PairingException? = null
        for (base in link.urls) {
            if (!allowedBase(base)) continue
            try {
                val r = linkDevice(base, link.pcPub, secret, via, deviceName, kind, password, link.urls)
                val urls = listOf(base) + link.urls.filter { it != base }
                val session = LinkSession(r.id, r.priv, link.pcPub, urls, 0, (r.info?.get("name")).str() ?: link.name)
                return@guarded PairOk(session, r.info, r.skew)
            } catch (e: PairingException) {
                // Not reachable this way: the next address. Anything else is the PC's own word.
                if (e.error is PairError.Offline) last = e else throw e
            }
        }
        throw last ?: PairingException(PairError.Offline(overLan(link.urls)))
    }

    private class Linked(val id: String, val priv: ByteArray, val info: JsonObject?, val skew: Long)

    private suspend fun linkDevice(base: String, pcPub: ByteArray, secret: String, via: String, name: String, kind: String, password: String, urls: List<String>): Linked {
        val pair = LinkCrypto.newKeyPair()
        val pubB = B64.enc(pair.pub)
        val codeKey = LinkCrypto.pairingKey(pair.priv, pcPub, secret)
        var skew = 0L

        suspend fun post(body: JsonObject): Response =
            send(Request.Builder().url("$base/api/pair").post(lenientJson.encodeToString(JsonObject.serializer(), body).toJsonBody()).build(), timeouts.pair, urls)

        // The PC's answer to a step: its JSON, or its refusal as the PC worded it.
        fun answer(code: Int, ok: Boolean, d: JsonObject): JsonObject {
            if (!ok) fail(PairError.Refused(code, d["error"].str() ?: "error $code", d["reason"].str(), d["left"].num()?.toInt(), d["update"].str()))
            return d
        }

        fun start(): JsonObject {
            val proof = buildJsonObject {
                put("pub", pubB); put("name", name); put("kind", kind); put("t", clock.nowMs() + skew); put("v", PROTOCOL); put("min", MIN_PROTOCOL)
            }
            val box = LinkCrypto.seal(codeKey, proof, Aad.pair)
            return buildJsonObject { put("step", "start"); put("via", via); put("pub", pubB); put("proof", boxJson(box.n, box.c)) }
        }

        var res = post(start())
        var data = res.readObject(urls)
        var code = res.code
        var success = res.isSuccessful
        // The phone's clock is off: once more with the PC's time.
        if (code == 409) {
            val now = data["now"].num()
            if (now != null) {
                skew = now.toLong() - clock.nowMs()
                res = post(start())
                data = res.readObject(urls)
                code = res.code
                success = res.isSuccessful
            }
        }
        val challenge = answer(code, success, data)
        val ch = try { LinkCrypto.open(codeKey, challenge["box"], Aad.pairChallenge) as? JsonObject } catch (e: LinkCryptoException) { null }
            ?: fail(PairError.BadAnswer)
        val sid = ch["sid"].str()
        val kdf = PairKdf.fromJson(ch["kdf"])
        if (sid == null || sid != challenge["sid"].str() || kdf == null || !LinkCrypto.pairKdfOk(kdf)) fail(PairError.BadAnswer)

        // scrypt can ask for 256 MB: too much for some phones, which is an answer to give, not a crash.
        val verifier = try {
            verifierOf(password, kdf)
        } catch (e: OutOfMemoryError) {
            fail(PairError.KdfTooHeavy)
        } catch (e: LinkCryptoException) {
            // The pre-check in LinkCrypto and the OOM net above are the same answer for the person.
            fail(errorOf(e).let { if (it == PairError.OldQr) PairError.BadAnswer else it })
        }
        val transcript = try { LinkCrypto.pakeTranscript(via, pair.pub, pcPub, sid, kdf) } catch (e: LinkCryptoException) { fail(PairError.BadAnswer) }
        val k = try {
            LinkCrypto.pakeKey(secret, LinkCrypto.sharedSecret(pair.priv, pcPub), LinkCrypto.sharedSecret(verifier.priv, pcPub), transcript)
        } catch (e: LinkCryptoException) {
            fail(PairError.BadAnswer)
        }
        val finishBody = buildJsonObject {
            put("step", "finish"); put("sid", sid); put("pub", pubB)
            put("mac", B64.enc(LinkCrypto.pakeMac(k, LinkCrypto.MAC_PHONE)))
        }
        val fin = post(finishBody)
        val finCode = fin.code
        val finOk = fin.isSuccessful
        val done = answer(finCode, finOk, fin.readObject(urls))

        // The PC proves it too: only the real one can.
        val id = done["id"].str() ?: fail(PairError.BadAnswer)
        val mac = try { B64.dec(done["mac"].str() ?: "") } catch (e: LinkCryptoException) { null }
        if (!LinkCrypto.sameBytes(mac, LinkCrypto.pakeMac(k, LinkCrypto.macPc(id)))) fail(PairError.BadAnswer)
        val key = LinkCrypto.sessionKey(pair.priv, pcPub)
        val info = try { LinkCrypto.open(key, done["box"], Aad.paired(id)) as? JsonObject } catch (e: LinkCryptoException) { null }
        if (info?.get("id").str() != id) fail(PairError.BadAnswer)
        return Linked(id, pair.priv, info, skew)
    }
}

package dev.orb.app.link.net

import dev.orb.app.link.crypto.B64
import dev.orb.app.link.crypto.KeyPair
import dev.orb.app.link.crypto.LinkCrypto
import dev.orb.app.link.crypto.LinkCrypto.Aad
import dev.orb.app.link.crypto.LinkCryptoException
import dev.orb.app.link.crypto.PairKdf
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.Dispatcher
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import okio.BufferedSink
import okio.BufferedSource
import okio.Pipe
import okio.buffer
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.util.concurrent.AbstractExecutorService
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/** Runs OkHttp's calls on the caller's thread, so a test on virtual time sees every request finish deterministically. */
object DirectExecutor : AbstractExecutorService() {
    override fun execute(command: Runnable) = command.run()
    override fun shutdown() {}
    override fun shutdownNow(): MutableList<Runnable> = mutableListOf()
    override fun isShutdown() = false
    override fun isTerminated() = false
    override fun awaitTermination(timeout: Long, unit: TimeUnit) = true
}

class TestClock(private val elapsed: () -> Long = { 0L }) : Clock {
    var base = 1_700_000_000_000L
    override fun nowMs() = base + elapsed()
}

val testJson = Json

fun JsonObject.str(k: String) = (this[k] as? JsonPrimitive)?.content

/** What the fake PC saw: where, what, and with which request nonce. */
data class Seen(val host: String, val path: String, val kind: String?, val nonce: String?)

/**
 * A PC in Kotlin, using [LinkCrypto] on its side: it opens requests with [Aad.request], checks freshness (±5 min) and
 * replays like src/engine/transport/remote.mjs, and answers sealed with [Aad.response]. Misbehaviours are switches.
 */
class FakePc(private val clock: Clock) : Interceptor {
    val keys: KeyPair = LinkCrypto.newKeyPair()
    lateinit var deviceId: String
    lateinit var devPub: ByteArray
    val key: ByteArray by lazy { LinkCrypto.sessionKey(keys.priv, devPub) }

    var pcOffset = 0L

    /** The PC says the phone's time is off whatever it stamps. */
    @Volatile var stubbornClock = false
    private val startedAt = clock.nowMs()
    val down = HashSet<String>()
    val slow = HashSet<String>()

    /** Hosts that take the request in and then drop the connection, so the PC may have run it. */
    val resetAfterReceive = HashSet<String>()

    /** Hosts that drop the connection after receiving only the next request; the one after it is served. */
    val resetOnce = HashSet<String>()

    @Volatile var ranBeforeReset = false

    /** A repeated nonce gets 410 `gone` (the PC no longer keeps the answer) instead of 401. */
    @Volatile var goneOnReplay = false

    /** What `Last-Event-ID` each stream request carried (null: none). */
    val lastEventIds = CopyOnWriteArrayList<String?>()
    val seenNonces = HashSet<String>()
    val log = CopyOnWriteArrayList<Seen>()

    /** When (by the clock) each request arrived, including the ones that failed before reaching the PC. */
    val tries = CopyOnWriteArrayList<Long>()

    enum class Reply { Huge, Good, WrongNonce, WrongAad, Unsealed, Unlinked401, Attention503, Tampered }

    @Volatile var reply = Reply.Good
    @Volatile var meResult: JsonObject = buildJsonObject { put("device", "Pixel"); put("name", "Orb de Dani"); put("v", 4); put("min", 2); put("version", "3.8.4") }
    @Volatile var meUpdate = false
    @Volatile var callResult: (String, JsonObject) -> JsonObject = { _, _ -> buildJsonObject { put("ok", true) } }
    @Volatile var noteActionOk = true

    val pcNow get() = clock.nowMs() + pcOffset
    val pcB64: String get() = B64.enc(keys.pub)

    // --- live stream
    val openStreams = AtomicInteger(0)
    val maxOpenStreams = AtomicInteger(0)
    val streamsOpened = AtomicInteger(0)

    /** Runs when an `/api/events` request reaches the fake PC, before the stream is opened. */
    @Volatile
    var onEventsRequest: (() -> Unit)? = null
    private var sink: BufferedSink? = null

    fun emit(e: String, p: JsonElement, id: String? = null) =
        line((if (id != null) "id: $id\n" else "") + "data: ${LinkCrypto.sealText(key, buildJsonObject { put("e", e); put("p", p) }, Aad.event(deviceId))}\n\n")

    /** A raw SSE block as the PC would write it (an unsealed `event: resync`, an id alone...). */
    fun raw(text: String) = line(text)
    fun ping() = line(": ping\n\n")
    private fun line(text: String) {
        val s = sink ?: return
        synchronized(s) { try { s.writeUtf8(text); s.flush() } catch (_: Exception) { /* the client closed it */ } }
    }
    fun endStream() { try { sink?.close() } catch (_: Exception) {} }

    fun client(): OkHttpClient = OkHttpClient.Builder().dispatcher(Dispatcher(DirectExecutor)).addInterceptor(this).build()

    private fun json(req: okhttp3.Request, code: Int, body: JsonElement): Response =
        Response.Builder().request(req).protocol(Protocol.HTTP_1_1).code(code).message("x")
            .body(testJson.encodeToString(JsonElement.serializer(), body).toResponseBody("application/json".toMediaType())).build()

    private fun readBody(req: okhttp3.Request): ByteArray { val b = Buffer(); req.body?.writeTo(b); return b.readByteArray() }

    // 'ok' | 'replay' | 'clock' like remote.mjs › freshness
    private fun freshness(nonce: String, t: Double?): String {
        if (stubbornClock || t == null || kotlin.math.abs(pcNow - t) > LinkCrypto.CLOCK_SKEW_MS) return "clock"
        if (!seenNonces.add(nonce)) return "replay"
        return "ok"
    }

    private fun sealedReply(req: okhttp3.Request, nonce: String, value: JsonObject): Response {
        return when (reply) {
            Reply.Huge -> Response.Builder().request(req).protocol(Protocol.HTTP_1_1).code(500).message("x")
                .body("x".repeat(2_000_000).toResponseBody("application/json".toMediaType())).build()
            Reply.Unsealed -> json(req, 200, JsonObject(value + ("r" to JsonPrimitive(nonce))))
            Reply.Unlinked401 -> json(req, 401, buildJsonObject { put("error", "no vinculado") })
            Reply.Attention503 -> json(req, 503, buildJsonObject { put("attention", "migration"); put("error", "atencion") })
            else -> {
                val r = if (reply == Reply.WrongNonce) "not-the-nonce" else nonce
                val aad = if (reply == Reply.WrongAad) Aad.request(deviceId) else Aad.response(deviceId)
                val box = LinkCrypto.seal(key, JsonObject(value + ("r" to JsonPrimitive(r))), aad)
                val o = buildJsonObject { put("n", box.n); put("c", box.c) }
                if (reply == Reply.Tampered) json(req, 200, buildJsonObject { put("n", box.n); put("c", box.c.reversed()) }) else json(req, 200, o)
            }
        }
    }

    private fun clockOff(req: okhttp3.Request) = json(req, 409, buildJsonObject { put("error", "reloj"); put("now", pcNow) })

    override fun intercept(chain: Interceptor.Chain): Response {
        val req = chain.request()
        val host = req.url.host
        tries += clock.nowMs() - startedAt
        if (host in down) throw ConnectException("down")
        if (host in slow) throw SocketTimeoutException("timeout")
        if (host in resetAfterReceive) {
            log += Seen(host, req.url.encodedPath, null, null)
            throw java.net.SocketException("Connection reset")
        }
        if (host in resetOnce) {
            resetOnce.remove(host)
            val nonce = try { (testJson.parseToJsonElement(String(readBody(req))) as? JsonObject)?.str("n") } catch (e: Exception) { null }
            log += Seen(host, req.url.encodedPath, null, nonce)
            // A PC that ran the request and then lost the connection (and, if old, would call its repeat a replay).
            if (nonce != null && ranBeforeReset) seenNonces += nonce
            throw java.net.SocketException("Connection reset")
        }
        pairIntercept(req)?.let { return it }
        val path = req.url.encodedPath
        if (path == "/api/note-action") {
            log += Seen(host, path, null, null)
            return if (noteActionOk) json(req, 200, buildJsonObject { put("ok", true) }) else json(req, 401, buildJsonObject { put("ok", false); put("error", "caducado") })
        }
        if (req.header("X-Orb-Device") != deviceId) return json(req, 401, buildJsonObject { put("error", "no vinculado") })
        return when (path) {
            "/api/me" -> sealedPost(req, host, "me") { _, _ -> if (meUpdate) buildJsonObject { put("ok", false); put("status", 426); put("update", "me"); put("error", "actualiza") } else buildJsonObject { put("ok", true); put("result", meResult) } }
            "/api/call" -> sealedPost(req, host, "call") { body, _ ->
                val method = body?.str("method").orEmpty()
                val params = body?.get("params") as? JsonObject ?: JsonObject(emptyMap())
                callResult(method, params)
            }
            "/api/upload" -> upload(req, host)
            "/api/events" -> events(req, host)
            else -> json(req, 404, buildJsonObject { put("error", "no encontrado") })
        }
    }

    private fun sealedPost(req: okhttp3.Request, host: String, kind: String, answer: (JsonObject?, String) -> JsonObject): Response {
        val box = try { testJson.parseToJsonElement(String(readBody(req))) } catch (e: Exception) { null }
        val msg = try { LinkCrypto.open(key, box, Aad.request(deviceId)) as? JsonObject } catch (e: LinkCryptoException) { null }
        val nonce = (box as? JsonObject)?.str("n")
        log += Seen(host, req.url.encodedPath, msg?.str("m"), nonce)
        if (msg == null || msg.str("m") != kind || nonce == null) return json(req, 401, buildJsonObject { put("error", "no vinculado") })
        when (freshness(nonce, (msg["t"] as? JsonPrimitive)?.content?.toDoubleOrNull())) {
            "clock" -> return clockOff(req)
            "replay" -> return if (goneOnReplay) json(req, 410, buildJsonObject { put("error", "ya no"); put("reason", "gone") }) else json(req, 401, buildJsonObject { put("error", "no vinculado") })
        }
        return sealedReply(req, nonce, answer(msg["b"] as? JsonObject, nonce))
    }

    val uploads = CopyOnWriteArrayList<ByteArray>()

    private fun upload(req: okhttp3.Request, host: String): Response {
        val auth = req.header("X-Orb-Auth").orEmpty()
        val msg = try { LinkCrypto.openText(key, auth, Aad.request(deviceId)) as? JsonObject } catch (e: LinkCryptoException) { null }
        val nonce = auth.substringBefore('.')
        log += Seen(host, "/api/upload", msg?.str("m"), nonce)
        if (msg == null || msg.str("m") != "upload") return json(req, 401, buildJsonObject { put("error", "no vinculado") })
        when (freshness(nonce, (msg["t"] as? JsonPrimitive)?.content?.toDoubleOrNull())) {
            "clock" -> return clockOff(req)
            "replay" -> return json(req, 401, buildJsonObject { put("error", "no vinculado") })
        }
        val bytes = try { LinkCrypto.openBytes(key, readBody(req), Aad.upload(deviceId)) } catch (e: LinkCryptoException) { return json(req, 401, buildJsonObject { put("error", "no vinculado") }) }
        uploads += bytes
        return sealedReply(req, nonce, buildJsonObject { put("ok", true); put("result", buildJsonObject { put("path", "123-abcd.png") }) })
    }

    private fun events(req: okhttp3.Request, host: String): Response {
        val auth = req.header("X-Orb-Auth").orEmpty()
        val msg = try { LinkCrypto.openText(key, auth, Aad.request(deviceId)) as? JsonObject } catch (e: LinkCryptoException) { null }
        val nonce = auth.substringBefore('.')
        log += Seen(host, "/api/events", msg?.str("m"), nonce)
        if (msg == null || msg.str("m") != "events") return json(req, 401, buildJsonObject { put("error", "no vinculado") })
        when (freshness(nonce, (msg["t"] as? JsonPrimitive)?.content?.toDoubleOrNull())) {
            "clock" -> return clockOff(req)
            "replay" -> return json(req, 401, buildJsonObject { put("error", "no vinculado") })
        }
        eventsRequests.incrementAndGet()
        lastEventIds += req.header("Last-Event-ID")
        if (eventsMode == EventsMode.ClockOff409) return clockOff(req)
        if (eventsMode == EventsMode.BrokenBody503) {
            // The connection drops while the client reads the answer's body.
            val broken = object : ResponseBody() {
                override fun contentType() = "application/json".toMediaType()
                override fun contentLength() = -1L
                override fun source(): BufferedSource = object : okio.Source {
                    override fun read(sink: Buffer, byteCount: Long): Long = throw java.io.IOException("reset")
                    override fun timeout() = okio.Timeout.NONE
                    override fun close() {}
                }.buffer()
            }
            return Response.Builder().request(req).protocol(Protocol.HTTP_1_1).code(503).message("x").body(broken).build()
        }
        onEventsRequest?.invoke()
        eventsAsked = msg["d"].let { (it as? JsonPrimitive)?.content == "1" }
        val pipe = Pipe(1 shl 20)
        val out = pipe.sink.buffer()
        out.writeUtf8(": hola\n\n"); out.flush()
        sink = out
        val now = openStreams.incrementAndGet()
        maxOpenStreams.accumulateAndGet(now) { a, b -> maxOf(a, b) }
        streamsOpened.incrementAndGet()
        val source = pipe.source.buffer()
        val closed = AtomicBoolean(false)
        val body = object : ResponseBody() {
            override fun contentType() = "text/event-stream".toMediaType()
            override fun contentLength() = -1L
            override fun source(): BufferedSource = source
            override fun close() {
                if (closed.compareAndSet(false, true)) { openStreams.decrementAndGet(); pipe.cancel() }
            }
        }
        return Response.Builder().request(req).protocol(Protocol.HTTP_1_1).code(200).message("OK").body(body).build()
    }

    @Volatile var eventsAsked = false

    enum class EventsMode { Normal, ClockOff409, BrokenBody503 }
    @Volatile var eventsMode = EventsMode.Normal
    val eventsRequests = AtomicInteger(0)

    // ------------------------------------------------------------------ pairing

    /** The master password's verifier, kept by the PC, and the one-time secret of the QR (or the stretched short code). */
    class PairSetup(val secret: String, val password: String, val kdf: PairKdf, val via: String)

    var pairSetup: PairSetup? = null
    var badPcMac = false
    var pairOffsetOnce = 0L
    var hello: JsonObject? = null
    private val pending = HashMap<String, Pair<String, ByteArray>>() // sid → (pub b64, devPub)
    private var verifier: KeyPair? = null
    var passwordTriesLeft = 3
    val pairedIds = ArrayList<String>()

    fun setupPairing(setup: PairSetup, verifierOverride: KeyPair? = null) {
        pairSetup = setup
        verifier = verifierOverride ?: LinkCrypto.verifierOf(setup.password, setup.kdf)
    }

    fun pairIntercept(req: okhttp3.Request): Response? {
        val path = req.url.encodedPath
        if (path == "/api/hello") {
            val h = hello ?: return json(req, 404, buildJsonObject { put("error", "no code") })
            return json(req, 200, h)
        }
        if (path != "/api/pair") return null
        val setup = pairSetup ?: return json(req, 404, buildJsonObject { put("error", "no code") })
        val body = testJson.parseToJsonElement(String(readBody(req))) as JsonObject
        val pubB = body.str("pub").orEmpty()
        val devPub = B64.dec(pubB)
        val via = body.str("via")
        if (body.str("step") == "start") {
            val codeKey = LinkCrypto.pairingKey(keys.priv, devPub, setup.secret)
            val proof = try { LinkCrypto.open(codeKey, body["proof"], Aad.pair) as JsonObject } catch (e: LinkCryptoException) { return json(req, 403, buildJsonObject { put("error", "codigo") }) }
            val t = (proof["t"] as JsonPrimitive).content.toDouble()
            if (kotlin.math.abs(pcNow - t) > LinkCrypto.CLOCK_SKEW_MS) return clockOff(req)
            val sid = "sid" + pending.size
            pending[sid] = pubB to devPub
            val kdfJson = buildJsonObject { put("N", setup.kdf.N); put("r", setup.kdf.r); put("p", setup.kdf.p); put("salt", setup.kdf.salt) }
            val box = LinkCrypto.seal(codeKey, buildJsonObject { put("sid", sid); put("kdf", kdfJson) }, Aad.pairChallenge)
            return json(req, 200, buildJsonObject { put("sid", sid); put("box", buildJsonObject { put("n", box.n); put("c", box.c) }) })
        }
        val (pubStored, devKey) = pending.remove(body.str("sid")) ?: return json(req, 403, buildJsonObject { put("error", "codigo") })
        if (pubStored != pubB) return json(req, 403, buildJsonObject { put("error", "codigo") })
        val transcript = LinkCrypto.pakeTranscript(setup.via, devKey, keys.pub, body.str("sid")!!, setup.kdf)
        val k = LinkCrypto.pakeKey(setup.secret, LinkCrypto.sharedSecret(keys.priv, devKey), LinkCrypto.sharedSecret(keys.priv, verifier!!.pub), transcript)
        val phoneMac = try { B64.dec(body.str("mac").orEmpty()) } catch (e: LinkCryptoException) { null }
        if (!LinkCrypto.sameBytes(phoneMac, LinkCrypto.pakeMac(k, LinkCrypto.MAC_PHONE))) {
            passwordTriesLeft--
            return json(req, 403, buildJsonObject { put("error", "contrasena incorrecta"); put("reason", "password"); put("left", passwordTriesLeft) })
        }
        val id = "aaaaaaaa-0000-4000-8000-" + (pairedIds.size + 1).toString().padStart(12, '0')
        pairedIds += id
        deviceId = id
        this.devPub = devKey
        val macKey = if (badPcMac) ByteArray(32) else k
        val box = LinkCrypto.seal(LinkCrypto.sessionKey(keys.priv, devKey), buildJsonObject { put("id", id); put("name", "Orb de Dani"); put("v", 4) }, Aad.paired(id))
        return json(req, 200, buildJsonObject {
            put("id", id)
            put("mac", B64.enc(LinkCrypto.pakeMac(macKey, LinkCrypto.macPc(id))))
            put("box", buildJsonObject { put("n", box.n); put("c", box.c) })
        })
    }
}

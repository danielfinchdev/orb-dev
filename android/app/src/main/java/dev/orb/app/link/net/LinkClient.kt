package dev.orb.app.link.net

import dev.orb.app.link.crypto.LinkCrypto
import dev.orb.app.link.crypto.LinkCrypto.Aad
import dev.orb.app.link.crypto.LinkCryptoException
import dev.orb.app.link.payload.MIN_PROTOCOL
import dev.orb.app.link.payload.PAIR_PROTOCOL
import dev.orb.app.link.payload.PROTOCOL
import dev.orb.app.link.payload.allowedBase
import dev.orb.app.link.payload.updateNeeded
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.Call
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

/**
 * The only network client of the app: it talks to the PC's Orb over the encrypted link, exactly as the phone's web client
 * does (src/ui/lib/web-bridge.js). The app is a remote control: every action is a request to the PC.
 *
 * Everything that matters is injectable ([clock], [io], [timeouts], [backoff]) so tests run on virtual time. Nothing
 * secret is ever logged: no keys, nonces, bodies or passwords.
 */
class LinkClient(
    session: LinkSession,
    private val http: OkHttpClient,
    private val clock: Clock,
    private val scope: CoroutineScope,
    private val io: CoroutineDispatcher = Dispatchers.IO,
    private val timeouts: Timeouts = Timeouts(),
    private val backoff: (Int) -> Long = ::retryDelay,
    private val onSessionChanged: (LinkSession) -> Unit = {},
    // The clock offset learnt while linking (the PC's time in its 409), so the first request is already stamped right.
    initialSkewMs: Long = 0,
    // A sealed answer may be big (a diff, a log); anything else the PC says in plain JSON is small.
    private val maxAnswerBytes: Long = 32L * 1024 * 1024,
    private val maxEventBytes: Long = 8L * 1024 * 1024,
    // Type names of unexpected problems only; never a message, a key or a body.
    private val onProblem: (String) -> Unit = {},
) {
    @Volatile
    private var session: LinkSession = session
    val currentSession: LinkSession get() = session

    // The PC refuses requests stamped too far from its own time (replays); its 409 gives the time to stamp with.
    private val skew = AtomicLong(initialSkewMs)
    private fun stamp() = clock.nowMs() + skew.get()

    private val _connection = MutableStateFlow<ConnectionState>(ConnectionState.Connecting)
    val connection: StateFlow<ConnectionState> = _connection.asStateFlow()

    private val _info = MutableStateFlow<PcInfo?>(null)

    /** What the PC said about itself in the last `me`. */
    val pcInfo: StateFlow<PcInfo?> = _info.asStateFlow()

    private val _events = MutableSharedFlow<LinkEvent>(extraBufferCapacity = 1024, onBufferOverflow = BufferOverflow.DROP_OLDEST)

    /** The PC's live events. A slow collector loses the oldest ones; a lost streamed delta is detected by [ChatStreams]. */
    val events: SharedFlow<LinkEvent> = _events.asSharedFlow()

    val chatStreams = ChatStreams()

    @Volatile
    private var lastSeen: Long? = null

    /** Whether the linked PC lists [method] in its `me.methods` (a field newer PCs add; older ones list nothing). */
    fun pcSupports(method: String): Boolean = _info.value?.methods?.contains(method) == true

    // ------------------------------------------------------------------ reaching the PC

    private class Prepared(val request: Request, val nonce: String?)
    private class Reached(val response: Response, val nonce: String?, val base: String)

    private fun persistAt(at: Int) {
        val s = session
        if (s.at == at) return
        val next = s.copy(at = at)
        session = next
        onSessionChanged(next)
    }

    /**
     * Tries the PC's addresses from the one that worked last ([LinkSession.urls] is ordered https, Tailscale, home by
     * orderBases). [once]: a request that changes something and ran out of time is not sent to the next address (the PC
     * may have done it). Plain http only ever goes to an address [allowedBase] accepts: Android's network config allows
     * cleartext everywhere, so this check is the real guard.
     * Each address gets a freshly sealed request, so a nonce is never sent twice.
     */
    private suspend fun reach(ms: Long, once: Boolean, stream: Boolean = false, prepare: (String) -> Prepared): Reached {
        val s = session
        val n = s.urls.size
        for (i in 0 until n) {
            val idx = (s.at + i) % n
            val base = s.urls[idx]
            val last = i + 1 >= n
            var timedOut = false
            try {
                if (!allowedBase(base)) throw NetFailure(false, null)
                val p = prepare(base)
                val res = if (stream) openStream(p.request, ms) else http.forRequest(ms, timeouts.connect).newCall(p.request).await()
                persistAt(idx)
                markReachable(base)
                return Reached(res, p.nonce, base)
            } catch (e: NetFailure) {
                timedOut = e.timeout
            } catch (e: IllegalArgumentException) {
                // not a usable address: the next one
            }
            if (n > 1 && (!last || timedOut)) persistAt((idx + 1) % n)
            if (once && timedOut) {
                markOffline()
                throw LinkException(LinkError.Timeout)
            }
        }
        markOffline()
        throw LinkException(LinkError.Offline)
    }

    private val streamCall = AtomicReference<Call?>(null)

    // A stream's response has no overall limit: only the headers must arrive in [headersMs], then the idle watchdog rules.
    private suspend fun openStream(request: Request, headersMs: Long): Response = coroutineScope {
        val client = http.newBuilder()
            .callTimeout(0, TimeUnit.MILLISECONDS)
            .readTimeout(timeouts.eventsIdle * 2, TimeUnit.MILLISECONDS) // backstop only; the watchdog is ours
            .connectTimeout(minOf(headersMs, timeouts.connect), TimeUnit.MILLISECONDS)
            .retryOnConnectionFailure(false)
            .followRedirects(false).followSslRedirects(false)
            .build()
        val call = client.newCall(request)
        streamCall.set(call)
        val timedOut = AtomicBoolean(false)
        val guard = launch { delay(headersMs); timedOut.set(true); call.cancel() }
        try { call.await { timedOut.get() } } finally { guard.cancel() }
    }

    private fun markReachable(base: String) {
        lastSeen = clock.nowMs()
        val st = _connection.value
        if (st is ConnectionState.Offline || st is ConnectionState.Attention) {
            val info = _info.value
            _connection.value = ConnectionState.Online(base, info?.name, info?.versions ?: PcVersions(null, null, null))
        }
    }

    private fun markOffline() {
        val st = _connection.value
        if (st is ConnectionState.Unlinked || st is ConnectionState.UpdateApp || st is ConnectionState.UpdatePc) return
        _connection.value = ConnectionState.Offline((st as? ConnectionState.Offline)?.nextRetryAt, lastSeen)
    }

    // ------------------------------------------------------------------ sealed requests

    private fun sealRequest(kind: String, body: JsonElement?): Pair<JsonObject, String> {
        val msg = buildJsonObject {
            put("t", stamp())
            put("m", kind)
            if (body != null) put("b", body)
        }
        val box = LinkCrypto.seal(session.key, msg, Aad.request(session.id))
        return boxJson(box.n, box.c) to box.n
    }

    private fun post(url: String, body: String, extra: Map<String, String> = emptyMap(), bytes: ByteArray? = null): Request {
        val b = Request.Builder().url(url).header("X-Orb-Device", session.id)
        extra.forEach { (k, v) -> b.header(k, v) }
        return b.post(if (bytes != null) bytes.toRequestBody(BYTES_TYPE) else body.toJsonBody()).build()
    }

    private suspend fun bodyOf(res: Response): String = try {
        res.text(io, if (res.isSuccessful) maxAnswerBytes else MAX_PLAIN_BODY)
    } catch (e: NetFailure) {
        if (e.tooLarge) throw LinkException(LinkError.BadAnswer)
        markOffline()
        throw LinkException(if (e.timeout) LinkError.Timeout else LinkError.Offline)
    }

    // The 409 answer's «now», if it has one: the phone's clock is off.
    private fun fixClock(data: JsonObject): Boolean {
        val now = data["now"].num() ?: return false
        val next = now.toLong() - clock.nowMs()
        val changed = next != skew.get()
        skew.set(next)
        return changed
    }

    private fun refused(status: Int, data: JsonObject) = LinkException(LinkError.Refused(status, data["error"].str() ?: "http $status", data["reason"].str()))

    /** The answer to a sealed request: it must open with this phone's key and echo the request's nonce. */
    private suspend fun answer(res: Response, nonce: String): JsonObject {
        val data = parseObject(bodyOf(res))
        if (res.code == 401) {
            _connection.value = ConnectionState.Unlinked
            throw LinkException(LinkError.NotLinked)
        }
        val attention = data["attention"].str()
        if (res.code == 503 && attention != null) {
            _connection.value = ConnectionState.Attention(attention)
            throw LinkException(LinkError.Attention(attention))
        }
        if (!res.isSuccessful) throw refused(res.code, data)
        val msg = try { LinkCrypto.open(session.key, data, Aad.response(session.id)) } catch (e: LinkCryptoException) { throw LinkException(LinkError.BadAnswer) }
        val o = msg as? JsonObject ?: throw LinkException(LinkError.BadAnswer)
        if (o["r"].str() != nonce) throw LinkException(LinkError.BadAnswer)
        return o
    }

    private class Opened(val msg: JsonObject, val base: String)

    // One sealed round trip; a 409 with the PC's time fixes the clock and goes once more.
    private suspend fun roundTrip(ms: Long, once: Boolean, prepare: (String) -> Prepared): Opened {
        var retried = false
        while (true) {
            val reached = reach(ms, once, prepare = prepare)
            val opened = reached.response.use { res ->
                if (res.code == 409 && !retried) {
                    val data = parseObject(bodyOf(res))
                    // Any numeric «now» is retried once, even when another request fixed the clock first.
                    val hasNow = data["now"].num() != null
                    fixClock(data)
                    if (!hasNow) throw refused(409, data)
                    retried = true
                    null
                } else {
                    Opened(answer(res, reached.nonce!!), reached.base)
                }
            }
            if (opened != null) return opened
        }
    }

    private suspend fun sealed(kind: String, path: String, body: JsonElement?, ms: Long, once: Boolean): Opened =
        roundTrip(ms, once) { base ->
            val (box, nonce) = sealRequest(kind, body)
            Prepared(post(base + path, lenientJson.encodeToString(JsonObject.serializer(), box)), nonce)
        }

    // ok:false answers → typed errors
    private fun unwrap(msg: JsonObject): JsonElement {
        if ((msg["ok"] as? JsonPrimitive)?.content == "true") return msg["result"] ?: JsonNull
        val status = msg["status"].num()?.toInt() ?: 0
        val update = msg["update"]
        if (status == 426 || (update != null && update !is JsonNull)) {
            _connection.value = ConnectionState.UpdateApp
            throw LinkException(LinkError.Update(UpdateSide.App))
        }
        throw LinkException(LinkError.Refused(status, msg["error"].str() ?: "error", msg["reason"].str()))
    }

    private inline fun <T> guarded(block: () -> T): Result<T> = try {
        Result.success(block())
    } catch (e: LinkException) {
        Result.failure(e)
    }

    /**
     * Runs [method] on the PC. A failure is a [LinkException] carrying a [LinkError]. A call may change something on the
     * PC, so after a timeout it is never sent to another address.
     */
    suspend fun call(method: String, params: JsonObject = JsonObject(emptyMap())): Result<JsonElement> = guarded {
        val body = buildJsonObject { put("method", method); put("params", params) }
        unwrap(sealed("call", "/api/call", body, timeouts.call, once = true).msg)
    }

    /** `/api/me`: who the PC is and which versions each side speaks. Also drives [connection]. */
    suspend fun me(): Result<PcInfo> = guarded {
        val body = buildJsonObject { put("v", PROTOCOL); put("min", MIN_PROTOCOL); put("client", "android-native") }
        val opened = sealed("me", "/api/me", body, timeouts.me, once = false)
        val result = unwrap(opened.msg) as? JsonObject ?: JsonObject(emptyMap())
        val versions = PcVersions(result["v"].num()?.toInt(), result["min"].num()?.toInt(), result["version"].str())
        val methods = (result["methods"] as? JsonArray)?.mapNotNull { it.str() }?.toSet()
        val info = PcInfo(result["device"].str(), result["name"].str(), result["pc"].str(), versions, methods, result)
        _info.value = info
        val min = result["min"].num()
        if (min != null && updateNeeded(min) != null) {
            _connection.value = ConnectionState.UpdateApp
            throw LinkException(LinkError.Update(UpdateSide.App))
        }
        // A PC that does not speak the protocol linking needs is older than this app can work with.
        val v = versions.v
        if (v != null && v < PAIR_PROTOCOL) {
            _connection.value = ConnectionState.UpdatePc
            throw LinkException(LinkError.Update(UpdateSide.Pc))
        }
        _connection.value = ConnectionState.Online(opened.base, info.name, versions)
        info
    }

    /**
     * A picture chosen on the phone, encrypted and uploaded first: the PC only accepts uploaded files as attachments.
     * → the name the PC gave it. [mime] is not sent: the PC checks the first bytes, never a name or a type.
     */
    @Suppress("UNUSED_PARAMETER")
    suspend fun upload(bytes: ByteArray, mime: String): Result<String> = guarded {
        val sealedBody = LinkCrypto.sealBytes(session.key, bytes, Aad.upload(session.id))
        val opened = roundTrip(timeouts.upload, once = true) { base ->
            val auth = authHeader("upload")
            // The envelope of the answer is keyed by the header's nonce.
            Prepared(post(base + "/api/upload", "", mapOf("X-Orb-Auth" to auth), sealedBody), auth.substringBefore('.'))
        }
        (unwrap(opened.msg) as? JsonObject)?.get("path").str() ?: throw LinkException(LinkError.BadAnswer)
    }

    /**
     * «Aprobar» / «Rechazar» from a notification: the one-use token the PC minted for it is all that is sent. The PC
     * answers `{ok}` unsealed; an expired token is a refusal of that token, never an unlinked phone.
     */
    suspend fun noteAction(token: String): Result<Unit> = guarded {
        val body = lenientJson.encodeToString(JsonObject.serializer(), buildJsonObject { put("token", token) })
        val reached = reach(timeouts.call, once = true) { base ->
            Prepared(Request.Builder().url("$base/api/note-action").post(body.toJsonBody()).build(), null)
        }
        reached.response.use { res ->
            val data = parseObject(bodyOf(res))
            val attention = data["attention"].str()
            if (res.code == 503 && attention != null) throw LinkException(LinkError.Attention(attention))
            if (res.isSuccessful && (data["ok"] as? JsonPrimitive)?.content == "true") Unit else throw refused(res.code, data)
        }
    }

    private fun authHeader(kind: String): String {
        val msg = buildJsonObject {
            put("t", stamp())
            put("m", kind)
            // d: 1 says this client takes the streamed answer as deltas (src/shared/chat-stream.mjs).
            if (kind == "events") put("d", 1)
        }
        return LinkCrypto.sealText(session.key, msg, Aad.request(session.id))
    }

    // ------------------------------------------------------------------ keeping the link alive

    private val paused = MutableStateFlow(false)
    private val wake = Channel<Unit>(Channel.CONFLATED)
    private var supervisor: Job? = null
    private val streamJob = AtomicReference<Job?>(null)

    @Volatile
    private var resetBackoff = false

    // The clock was just fixed by a 409 on the stream: one quick retry per connection attempt, never a loop.
    @Volatile
    private var fastRetry = false

    @Volatile
    private var lastEnd = End.Failed

    private enum class End { Idle, Ended, Failed, Terminal }

    /** Starts keeping the link alive: `me`, then the live events, reconnecting with growing pauses. Idempotent. */
    @Synchronized
    fun start() {
        if (supervisor?.isActive == true) return
        supervisor = scope.launch { supervise() }
    }

    @Synchronized
    fun stop() {
        supervisor?.cancel()
        supervisor = null
        streamCall.getAndSet(null)?.cancel()
    }

    /** The app went to the background: the stream is dropped and nothing is retried until [resume]. */
    fun pause() {
        paused.value = true
        streamJob.get()?.cancel()
    }

    /** Back in the foreground (or the person asked to retry): reconnects at once. */
    fun resume() {
        resetBackoff = true
        paused.value = false
        wake.trySend(Unit)
    }

    /** Drops the running stream and opens a fresh one at once; there is never more than one stream. */
    fun reconnectEvents() {
        resetBackoff = true
        wake.trySend(Unit)
        streamJob.get()?.cancel()
    }

    private suspend fun supervise() {
        var attempt = 0
        var fastUsed = false
        while (true) {
            paused.first { !it }
            if (resetBackoff) { resetBackoff = false; attempt = 0; fastUsed = false; wake.tryReceive() }
            if (_connection.value !is ConnectionState.Online) _connection.value = ConnectionState.Connecting
            var end = End.Failed
            fastRetry = false
            try {
                val me = me()
                if (me.isSuccess) {
                    if (!paused.value) {
                        end = runStream()
                        if (end == End.Ended || end == End.Idle) { attempt = 0; fastUsed = false }
                    }
                } else if ((me.exceptionOrNull() as? LinkException)?.error.let { it == LinkError.NotLinked || it is LinkError.Update }) {
                    end = End.Terminal
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // Whatever it was, the link keeps trying: it must never die silently in a launched coroutine.
                onProblem(e.javaClass.simpleName)
                end = End.Failed
            }
            if (end == End.Terminal) {
                // Unlinked or too old: nothing to retry until the person acts (a new link, an update) and calls resume().
                paused.value = true
                continue
            }
            if (paused.value) continue
            if (resetBackoff) continue
            val wait = if (fastRetry && !fastUsed) { fastUsed = true; FAST_RETRY_MS } else backoff(attempt++).coerceAtLeast(MIN_PAUSE_MS)
            val st = _connection.value
            if (st is ConnectionState.Offline) _connection.value = ConnectionState.Offline(clock.nowMs() + wait, lastSeen)
            withTimeoutOrNull(wait) { wake.receive() }
        }
    }

    // One stream; the coroutine is registered so pause() and reconnectEvents() can cancel it. Never two at once.
    private suspend fun runStream(): End = coroutineScope {
        val job = launch { streamBody() }
        streamJob.set(job)
        job.join()
        streamJob.compareAndSet(job, null)
        lastEnd
    }

    private suspend fun streamBody() {
        lastEnd = End.Failed
        chatStreams.clear()
        val reached = try {
            reach(timeouts.events, once = false, stream = true) { base ->
                Prepared(Request.Builder().url("$base/api/events").header("X-Orb-Device", session.id).header("X-Orb-Auth", authHeader("events")).get().build(), null)
            }
        } catch (e: LinkException) {
            return
        }
        val res = reached.response
        try {
            when {
                res.code == 401 -> {
                    _connection.value = ConnectionState.Unlinked
                    lastEnd = End.Terminal
                    return
                }
                res.code == 409 -> {
                    // Speed up only when the clock really was off, like web-bridge.js; a middlebox saying 409 gets the normal pause.
                    if (fixClock(parseObject(bodyOf(res)))) fastRetry = true
                    return
                }
                res.code == 503 -> {
                    parseObject(bodyOf(res))["attention"].str()?.let { _connection.value = ConnectionState.Attention(it) }
                    return
                }
                !res.isSuccessful -> return
            }
            val body = res.body ?: return
            lastEnd = readEvents(SseReader(body.source(), maxEventBytes), res)
        } catch (e: LinkException) {
            // The connection dropped (or the body was absurd) while reading an answer: a failed attempt, not a crash.
            lastEnd = End.Failed
        } finally {
            streamCall.getAndSet(null)?.cancel()
            res.close()
        }
    }

    // Lines are read on the io dispatcher and handed over a channel, so the watchdog can wait with a timeout without
    // being blocked by the socket. Any line (data or a «: ping» comment) is proof the PC is alive.
    private suspend fun readEvents(reader: SseReader, res: Response): End = coroutineScope {
        val lines = Channel<SseLine>(Channel.UNLIMITED)
        val job = launch(io) {
            try {
                while (true) lines.send(reader.next() ?: break)
                lines.close()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // A cancelled call or a closed body: the stream is over, whatever the reader's own exception type.
                lines.close(e)
            }
        }
        try {
            while (true) {
                val got = withTimeoutOrNull(timeouts.eventsIdle) { lines.receiveCatching() }
                if (got == null) {
                    // No bytes at all: the PC is asleep or the network is gone without a word.
                    _connection.value = ConnectionState.Offline(null, lastSeen)
                    return@coroutineScope End.Idle
                }
                val line = got.getOrNull() ?: return@coroutineScope if (got.exceptionOrNull() != null) End.Failed else End.Ended
                if (line is SseLine.Data) deliver(line.text)
            }
            @Suppress("UNREACHABLE_CODE")
            End.Ended
        } finally {
            // Cancelling the call first: closing a chunked body would otherwise try to read it to the end.
            streamCall.getAndSet(null)?.cancel()
            res.close()
            job.cancel()
        }
    }

    private fun deliver(text: String) {
        val msg = try { LinkCrypto.openText(session.key, text, Aad.event(session.id)) as? JsonObject } catch (e: LinkCryptoException) { null } ?: return
        val name = msg["e"].str() ?: return
        val payload = msg["p"] ?: JsonNull
        if (name == "chat:state" && payload is JsonObject) {
            val whole = chatStreams.apply(payload)
            val key = (payload["conversation"] as? JsonPrimitive)?.content.orEmpty()
            _events.tryEmit(if (whole == null) ChatStreams.reloadEvent(key) else LinkEvent(name, whole))
            return
        }
        _events.tryEmit(LinkEvent(name, payload))
    }

    private companion object {
        const val FAST_RETRY_MS = 1_000L
        const val MIN_PAUSE_MS = 100L
    }
}

package dev.orb.app.link.net

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okio.Buffer
import java.io.IOException
import java.io.InterruptedIOException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

internal val JSON_TYPE = "application/json".toMediaType()
internal val BYTES_TYPE = "application/octet-stream".toMediaType()

/** The request failed before any answer: [timeout] tells «no answer in time» (the PC may have got it) from «not reached». */
internal class NetFailure(val timeout: Boolean, cause: Throwable?, val tooLarge: Boolean = false) : IOException("net failure", cause)

/** Plain JSON answers (errors, 409, pairing) are tiny; a bigger one is not the PC. */
internal const val MAX_PLAIN_BODY = 1_000_000L

internal fun String.toJsonBody() = toRequestBody(JSON_TYPE)

/** A client for one request: its own time limit, and never following a redirect (it could leave the checked address). */
internal fun OkHttpClient.forRequest(ms: Long, connectMs: Long): OkHttpClient = newBuilder()
    .callTimeout(ms, java.util.concurrent.TimeUnit.MILLISECONDS)
    .connectTimeout(minOf(ms, connectMs), java.util.concurrent.TimeUnit.MILLISECONDS)
    // OkHttp would silently re-send a POST after a dropped connection with the same nonce: the PC sees a replay (401).
    .retryOnConnectionFailure(false)
    .followRedirects(false).followSslRedirects(false)
    .build()

internal fun isTimeout(e: IOException) = e is InterruptedIOException

/** Runs the call without blocking a thread; cancelling the coroutine cancels the call. Failures become [NetFailure]. */
internal suspend fun Call.await(timedOut: () -> Boolean = { false }): Response = suspendCancellableCoroutine { cont ->
    enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) {
            if (cont.isCancelled) return
            cont.resumeWithException(NetFailure(isTimeout(e) || timedOut(), e))
        }

        override fun onResponse(call: Call, response: Response) {
            cont.resume(response) { _, value, _ -> value.close() }
        }
    })
    cont.invokeOnCancellation { cancel() }
}

/**
 * The whole body as text, inside the request's time limit, read in chunks and refused past [max] bytes (data from an
 * unauthenticated peer must not be able to exhaust memory). A broken read is a failure like a failed request.
 */
internal suspend fun Response.text(io: CoroutineDispatcher, max: Long = MAX_PLAIN_BODY): String = withContext(io) {
    val b = body ?: return@withContext ""
    if (b.contentLength() > max) throw NetFailure(false, null, tooLarge = true)
    try {
        val src = b.source()
        val buf = Buffer()
        while (src.read(buf, 8192) != -1L) if (buf.size > max) throw NetFailure(false, null, tooLarge = true)
        buf.readString(b.contentType()?.charset(Charsets.UTF_8) ?: Charsets.UTF_8)
    } catch (e: IOException) {
        if (e is NetFailure) throw e
        throw NetFailure(isTimeout(e), e)
    }
}

internal val lenientJson = Json { ignoreUnknownKeys = true }

/** The PC's plain JSON answers (errors, 409 `{now}`, pairing); anything else reads as an empty object. */
internal fun parseObject(text: String): JsonObject =
    try { lenientJson.parseToJsonElement(text) as? JsonObject ?: JsonObject(emptyMap()) } catch (e: Exception) { JsonObject(emptyMap()) }

internal fun JsonElement?.str(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.content

/** A JS number: finite, from either a JSON number or a numeric string like `Number()` would take. */
internal fun JsonElement?.num(): Double? = (this as? JsonPrimitive)?.takeIf { !it.isString }?.content?.toDoubleOrNull()?.takeIf { it.isFinite() }

internal fun boxJson(n: String, c: String): JsonObject = buildJsonObject { put("n", n); put("c", c) }

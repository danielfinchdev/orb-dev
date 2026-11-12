package dev.orb.app.attach

import android.net.Uri
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.isActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

/** What a chosen item says about itself, and its bytes; an interface so tests need no content provider. */
interface AttachIo {
    fun info(uri: Uri): SourceInfo

    /** The bytes, or null when they are unreadable or more than [maxBytes]. */
    fun read(uri: Uri, maxBytes: Long): ByteArray?
}

class SourceInfo(val name: String, val mime: String?)

/** Sends bytes to the PC (`/api/upload`, already encrypted by the link) → the name the PC gave them. */
fun interface AttachUploader {
    suspend fun upload(bytes: ByteArray, mime: String?, name: String?): Result<String>
}

/**
 * The attachments of the message being written: checks each against what the PC accepts, shrinks pictures, uploads and
 * tracks the state of each for the chips above the field. Nothing here is logged: names and content are private.
 */
class AttachController(
    parent: CoroutineScope,
    private val io: AttachIo,
    private val uploader: AttachUploader,
    private val policy: () -> UploadPolicy,
    /** `capturas` inside the app's cache: prepared files wait here until the message goes or they are removed. */
    private val workDir: File,
    private val worker: CoroutineDispatcher = Dispatchers.IO,
    private val reduce: (ByteArray) -> ByteArray? = { ImageReducer.reduce(it) },
    private val maxItems: Int = MAX_ATTACHMENTS,
) {
    private val scope = CoroutineScope(parent.coroutineContext + SupervisorJob(parent.coroutineContext[Job]))
    private val ids = AtomicLong()
    private val jobs = ConcurrentHashMap<Long, Job>()
    private val _items = MutableStateFlow<List<Attachment>>(emptyList())
    val items: StateFlow<List<Attachment>> = _items.asStateFlow()
    private val _notice = MutableStateFlow<String?>(null)

    /** Why something was left out, shown under the chips until the next change. */
    val notice: StateFlow<String?> = _notice.asStateFlow()

    val currentPolicy get() = policy()

    /** Something is still being prepared or uploaded, so sending now would leave it behind. */
    val busy get() = _items.value.any { it.state == AttachState.Preparing || it.state == AttachState.Uploading }

    fun addUris(uris: List<Uri>) {
        _notice.value = null
        // Asking the content provider for a name and a type can block, so it never runs on the caller's thread.
        scope.launch(worker) {
            for (uri in uris) {
                val info = try { io.info(uri) } catch (_: Exception) { say(AttachTexts.UNREADABLE); continue }
                ingest(info.name, info.mime) { max -> io.read(uri, max) }
            }
        }
    }

    /** Bytes already in hand (a photo just taken, a file copied from a share). */
    fun addBytes(name: String, mime: String?, bytes: ByteArray) {
        _notice.value = null
        ingest(name, mime) { max -> bytes.takeIf { it.size <= max } }
    }

    private fun ingest(name: String, mime: String?, load: (Long) -> ByteArray?) {
        val p = policy()
        val type = AttachType.detect(mime, name)
        if (type == null || !p.allows(type)) return say(AttachTexts.NOT_ACCEPTED)
        if (_items.value.size >= maxItems) return say(AttachTexts.TOO_MANY)
        val id = ids.incrementAndGet()
        _items.update { it + Attachment(id, name, type, AttachState.Preparing) }
        jobs[id] = scope.launch(worker) {
            val shrink = type.image && type != AttachType.Gif
            // A picture is shrunk afterwards, so the limit that matters is the one on what the PC will receive.
            val bytes = load(if (shrink) SOURCE_IMAGE_MAX else p.maxBytes)
                ?: return@launch fail(id, AttachTexts.TOO_BIG, retry = false)
            val ready = (if (shrink) reduce(bytes) else bytes)
                ?: return@launch fail(id, AttachTexts.UNREADABLE, retry = false)
            if (ready.size > p.maxBytes) return@launch fail(id, AttachTexts.tooBigMb(p.maxBytes / (1024 * 1024)), retry = false)
            val finalType = if (shrink) AttachType.Jpg else type
            val file = try {
                workDir.mkdirs()
                File(workDir, "$id.${finalType.wire}").also { it.writeBytes(ready) }
            } catch (_: Exception) {
                return@launch fail(id, AttachTexts.UNREADABLE, retry = false)
            }
            // The chip may have been removed while the file was being written: nobody would delete it later.
            var present = false
            _items.update { list -> present = list.any { it.id == id }; list.map { if (it.id == id) it.copy(type = finalType, file = file) else it } }
            if (!present || !isActive) {
                file.delete()
                return@launch
            }
            send(id, ready, finalType, name)
        }
    }

    private suspend fun send(id: Long, bytes: ByteArray, type: AttachType, name: String) {
        update(id) { it.copy(state = AttachState.Uploading, error = null, canRetry = false) }
        // Only the files the PC tells apart by name (md, csv, json) need it; a picture is recognized by its bytes.
        val result = uploader.upload(bytes, mimeOf(type), if (type.image) null else name)
        result.fold(
            onSuccess = { remote -> update(id) { it.copy(state = AttachState.Ready, remote = remote, error = null) } },
            onFailure = { fail(id, AttachTexts.UPLOAD_FAILED, retry = true) },
        )
    }

    fun retry(id: Long) {
        val item = _items.value.firstOrNull { it.id == id && it.canRetry && it.file != null } ?: return
        _notice.value = null
        jobs[id] = scope.launch(worker) {
            val bytes = try { item.file!!.readBytes() } catch (_: Exception) { return@launch fail(id, AttachTexts.UNREADABLE, retry = false) }
            send(id, bytes, item.type, item.name)
        }
    }

    fun remove(id: Long) {
        jobs.remove(id)?.cancel()
        _items.value.firstOrNull { it.id == id }?.file?.delete()
        _items.update { list -> list.filterNot { it.id == id } }
        _notice.value = null
    }

    /** The PC's names for what is uploaded, in order; the message carries them as `images`. */
    fun remoteNames(): List<String> = _items.value.filter { it.state == AttachState.Ready }.mapNotNull { it.remote }

    /** Stops work, deletes every prepared file and forgets everything: the message went, or was cancelled. */
    fun discard() {
        jobs.values.forEach { it.cancel() }
        jobs.clear()
        _items.value.forEach { it.file?.delete() }
        _items.value = emptyList()
        _notice.value = null
    }

    /** The screen is gone for good. */
    fun close() {
        discard()
        scope.cancel()
    }

    private fun say(text: String) { _notice.value = text }

    private fun update(id: Long, f: (Attachment) -> Attachment) = _items.update { list -> list.map { if (it.id == id) f(it) else it } }

    private fun fail(id: Long, text: String, retry: Boolean) = update(id) { it.copy(state = AttachState.Failed, error = text, canRetry = retry) }

    private fun mimeOf(t: AttachType) = when (t) {
        AttachType.Png -> "image/png"
        AttachType.Jpg -> "image/jpeg"
        AttachType.Webp -> "image/webp"
        AttachType.Gif -> "image/gif"
        AttachType.Pdf -> "application/pdf"
        AttachType.Txt -> "text/plain"
        AttachType.Md -> "text/markdown"
        AttachType.Csv -> "text/csv"
        AttachType.Json -> "application/json"
    }

    companion object {
        /** A photo the camera app just wrote survives a process restart this long: the result is still on its way. */
        const val CAMERA_GRACE_MS = 10L * 60 * 1000

        /** Deletes what a previous run left in [root], except recent `cam-*` photos (see [CAMERA_GRACE_MS]). */
        fun purgeLeftovers(root: File, nowMs: Long = System.currentTimeMillis()) {
            for (child in root.listFiles().orEmpty()) {
                val recentPhoto = child.isFile && child.name.startsWith("cam-") && nowMs - child.lastModified() < CAMERA_GRACE_MS
                if (!recentPhoto) child.deleteRecursively()
            }
        }

        /** A picture is read up to this size and then reduced; a camera photo is a few MB. */
        const val SOURCE_IMAGE_MAX = 40L * 1024 * 1024
    }
}

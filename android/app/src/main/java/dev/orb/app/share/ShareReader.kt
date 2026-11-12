package dev.orb.app.share

import android.content.ContentResolver
import android.content.Intent
import android.net.Uri
import android.os.Build
import dev.orb.app.attach.AttachType
import dev.orb.app.attach.ContentIo
import dev.orb.app.attach.MAX_ATTACHMENTS
import dev.orb.app.attach.SourceInfo
import java.io.File
import java.util.UUID

/** A shared item already copied into the app's cache: the external URI is never kept. */
class SharedFile(val file: File, val name: String, val mime: String?)

/**
 * What another app shared. [skipped] counts items left out (unsupported kind, too big, beyond the limit);
 * [textCut] says the text was shortened to what a message can carry.
 */
class ShareRequest(val text: String?, val files: List<SharedFile>, val skipped: Int, val textCut: Boolean) {
    /** Tells two shares apart, so a second one replaces the screen of the first. */
    val id = nextId.incrementAndGet()

    val isEmpty get() = text.isNullOrBlank() && files.isEmpty()

    /** Deletes the copies; called when the request is sent or dropped. */
    fun deleteFiles() = files.forEach { it.file.delete() }
}

/** How a shared URI is looked at and copied; an interface so tests need no content provider. */
interface ShareIo {
    fun info(uri: Uri): SourceInfo

    /** Copies the URI to [dest] → the size, or -1 when it cannot be read or is more than [maxBytes]. */
    fun copy(uri: Uri, dest: File, maxBytes: Long): Long
}

class ContentShareIo(private val resolver: ContentResolver) : ShareIo {
    override fun info(uri: Uri) = SourceInfo(ContentIo.nameOf(resolver, uri), resolver.getType(uri))

    override fun copy(uri: Uri, dest: File, maxBytes: Long): Long = try {
        resolver.openInputStream(uri)?.use { input ->
            dest.outputStream().use { out ->
                val chunk = ByteArray(64 * 1024)
                var total = 0L
                while (true) {
                    val n = input.read(chunk)
                    if (n < 0) break
                    total += n
                    if (total > maxBytes) { out.close(); dest.delete(); return -1 }
                    out.write(chunk, 0, n)
                }
                total
            }
        } ?: -1
    } catch (_: Exception) {
        dest.delete()
        -1
    }
}

private val nextId = java.util.concurrent.atomic.AtomicLong()

object ShareReader {
    /** What a message to Orbe can hold (`chat.send` takes 20000 characters). */
    const val MAX_TEXT = 20_000
    const val MAX_FILE_BYTES = 25L * 1024 * 1024
    const val MAX_TOTAL_BYTES = 60L * 1024 * 1024

    /** Only the first items are looked at, whatever the sender offers. */
    private const val MAX_LOOKED_AT = 20

    fun isShare(intent: Intent?) = intent?.action == Intent.ACTION_SEND || intent?.action == Intent.ACTION_SEND_MULTIPLE

    /** → null when [intent] is not a share. Copies run here, so call it off the main thread. */
    fun read(intent: Intent?, io: ShareIo, dir: File): ShareRequest? {
        if (intent == null || !isShare(intent)) return null
        val text = textOf(intent)
        val cut = text != null && text.length > MAX_TEXT
        val uris = if (intent.action == Intent.ACTION_SEND) listOfNotNull(streamOf(intent)) else streamsOf(intent)
        val files = ArrayList<SharedFile>()
        var skipped = 0
        var total = 0L
        for ((i, uri) in uris.withIndex()) {
            if (i >= MAX_LOOKED_AT || files.size >= MAX_ATTACHMENTS) { skipped += uris.size - i; break }
            val info = try { io.info(uri) } catch (_: Exception) { skipped++; continue }
            val mime = info.mime?.takeIf { it != "*/*" } ?: intent.type?.takeIf { !it.endsWith("/*") }
            if (AttachType.detect(mime, info.name) == null) { skipped++; continue }
            dir.mkdirs()
            val dest = File(dir, UUID.randomUUID().toString())
            val size = io.copy(uri, dest, minOf(MAX_FILE_BYTES, MAX_TOTAL_BYTES - total))
            if (size < 0) { skipped++; continue }
            total += size
            files.add(SharedFile(dest, info.name, mime))
        }
        return ShareRequest(text?.take(MAX_TEXT)?.trim()?.ifEmpty { null }, files, skipped, cut)
    }

    private fun textOf(intent: Intent): String? {
        val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()
        val subject = intent.getStringExtra(Intent.EXTRA_SUBJECT)
        val parts = ArrayList<String>()
        if (!subject.isNullOrBlank() && (text == null || !text.contains(subject))) parts.add(subject)
        if (!text.isNullOrBlank()) parts.add(text)
        return parts.joinToString("\n").ifBlank { null }
    }

    @Suppress("DEPRECATION")
    private fun streamOf(intent: Intent): Uri? = try {
        if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java) else intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
    } catch (_: Exception) {
        null
    }

    @Suppress("DEPRECATION")
    private fun streamsOf(intent: Intent): List<Uri> = try {
        (if (Build.VERSION.SDK_INT >= 33) intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java) else intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)).orEmpty()
    } catch (_: Exception) {
        emptyList()
    }
}

package dev.orb.app.attach

import android.content.ContentResolver
import android.net.Uri
import android.provider.OpenableColumns
import java.io.ByteArrayOutputStream

/** Reads what the person picked through the system's own pickers; the app never holds a permission for those files. */
class ContentIo(private val resolver: ContentResolver) : AttachIo {
    override fun info(uri: Uri): SourceInfo = SourceInfo(nameOf(resolver, uri), resolver.getType(uri))

    override fun read(uri: Uri, maxBytes: Long): ByteArray? = readLimited(resolver, uri, maxBytes)

    companion object {
        fun nameOf(resolver: ContentResolver, uri: Uri): String {
            try {
                resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                    if (c.moveToFirst()) c.getString(0)?.takeIf { it.isNotBlank() }?.let { return it }
                }
            } catch (_: Exception) {
            }
            return uri.lastPathSegment?.substringAfterLast('/') ?: "adjunto"
        }

        fun readLimited(resolver: ContentResolver, uri: Uri, maxBytes: Long): ByteArray? = try {
            resolver.openInputStream(uri)?.use { input ->
                val out = ByteArrayOutputStream()
                val chunk = ByteArray(64 * 1024)
                var total = 0L
                while (true) {
                    val n = input.read(chunk)
                    if (n < 0) break
                    total += n
                    if (total > maxBytes) return null
                    out.write(chunk, 0, n)
                }
                out.toByteArray()
            }
        } catch (_: Exception) {
            null
        }
    }
}

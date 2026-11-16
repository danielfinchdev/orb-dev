package dev.orb.app.attach

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull
import java.io.File

/** Most attachments one message carries. */
const val MAX_ATTACHMENTS = 6

/** What the PC accepts, named as it names them in `me.result.uploads.types`. */
enum class AttachType(val wire: String, val image: Boolean, private val mimes: Set<String>, private val exts: Set<String>) {
    Png("png", true, setOf("image/png"), setOf("png")),
    Jpg("jpg", true, setOf("image/jpeg", "image/jpg", "image/pjpeg"), setOf("jpg", "jpeg")),
    Webp("webp", true, setOf("image/webp"), setOf("webp")),
    Gif("gif", true, setOf("image/gif"), setOf("gif")),
    Pdf("pdf", false, setOf("application/pdf"), setOf("pdf")),
    Txt("txt", false, setOf("text/plain"), setOf("txt", "log")),
    Md("md", false, setOf("text/markdown", "text/x-markdown"), setOf("md", "markdown")),
    Csv("csv", false, setOf("text/csv", "text/comma-separated-values"), setOf("csv")),
    Json("json", false, setOf("application/json"), setOf("json"));

    companion object {
        /**
         * The type of a file by its type and its name. Providers often say `text/plain` or nothing for markdown, csv and
         * json, so the extension decides among the text types; for everything else the type wins.
         */
        fun detect(mime: String?, name: String?): AttachType? {
            val m = mime?.substringBefore(';')?.trim()?.lowercase()
            val byMime = entries.firstOrNull { m != null && m in it.mimes }
            val ext = name?.substringAfterLast('.', "")?.lowercase().orEmpty()
            val byExt = entries.firstOrNull { ext.isNotEmpty() && ext in it.exts }
            if (byExt != null && !byExt.image && (byMime == null || byMime == Txt)) return byExt
            return byMime ?: byExt
        }
    }
}

/** What the linked PC takes: a size limit and the kinds of file. A PC from before 3.8.4 says nothing and takes pictures. */
data class UploadPolicy(val maxBytes: Long, val types: Set<String>) {
    fun allows(t: AttachType) = t.wire in types

    /** Whether anything but pictures is accepted, so the sheet offers «Archivo». */
    val allowsFiles get() = AttachType.entries.any { !it.image && allows(it) }

    companion object {
        const val LEGACY_MAX = 10L * 1024 * 1024
        val Legacy = UploadPolicy(LEGACY_MAX, setOf("png", "jpg", "webp", "gif"))

        fun fromMe(raw: JsonObject?): UploadPolicy {
            val uploads = raw?.get("uploads") as? JsonObject ?: return Legacy
            val types = (uploads["types"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull?.lowercase() }?.toSet()
            val max = (uploads["max"] as? JsonPrimitive)?.longOrNull
            if (types.isNullOrEmpty()) return Legacy
            return UploadPolicy(max?.takeIf { it > 0 } ?: LEGACY_MAX, types)
        }
    }
}

enum class AttachState { Preparing, Uploading, Ready, Failed }

/**
 * One attachment on its way. [name] is only what the chip shows (never logged); [file] holds the prepared bytes in the
 * app's cache until the message is sent or the attachment is removed.
 */
data class Attachment(
    val id: Long,
    val name: String,
    val type: AttachType,
    val state: AttachState,
    val file: File? = null,
    /** The name the PC gave the upload; what `chat.send` carries. */
    val remote: String? = null,
    val error: String? = null,
    val canRetry: Boolean = false,
)

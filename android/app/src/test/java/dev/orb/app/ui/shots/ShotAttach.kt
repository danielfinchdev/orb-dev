package dev.orb.app.ui.shots

import android.net.Uri
import dev.orb.app.attach.AttachController
import dev.orb.app.attach.AttachIo
import dev.orb.app.attach.AttachUploader
import dev.orb.app.attach.SourceInfo
import dev.orb.app.attach.UploadPolicy
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import java.io.File
import java.nio.file.Files

/**
 * An attachment controller with nothing attached: a chat of the real app always has one, so a picture of the box shows «+»
 * the way the phone does. Nothing is read or uploaded through it.
 */
internal fun shotAttach(): AttachController {
    val io = object : AttachIo {
        override fun info(uri: Uri) = SourceInfo(uri.lastPathSegment.orEmpty(), null)
        override fun read(uri: Uri, maxBytes: Long) = null
    }
    val folder = File(Files.createTempDirectory("shot-attach").toFile(), "w")
    return AttachController(
        CoroutineScope(SupervisorJob() + Dispatchers.Unconfined), io, AttachUploader { _, _, _ -> Result.failure(IllegalStateException("not used")) },
        { UploadPolicy(10_000_000, setOf("png", "pdf")) }, folder, Dispatchers.Unconfined, reduce = { it },
    )
}

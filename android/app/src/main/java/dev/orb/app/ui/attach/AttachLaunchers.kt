package dev.orb.app.ui.attach

import android.content.Context
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.FileProvider
import dev.orb.app.attach.AttachController
import dev.orb.app.attach.AttachTexts
import dev.orb.app.attach.MAX_ATTACHMENTS
import java.io.File

/** The three ways to add something; each opens a system screen, so the app needs no permission for any of them. */
class AttachLaunchers(val camera: () -> Unit, val gallery: () -> Unit, val file: () -> Unit)

/** Where a photo is written for the camera app: the cache folder the provider exposes, nothing else. */
internal fun captureFile(context: Context): File =
    File(context.cacheDir, "capturas").apply { mkdirs() }.let { File(it, "cam-${System.nanoTime()}.jpg") }

internal fun captureUri(context: Context, file: File): Uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)

/** The pickers feeding [controller]. [onProblem] says why something could not be opened (no camera app, for one). */
@Composable
fun rememberAttachLaunchers(controller: AttachController, onProblem: (String) -> Unit = {}): AttachLaunchers {
    val context = LocalContext.current
    // Kept across a recreation of the screen: the camera app can take long enough for Android to reclaim it.
    var pendingPhoto by rememberSaveable { mutableStateOf<String?>(null) }

    val takePicture = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { done ->
        val file = pendingPhoto?.let(::File)
        pendingPhoto = null
        if (file == null) return@rememberLauncherForActivityResult
        if (done && file.exists()) {
            val bytes = try { file.readBytes() } catch (_: Exception) { null }
            if (bytes != null) controller.addBytes("foto.jpg", "image/jpeg", bytes) else onProblem(AttachTexts.CAMERA_FAILED)
        }
        file.delete()
    }
    val gallery = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(MAX_ATTACHMENTS)) { uris ->
        if (uris.isNotEmpty()) controller.addUris(uris)
    }
    val file = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isNotEmpty()) controller.addUris(uris)
    }
    return remember(controller) {
        AttachLaunchers(
            camera = {
                try {
                    val f = captureFile(context)
                    pendingPhoto = f.path
                    takePicture.launch(captureUri(context, f))
                } catch (_: Exception) {
                    pendingPhoto = null
                    onProblem(AttachTexts.CAMERA_FAILED)
                }
            },
            gallery = {
                try {
                    gallery.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                } catch (_: Exception) {
                    onProblem(AttachTexts.UNREADABLE_PICKER)
                }
            },
            file = {
                try {
                    file.launch(arrayOf("*/*"))
                } catch (_: Exception) {
                    onProblem(AttachTexts.UNREADABLE_PICKER)
                }
            },
        )
    }
}

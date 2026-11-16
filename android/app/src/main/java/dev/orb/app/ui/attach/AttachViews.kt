package dev.orb.app.ui.attach

import android.graphics.BitmapFactory
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.orb.app.attach.AttachState
import dev.orb.app.attach.AttachTexts
import dev.orb.app.attach.Attachment
import dev.orb.app.attach.UploadPolicy
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.theme.OrbTheme
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** A06: «Cámara», «Galería» and, when the PC reads them, «Archivo». */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AttachSheet(policy: UploadPolicy, launchers: AttachLaunchers, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.padding(bottom = 16.dp)) {
            Text(AttachTexts.SHEET_TITLE, Modifier.padding(horizontal = 24.dp, vertical = 8.dp), style = MaterialTheme.typography.titleMedium)
            SheetRow(OrbIcons.Camera, AttachTexts.CAMERA) { onDismiss(); launchers.camera() }
            SheetRow(OrbIcons.Image, AttachTexts.GALLERY) { onDismiss(); launchers.gallery() }
            // A PC from before 3.8.4 takes pictures only, so there is nothing else to pick.
            if (policy.allowsFiles) SheetRow(OrbIcons.File, AttachTexts.FILE) { onDismiss(); launchers.file() }
            Text(
                AttachTexts.ENCRYPT_HINT, Modifier.padding(horizontal = 24.dp, vertical = 8.dp),
                style = MaterialTheme.typography.bodySmall, color = OrbTheme.colors.text2,
            )
        }
    }
}

@Composable
private fun SheetRow(icon: ImageVector, label: String, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onClick).padding(horizontal = 24.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Icon(icon, null, Modifier.size(22.dp), tint = MaterialTheme.colorScheme.onSurface)
        Text(label, style = MaterialTheme.typography.bodyLarge)
    }
}

/** The previews above the field: a thumbnail, progress or the error, and a close button to take each off. */
@Composable
fun AttachStrip(items: List<Attachment>, notice: String?, onRemove: (Long) -> Unit, onRetry: (Long) -> Unit, modifier: Modifier = Modifier) {
    if (items.isEmpty() && notice == null) return
    Column(modifier.fillMaxWidth()) {
        if (items.isNotEmpty()) {
            Row(Modifier.horizontalScroll(rememberScrollState()).padding(bottom = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (item in items) Chip(item, onRemove, onRetry)
            }
        }
        if (notice != null) Text(notice, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(bottom = 4.dp))
    }
}

@Composable
private fun Chip(item: Attachment, onRemove: (Long) -> Unit, onRetry: (Long) -> Unit) {
    val scheme = MaterialTheme.colorScheme
    val shape = RoundedCornerShape(14.dp)
    val working = item.state == AttachState.Preparing || item.state == AttachState.Uploading
    Row(
        Modifier.widthIn(max = 240.dp).clip(shape).background(scheme.surfaceContainerHighest).border(BorderStroke(1.dp, scheme.outlineVariant), shape)
            .padding(start = 6.dp, top = 6.dp, bottom = 6.dp, end = 2.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(Modifier.size(44.dp).clip(RoundedCornerShape(10.dp)).background(scheme.surfaceContainer), contentAlignment = Alignment.Center) {
            val thumb = if (item.type.image) thumbnail(item.file) else null
            if (thumb != null) Image(thumb, null, Modifier.size(44.dp), contentScale = ContentScale.Crop)
            else Icon(if (item.type.image) OrbIcons.Image else OrbIcons.File, null, Modifier.size(22.dp), tint = OrbTheme.colors.text2)
            if (working) CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
        }
        Column(Modifier.widthIn(max = 150.dp)) {
            Text(item.name, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.labelLarge)
            when (item.state) {
                AttachState.Preparing -> Status(AttachTexts.PREPARING, false)
                AttachState.Uploading -> Status(AttachTexts.UPLOADING, false)
                AttachState.Ready -> Unit
                AttachState.Failed -> {
                    if (item.canRetry) {
                        Text(
                            "${item.error}. ${AttachTexts.RETRY}", color = scheme.error, style = MaterialTheme.typography.bodySmall, maxLines = 2,
                            modifier = Modifier.clickable(role = Role.Button) { onRetry(item.id) },
                        )
                    } else Status(item.error.orEmpty(), true)
                }
            }
        }
        IconButton(onClick = { onRemove(item.id) }, Modifier.size(32.dp).semantics { contentDescription = AttachTexts.REMOVE }) {
            Icon(OrbIcons.Close, null, Modifier.size(16.dp), tint = OrbTheme.colors.text2)
        }
    }
}

@Composable
private fun Status(text: String, error: Boolean) {
    Text(text, color = if (error) MaterialTheme.colorScheme.error else OrbTheme.colors.text2, style = MaterialTheme.typography.bodySmall, maxLines = 2)
}

/** A small decode of the prepared file; null until it is ready or when it cannot be read. */
@Composable
private fun thumbnail(file: File?): ImageBitmap? {
    val bitmap by produceState<ImageBitmap?>(null, file) {
        value = if (file == null) null else withContext(Dispatchers.IO) {
            try {
                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeFile(file.path, bounds)
                var sample = 1
                while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= 128) sample *= 2
                BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample })?.asImageBitmap()
            } catch (_: Exception) {
                null
            }
        }
    }
    return bitmap
}

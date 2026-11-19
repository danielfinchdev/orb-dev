package dev.orb.app.ui.attach

import android.graphics.BitmapFactory
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
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
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.orb.app.attach.AttachState
import dev.orb.app.attach.AttachTexts
import dev.orb.app.attach.Attachment
import dev.orb.app.attach.UploadPolicy
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.kit.OrbKit
import dev.orb.app.ui.kit.OrbSheet
import dev.orb.app.ui.kit.OrbSheetDivider
import dev.orb.app.ui.kit.OrbSheetItem
import dev.orb.app.ui.kit.reducedMotion
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** «Adjuntar»: «Cámara», «Galería» and, when the PC reads them, «Archivo». */
@Composable
fun AttachSheet(policy: UploadPolicy, launchers: AttachLaunchers, onDismiss: () -> Unit) {
    OrbSheet(onDismiss = onDismiss, title = AttachTexts.SHEET_TITLE) {
        // Both open a screen of the system, not of the app; the note says so.
        OrbSheetItem(AttachTexts.CAMERA, { onDismiss(); launchers.camera() }, icon = OrbIcons.Camera, meta = AttachTexts.CAMERA_META)
        OrbSheetItem(AttachTexts.GALLERY, { onDismiss(); launchers.gallery() }, icon = OrbIcons.Image, meta = AttachTexts.GALLERY_META)
        // A PC from before 3.8.4 takes pictures only, so there is nothing else to pick.
        if (policy.allowsFiles) OrbSheetItem(AttachTexts.FILE, { onDismiss(); launchers.file() }, icon = OrbIcons.File)
        OrbSheetDivider()
        Text(
            AttachTexts.ENCRYPT_HINT, Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
            color = OrbKit.faintForeground, fontSize = 12.sp, lineHeight = 16.sp,
        )
    }
}

/** The previews above the field: a card per file (thumbnail, name, progress or the error) and a button to take each off. */
@Composable
fun AttachStrip(items: List<Attachment>, notice: String?, onRemove: (Long) -> Unit, onRetry: (Long) -> Unit, modifier: Modifier = Modifier) {
    if (items.isEmpty() && notice == null) return
    Column(modifier.fillMaxWidth()) {
        if (items.isNotEmpty()) {
            // The top and end padding make room for the remove button, which sits half outside its card.
            Row(Modifier.horizontalScroll(rememberScrollState()).padding(top = 12.dp, end = 12.dp, bottom = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (item in items) Chip(item, onRemove, onRetry)
            }
        }
        if (notice != null) Text(notice, Modifier.padding(bottom = 4.dp), color = OrbKit.destructive, fontSize = 13.sp, lineHeight = 18.sp)
    }
}

/** `.lcard` of 72 dp: the mark or thumbnail, the name (12 sp) and, while it works, a bar. A failed one is wider to say why. */
@Composable
private fun Chip(item: Attachment, onRemove: (Long) -> Unit, onRetry: (Long) -> Unit) {
    val working = item.state == AttachState.Preparing || item.state == AttachState.Uploading
    val failed = item.state == AttachState.Failed
    val shape = RoundedCornerShape(12.dp)
    Box {
        Column(
            Modifier.width(if (failed) 132.dp else 72.dp).clip(shape).background(OrbKit.card).border(BorderStroke(1.dp, OrbKit.border), shape).padding(8.dp),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            val thumb = if (item.type.image) thumbnail(item.file) else null
            if (thumb != null) Image(thumb, null, Modifier.size(40.dp).clip(RoundedCornerShape(8.dp)), contentScale = ContentScale.Crop)
            else Icon(if (item.type.image) OrbIcons.Image else OrbIcons.FileText, null, Modifier.size(20.dp), tint = OrbKit.mutedForeground)
            Text(item.name, color = OrbKit.faintForeground, fontSize = 12.sp, lineHeight = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (working) {
                val say = if (item.state == AttachState.Preparing) AttachTexts.PREPARING else AttachTexts.UPLOADING
                BusyBar(Modifier.width(52.dp).semantics { contentDescription = say })
            }
            if (failed) {
                val text = if (item.canRetry) "${item.error}. ${AttachTexts.RETRY}" else item.error.orEmpty()
                Text(
                    text, Modifier.then(if (item.canRetry) Modifier.clickable(role = Role.Button) { onRetry(item.id) } else Modifier),
                    color = OrbKit.destructive, fontSize = 12.sp, lineHeight = 16.sp, maxLines = 3, overflow = TextOverflow.Ellipsis,
                )
            }
        }
        RemoveDot({ onRemove(item.id) }, Modifier.align(Alignment.TopEnd).offset(x = 12.dp, y = (-12).dp))
    }
}

/** A 48 dp touch zone with a small «×» in a disc, over the corner of a card. */
@Composable
private fun RemoveDot(onClick: () -> Unit, modifier: Modifier = Modifier) {
    Box(
        modifier.size(48.dp).clip(CircleShape).clickable(role = Role.Button, onClick = onClick).semantics { contentDescription = AttachTexts.REMOVE },
        contentAlignment = Alignment.Center,
    ) {
        Box(Modifier.size(20.dp).clip(CircleShape).background(OrbKit.secondary).border(1.dp, OrbKit.border, CircleShape), contentAlignment = Alignment.Center) {
            Icon(OrbIcons.Close, null, Modifier.size(12.dp), tint = OrbKit.mutedForeground)
        }
    }
}

/**
 * `.progress` with no known fraction (the upload does not report one): a segment that slides over the track. The slide
 * is the translation of a layer, so it costs no layout.
 */
@Composable
private fun BusyBar(modifier: Modifier = Modifier) {
    val still = reducedMotion()
    val phase by rememberInfiniteTransition(label = "busy-bar").animateFloat(0f, 1f, infiniteRepeatable(tween(1100, easing = LinearEasing)), label = "phase")
    Box(modifier.height(6.dp).clip(CircleShape).background(OrbKit.muted)) {
        Box(
            Modifier.fillMaxWidth(0.4f).height(6.dp).graphicsLayer {
                // From before the track to past it; with motion off the segment rests in the middle.
                translationX = if (still) size.width * 0.75f else size.width * (-1f + phase * 3.5f)
            }.clip(CircleShape).background(OrbKit.primaryText),
        )
    }
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

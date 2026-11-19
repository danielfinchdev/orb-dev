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
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.widthIn
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.unit.Dp
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

/**
 * The previews over the box: loose cards, one per file (thumbnail, whole name, progress or the error), as the mockup draws them.
 * A card has no button on it: a tap or a long press opens a sheet with «Quitar» (and «Reintentar» when it failed), and a screen
 * reader gets the same two actions on the card itself. [inset] is the side margin the strip brings (the share sheet brings its own).
 */
@Composable
fun AttachStrip(
    items: List<Attachment>, notice: String?, onRemove: (Long) -> Unit, onRetry: (Long) -> Unit, modifier: Modifier = Modifier,
    inset: Dp = 16.dp,
) {
    if (items.isEmpty() && notice == null) return
    var menu by remember { mutableStateOf<Long?>(null) }
    Column(modifier.fillMaxWidth()) {
        if (items.isNotEmpty()) {
            Row(
                Modifier.horizontalScroll(rememberScrollState()).padding(start = inset, end = inset, bottom = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                for (item in items) Chip(item, onOpen = { menu = item.id }, onRemove = onRemove, onRetry = onRetry)
            }
        }
        if (notice != null) Text(notice, Modifier.padding(horizontal = inset).padding(bottom = 4.dp), color = OrbKit.destructive, fontSize = 13.sp, lineHeight = 18.sp)
    }
    val open = menu?.let { id -> items.firstOrNull { it.id == id } }
    if (menu != null && open == null) menu = null
    if (open != null) OrbSheet(onDismiss = { menu = null }, title = open.name) {
        if (open.state == AttachState.Failed && open.canRetry) OrbSheetItem(AttachTexts.RETRY, { menu = null; onRetry(open.id) }, icon = OrbIcons.RotateCw)
        OrbSheetItem(AttachTexts.REMOVE_ONE, { menu = null; onRemove(open.id) }, icon = OrbIcons.Trash, danger = true)
    }
}

/** `.lcard` of at least 72 dp: the mark or thumbnail, the name (12 sp) and, while it works, a bar. A failed one is wider to say why. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun Chip(item: Attachment, onOpen: () -> Unit, onRemove: (Long) -> Unit, onRetry: (Long) -> Unit) {
    val working = item.state == AttachState.Preparing || item.state == AttachState.Uploading
    val failed = item.state == AttachState.Failed
    val shape = RoundedCornerShape(12.dp)
    Column(
        Modifier.then(if (failed) Modifier.width(132.dp) else Modifier.widthIn(min = 72.dp, max = 140.dp)).heightIn(min = 48.dp).clip(shape)
            .background(OrbKit.card).border(BorderStroke(1.dp, OrbKit.border), shape)
            .combinedClickable(
                role = Role.Button, onClickLabel = AttachTexts.OPTIONS, onClick = onOpen, onLongClickLabel = AttachTexts.OPTIONS, onLongClick = onOpen,
            )
            .semantics {
                customActions = buildList {
                    if (failed && item.canRetry) add(CustomAccessibilityAction(AttachTexts.RETRY) { onRetry(item.id); true })
                    add(CustomAccessibilityAction(AttachTexts.REMOVE_ONE) { onRemove(item.id); true })
                }
            }
            .padding(8.dp),
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
            Text(text, color = OrbKit.destructive, fontSize = 12.sp, lineHeight = 16.sp, maxLines = 3, overflow = TextOverflow.Ellipsis)
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

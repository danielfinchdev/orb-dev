package dev.orb.app.ui.kit

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.clickable
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.theme.OrbFonts

private val sheetShape = RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp)
private val scrim = Color.Black.copy(alpha = 0.32f)

/**
 * `.sheet`: a bottom sheet in its own window, so the system back closes it and focus and screen readers treat it as a
 * dialog. At most 88 % of the screen; the body scrolls. [onClose] non-null draws the close button in the header.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OrbSheet(
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    title: String? = null,
    closeLabel: String = "Cerrar",
    showClose: Boolean = false,
    header: (@Composable RowScope.() -> Unit)? = null,
    /** Stays under the scrolling body, always in view (the mockups' `.actbar`). */
    footer: (@Composable ColumnScope.() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val maxHeight = (LocalConfiguration.current.screenHeightDp * 0.88f).dp
    ModalBottomSheet(
        onDismissRequest = onDismiss, modifier = modifier,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        shape = sheetShape, containerColor = OrbKit.popover, contentColor = OrbKit.foreground, tonalElevation = 0.dp, scrimColor = scrim,
        dragHandle = {
            Box(Modifier.padding(top = 10.dp, bottom = 4.dp).size(36.dp, 4.dp).clip(CircleShape).background(OrbKit.border))
        },
    ) {
        Column(Modifier.heightIn(max = maxHeight).padding(bottom = 20.dp)) {
            // the header of a sheet (.sh): a mark, a name and a line of context instead of a plain title
            if (header != null) Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 6.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp), content = header)
            else if (title != null || showClose) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(top = 6.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        title.orEmpty(), Modifier.weight(1f).semantics { heading() }, color = OrbKit.foreground, fontSize = 16.sp,
                        lineHeight = 22.sp, fontFamily = OrbFonts.title, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                    if (showClose) OrbIconButton(OrbIcons.Close, closeLabel, onDismiss)
                }
            }
            Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()), content = content)
            if (footer != null) footer()
        }
    }
}

/** `.it`: a 52 dp row of a sheet. [checked] non-null makes it a choice; [danger] paints it in the destructive colour. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun OrbSheetItem(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    meta: String? = null,
    danger: Boolean = false,
    checked: Boolean? = null,
    chevron: Boolean = false,
    /** False draws the row dimmed and out of reach; [meta] can say why. */
    enabled: Boolean = true,
    /** Anything at the end of the row (a count bubble, a switch), after [meta]. */
    trailing: (@Composable () -> Unit)? = null,
) {
    val tone = if (danger) OrbKit.destructive else OrbKit.foreground
    val click = if (checked != null) Modifier.selectable(selected = checked, enabled = enabled, role = Role.RadioButton, onClick = onClick)
    else Modifier.clickable(enabled = enabled, role = Role.Button, onClick = onClick)
    Row(
        modifier.fillMaxWidth().defaultMinSize(minHeight = 52.dp).then(click).then(if (enabled) Modifier else Modifier.alpha(0.45f)).padding(horizontal = 20.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        if (icon != null) Icon(icon, null, Modifier.size(20.dp), tint = if (danger) OrbKit.destructive else OrbKit.mutedForeground)
        Text(
            text, Modifier.weight(1f), color = tone, fontSize = 15.sp, lineHeight = 22.sp,
            fontWeight = if (checked == true) FontWeight.Medium else FontWeight.Normal, maxLines = 2, overflow = TextOverflow.Ellipsis,
        )
        if (meta != null) Text(meta, color = OrbKit.faintForeground, fontSize = 12.sp, lineHeight = 16.sp)
        if (checked == true) Icon(OrbIcons.Check, null, Modifier.size(20.dp), tint = OrbKit.foreground)
        if (chevron) Icon(OrbIcons.ChevronRight, null, Modifier.size(20.dp), tint = OrbKit.faintForeground)
        trailing?.invoke()
    }
}

/**
 * A two-line choice of a sheet (the mockups' 64 dp radio `.it`): a mark, a title with a line of explanation and, at the
 * end, a filled check circle while chosen or an empty one.
 */
@Composable
fun OrbSheetChoice(title: String, hint: String, icon: ImageVector, selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    Row(
        modifier.fillMaxWidth().defaultMinSize(minHeight = 64.dp).selectable(selected = selected, enabled = enabled, role = Role.RadioButton, onClick = onClick)
            .padding(horizontal = 20.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Icon(icon, null, Modifier.size(20.dp), tint = OrbKit.mutedForeground)
        Column(Modifier.weight(1f)) {
            Text(title, color = OrbKit.foreground, fontSize = 15.sp, lineHeight = 21.sp, fontWeight = FontWeight.Medium)
            Text(hint, color = OrbKit.mutedForeground, fontSize = 13.sp, lineHeight = 17.sp)
        }
        // Like every `.it .lucide` of the mockup: the muted colour, chosen or not; only the glyph tells which one is on.
        Icon(if (selected) OrbIcons.CircleCheck else OrbIcons.Circle, null, Modifier.size(20.dp), tint = OrbKit.mutedForeground)
    }
}

/** A row of a sheet that only tells something (no tap): a mark, the text and a quiet remark at the end. */
@Composable
fun OrbSheetInfo(text: String, icon: ImageVector, modifier: Modifier = Modifier, meta: String? = null) {
    Row(
        modifier.fillMaxWidth().defaultMinSize(minHeight = 44.dp).padding(horizontal = 20.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Icon(icon, null, Modifier.size(20.dp), tint = OrbKit.mutedForeground)
        Text(text, Modifier.weight(1f), color = OrbKit.foreground, fontSize = 15.sp, lineHeight = 22.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
        if (meta != null) Text(meta, color = OrbKit.faintForeground, fontSize = 12.sp, lineHeight = 16.sp)
    }
}

/** `hr` inside a sheet. */
@Composable
fun OrbSheetDivider() {
    Box(Modifier.padding(vertical = 6.dp).fillMaxWidth().height(1.dp).background(OrbKit.border))
}

/** `.lab-s`: the small label that opens a section of a sheet. */
@Composable
fun OrbSheetLabel(text: String) {
    Text(text, Modifier.padding(start = 20.dp, end = 20.dp, top = 10.dp, bottom = 4.dp), color = OrbKit.faintForeground, fontSize = 12.sp, lineHeight = 16.sp)
}

/** A button of an [OrbDialog]; [danger] paints the main action in the destructive colour. */
class OrbDialogAction(val label: String, val onClick: () -> Unit, val danger: Boolean = false, val enabled: Boolean = true)

/**
 * `.mdlg`: a confirmation dialog in its own window. The buttons sit on the right and the main action is the last,
 * at the far right.
 */
@Composable
fun OrbDialog(
    onDismiss: () -> Unit,
    title: String,
    confirm: OrbDialogAction,
    modifier: Modifier = Modifier,
    text: String? = null,
    dismiss: OrbDialogAction? = null,
    content: (@Composable ColumnScope.() -> Unit)? = null,
) {
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        // The mockups dim the screen by 32 %, lighter than the platform's default.
        (LocalView.current.parent as? DialogWindowProvider)?.window?.let { w -> SideEffect { w.setDimAmount(0.32f) } }
        // `.scrim.center`: the window spans the screen and the dialog sits in the middle of what the system bars and the
        // keyboard leave free. A tap on the dim area dismisses it, as the platform does for a dialog that is not full-screen.
        Box(
            Modifier.fillMaxSize().systemBarsPadding().imePadding().pointerInput(Unit) { detectTapGestures { onDismiss() } }.padding(24.dp),
            contentAlignment = Alignment.Center,
        ) {
            Surface(
                modifier.fillMaxWidth().pointerInput(Unit) { detectTapGestures { } }, shape = RadiusBig, color = OrbKit.popover, contentColor = OrbKit.foreground, shadowElevation = 12.dp,
            ) {
                Column(Modifier.padding(start = 20.dp, end = 20.dp, top = 20.dp, bottom = 12.dp)) {
                    Text(
                        title, Modifier.padding(bottom = 8.dp).semantics { heading() }, color = OrbKit.foreground, fontSize = 18.sp,
                        lineHeight = 24.sp, fontFamily = OrbFonts.title, fontWeight = FontWeight.SemiBold,
                    )
                    if (text != null) Text(text, Modifier.padding(bottom = 16.dp), color = OrbKit.mutedForeground, fontSize = 14.5.sp, lineHeight = 22.sp)
                    if (content != null) Column(Modifier.padding(bottom = 16.dp), content = content)
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End), verticalAlignment = Alignment.CenterVertically) {
                        if (dismiss != null) OrbButton(dismiss.label, dismiss.onClick, enabled = dismiss.enabled, kind = if (dismiss.danger) OrbButtonKind.Danger else OrbButtonKind.Ghost)
                        OrbButton(confirm.label, confirm.onClick, enabled = confirm.enabled, kind = if (confirm.danger) OrbButtonKind.Danger else OrbButtonKind.Primary)
                    }
                }
            }
        }
    }
}

package dev.orb.app.ui.kit

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.theme.OrbMotion

/** `--r-ctl` (8), `--r-card` (12), `--r-big` (18). */
internal val RadiusCtl = RoundedCornerShape(8.dp)
internal val RadiusCard = RoundedCornerShape(12.dp)
internal val RadiusBig = RoundedCornerShape(18.dp)

enum class OrbButtonKind { Primary, Secondary, Ghost, Danger }

/**
 * `.btn`: 40 dp (32 with [small], 48 with [big]) inside a 48 dp touch zone. Primary is the neutral one (black by day, white by
 * night); Secondary has an outline; Danger paints destructive text and border; Ghost has neither.
 */
@Composable
fun OrbButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    kind: OrbButtonKind = OrbButtonKind.Secondary,
    small: Boolean = false,
    block: Boolean = false,
    enabled: Boolean = true,
    icon: ImageVector? = null,
    big: Boolean = false,
) {
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val fg = when (kind) {
        OrbButtonKind.Primary -> OrbKit.primaryForeground
        OrbButtonKind.Secondary -> OrbKit.foreground
        OrbButtonKind.Ghost -> OrbKit.mutedForeground
        OrbButtonKind.Danger -> OrbKit.destructive
    }
    val bg = when (kind) {
        OrbButtonKind.Primary -> OrbKit.primary
        OrbButtonKind.Secondary -> OrbKit.card
        else -> Color.Transparent
    }
    val borderColor = when (kind) {
        OrbButtonKind.Secondary -> OrbKit.border
        OrbButtonKind.Danger -> lerp(OrbKit.border, OrbKit.destructive, 0.4f)
        else -> null
    }
    val hover = OrbKit.accent
    val h = if (small) 32.dp else if (big) 48.dp else 40.dp
    Box(
        modifier.then(if (block) Modifier.fillMaxWidth() else Modifier)
            .clickable(source, null, enabled = enabled, role = Role.Button, onClick = onClick)
            .minimumInteractiveComponentSize(),
        contentAlignment = Alignment.Center,
    ) {
        Row(
            Modifier.then(if (block) Modifier.fillMaxWidth() else Modifier).height(h).clip(RadiusCtl)
                .background(bg).then(if (pressed && kind != OrbButtonKind.Primary) Modifier.background(hover) else Modifier)
                .then(if (borderColor != null) Modifier.border(1.dp, borderColor, RadiusCtl) else Modifier)
                .graphicsLayer { alpha = if (enabled) (if (pressed && kind == OrbButtonKind.Primary) 0.85f else 1f) else 0.45f }
                .padding(horizontal = if (small) 12.dp else 16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp, if (block) Alignment.CenterHorizontally else Alignment.Start),
        ) {
            if (icon != null) Icon(icon, null, Modifier.size(if (small) 16.dp else 20.dp), tint = fg)
            Text(text, color = fg, fontSize = if (small) 13.sp else 14.5.sp, lineHeight = 20.sp, fontWeight = if (kind == OrbButtonKind.Primary) FontWeight.Normal else FontWeight.Medium, maxLines = 1)
        }
    }
}

/** `.sw`: 40×24 with a 20 dp ball; the ball slides and the track changes colour. */
@Composable
fun OrbSwitch(checked: Boolean, onCheckedChange: ((Boolean) -> Unit)?, modifier: Modifier = Modifier, label: String? = null, enabled: Boolean = true) {
    val travel = with(LocalDensity.current) { 16.dp.toPx() }
    val x by animateFloatAsState(if (checked) travel else 0f, kitTween(OrbMotion.Short), label = "ball")
    val off = OrbKit.foreground.copy(alpha = 0.15f)
    val on = OrbKit.primaryText
    val track by animateColorAsState(if (checked) on else off, kitTween(OrbMotion.Short), label = "track")
    val ball = OrbKit.background
    val base = modifier.size(48.dp, 48.dp)
    val interactive = if (onCheckedChange != null) {
        base.toggleable(value = checked, enabled = enabled, role = Role.Switch, onValueChange = onCheckedChange)
    } else base
    Box(interactive.then(if (label != null) Modifier.semantics { contentDescription = label } else Modifier), contentAlignment = Alignment.Center) {
        Box(
            Modifier.size(40.dp, 24.dp).graphicsLayer { alpha = if (enabled) 1f else 0.45f }.clip(CircleShape).background(track),
        ) {
            Box(
                Modifier.padding(2.dp).size(20.dp).graphicsLayer { translationX = x }
                    .shadow(1.dp, CircleShape).clip(CircleShape).background(ball),
            )
        }
    }
}

/**
 * A filter chip (`.chip`): 32 dp, round; pressed it takes the neutral primary. [count] is the small number, [lead] a mark before
 * the text and [trailing] a coloured remark after it (a file's +/−).
 */
@Composable
fun OrbChip(
    label: String, selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier, count: Int? = null,
    lead: (@Composable () -> Unit)? = null, trailing: (@Composable () -> Unit)? = null,
) {
    val bg = if (selected) OrbKit.primary else OrbKit.card
    val fg = if (selected) OrbKit.primaryForeground else OrbKit.mutedForeground
    // No ripple: it would paint the whole 48 dp touch zone as a grey rectangle behind the round chip; pressing dims the chip itself.
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    Box(
        modifier.selectable(selected = selected, interactionSource = source, indication = null, role = Role.Button, onClick = onClick).minimumInteractiveComponentSize(),
        contentAlignment = Alignment.Center,
    ) {
        Row(
            Modifier.height(32.dp).graphicsLayer { alpha = if (pressed) 0.7f else 1f }.clip(CircleShape).background(bg)
                .then(if (selected) Modifier else Modifier.border(1.dp, OrbKit.border, CircleShape)).padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            if (lead != null) lead()
            Text(label, color = fg, fontSize = 13.sp, lineHeight = 18.sp, maxLines = 1)
            if (count != null) Text(count.toString(), color = fg.copy(alpha = 0.75f), fontSize = 11.sp, lineHeight = 16.sp)
            if (trailing != null) trailing()
        }
    }
}

/** `.segm`: a track with one raised choice; for two to four short options. [stretch] makes the choices share the full width. */
@Composable
fun OrbSegmented(
    options: List<String>, selected: Int, onSelect: (Int) -> Unit, modifier: Modifier = Modifier, stretch: Boolean = false,
    /** The track spans the width while the choices keep their own size (the mockup's `.segm` at 100 %). */
    track: Boolean = false,
) {
    Row(
        modifier.then(if (stretch || track) Modifier.fillMaxWidth() else Modifier).clip(RadiusCtl).background(OrbKit.secondary).padding(2.dp).selectableGroup(),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        options.forEachIndexed { i, label ->
            val on = i == selected
            val shape = RoundedCornerShape(6.dp)
            Box(
                // Stretched choices share the width by the length of their text, so a long one is not cut short.
                Modifier.then(if (stretch) Modifier.weight(label.length + 6f) else Modifier).height(32.dp).then(if (on) Modifier.shadow(1.dp, shape) else Modifier).clip(shape)
                    .background(if (on) OrbKit.card else Color.Transparent)
                    .selectable(selected = on, role = Role.RadioButton, onClick = { onSelect(i) }).padding(horizontal = 10.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(label, color = if (on) OrbKit.foreground else OrbKit.mutedForeground, fontSize = 13.sp, lineHeight = 18.sp, maxLines = 1)
            }
        }
    }
}

/**
 * `.mfield` as a real text field. [focus] lets the screen put the cursor in it on entering; [onClear] draws the «x»
 * (in a 32 dp zone) while there is text.
 */
@Composable
fun OrbSearchField(
    value: String, onValueChange: (String) -> Unit, placeholder: String, modifier: Modifier = Modifier,
    focus: FocusRequester? = null, onClear: (() -> Unit)? = null, clearLabel: String = "Borrar texto",
) {
    Row(
        modifier.fillMaxWidth().height(44.dp).clip(RadiusCard).background(OrbKit.secondary).padding(start = 14.dp, end = if (onClear != null) 6.dp else 14.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(OrbIcons.Search, null, Modifier.size(20.dp), tint = OrbKit.mutedForeground)
        Box(Modifier.weight(1f)) {
            if (value.isEmpty()) Text(placeholder, color = OrbKit.mutedForeground, fontSize = 15.sp, maxLines = 1)
            BasicTextField(
                value, onValueChange,
                Modifier.fillMaxWidth().then(if (focus != null) Modifier.focusRequester(focus) else Modifier).semantics { contentDescription = placeholder },
                singleLine = true, textStyle = TextStyle(color = OrbKit.foreground, fontSize = 15.sp), cursorBrush = SolidColor(OrbKit.foreground),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            )
        }
        if (onClear != null && value.isNotEmpty()) {
            Box(
                Modifier.size(32.dp).clip(CircleShape).clickable(role = Role.Button, onClick = onClear).semantics { contentDescription = clearLabel },
                contentAlignment = Alignment.Center,
            ) { Icon(OrbIcons.Close, null, Modifier.size(20.dp), tint = OrbKit.mutedForeground) }
        }
    }
}

/** `.mfield` as a button that opens the search screen. */
@Composable
fun OrbSearchButton(placeholder: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier.fillMaxWidth().height(44.dp).clip(RadiusCard).background(OrbKit.secondary)
            .clickable(role = Role.Button, onClick = onClick).padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(OrbIcons.Search, null, Modifier.size(20.dp), tint = OrbKit.mutedForeground)
        Text(placeholder, Modifier.weight(1f), color = OrbKit.mutedForeground, fontSize = 15.sp, maxLines = 1)
    }
}

/**
 * `.field` with a real text input: 48 dp, a thin border, the person's text in the foreground colour. [soft] is the sheets' `.mfield`
 * instead: 44 dp, soft grey and no border. [label] is what a screen reader says (the placeholder is drawn only while the field is empty).
 */
@Composable
fun OrbTextField(
    value: String, onValueChange: (String) -> Unit, label: String, modifier: Modifier = Modifier,
    focus: FocusRequester? = null, onDone: (() -> Unit)? = null, soft: Boolean = false,
    leading: ImageVector? = null, trailing: (@Composable () -> Unit)? = null, secret: Boolean = false,
    keyboardType: androidx.compose.ui.text.input.KeyboardType = androidx.compose.ui.text.input.KeyboardType.Text,
    enabled: Boolean = true, invalid: Boolean = false,
    /** What the empty field shows; the [label] by default, nothing when a label above the field already says it. */
    placeholder: String = label,
    /** More than one makes a growing multi-line input (a note) instead of the fixed single-line row; [maxLines] caps the growth. */
    minLines: Int = 1, maxLines: Int = 8,
) {
    val multi = minLines > 1
    val border = if (invalid) OrbKit.destructive else OrbKit.border
    Row(
        modifier.fillMaxWidth().then(if (multi) Modifier.defaultMinSize(minHeight = 48.dp) else Modifier.height(if (soft) 44.dp else 48.dp)).clip(RadiusCard).background(if (soft) OrbKit.secondary else OrbKit.card)
            .then(if (soft && !invalid) Modifier else Modifier.border(1.dp, border, RadiusCard)).padding(start = 14.dp, end = if (trailing != null) 6.dp else 14.dp).then(if (multi) Modifier.padding(vertical = 12.dp) else Modifier),
        verticalAlignment = if (multi) Alignment.Top else Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (leading != null) Icon(leading, null, Modifier.size(18.dp), tint = OrbKit.mutedForeground)
        Box(Modifier.weight(1f), contentAlignment = if (multi) Alignment.TopStart else Alignment.CenterStart) {
            if (value.isEmpty() && placeholder.isNotEmpty()) Text(placeholder, color = if (soft) OrbKit.mutedForeground else OrbKit.faintForeground, fontSize = 15.sp, maxLines = 1)
            BasicTextField(
                value, onValueChange,
                Modifier.fillMaxWidth().then(if (focus != null) Modifier.focusRequester(focus) else Modifier).semantics { contentDescription = label },
                enabled = enabled, singleLine = !multi, minLines = minLines, maxLines = if (multi) maxLines else 1, textStyle = TextStyle(color = OrbKit.foreground, fontSize = 15.sp), cursorBrush = SolidColor(OrbKit.foreground),
                visualTransformation = if (secret) androidx.compose.ui.text.input.PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
                keyboardOptions = KeyboardOptions(keyboardType = keyboardType, imeAction = if (multi) ImeAction.Default else ImeAction.Done),
                keyboardActions = androidx.compose.foundation.text.KeyboardActions(onDone = { onDone?.invoke() }),
            )
        }
        if (trailing != null) trailing()
    }
}

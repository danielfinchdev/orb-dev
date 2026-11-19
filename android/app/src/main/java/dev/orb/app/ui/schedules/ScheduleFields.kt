package dev.orb.app.ui.schedules

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.orb.app.ui.kit.OrbKit

private val FieldShape = RoundedCornerShape(12.dp)

/**
 * The mockup's `.mfield` for what the kit's single-line field cannot be: several lines (the instructions) or a number.
 * [label] is what a screen reader says; the hint shows while the field is empty.
 */
@Composable
fun ScheduleField(
    value: String, onValueChange: (String) -> Unit, label: String, modifier: Modifier = Modifier,
    hint: String = label, minLines: Int = 1, maxLines: Int = if (minLines > 1) 8 else 1, numeric: Boolean = false,
) {
    val multi = maxLines > 1
    Box(
        modifier.clip(FieldShape).background(OrbKit.card).border(1.dp, OrbKit.border, FieldShape)
            .defaultMinSize(minHeight = if (multi) (22 * minLines + 26).dp else 48.dp).padding(horizontal = 14.dp, vertical = if (multi) 12.dp else 0.dp),
        contentAlignment = if (multi) Alignment.TopStart else Alignment.CenterStart,
    ) {
        if (value.isEmpty()) Text(hint, color = OrbKit.faintForeground, fontSize = 15.sp, lineHeight = 22.sp, maxLines = if (multi) 3 else 1)
        BasicTextField(
            value, onValueChange, Modifier.fillMaxWidth().semantics { contentDescription = label },
            singleLine = !multi, minLines = minLines, maxLines = maxLines,
            textStyle = TextStyle(color = OrbKit.foreground, fontSize = 15.sp, lineHeight = 22.sp), cursorBrush = SolidColor(OrbKit.foreground),
            keyboardOptions = KeyboardOptions(keyboardType = if (numeric) KeyboardType.Number else KeyboardType.Text, imeAction = if (multi) ImeAction.Default else ImeAction.Done),
        )
    }
}

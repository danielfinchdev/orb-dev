package dev.orb.app.ui.tasks

import androidx.compose.foundation.border
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.orb.app.ui.chats.ChatTexts
import dev.orb.app.ui.kit.OrbChip
import dev.orb.app.ui.kit.OrbDialog
import dev.orb.app.ui.kit.OrbDialogAction
import dev.orb.app.ui.kit.OrbKit
import dev.orb.app.ui.kit.OrbTextField

/** «Nueva tarea»: the project, a title and what the agent has to do. The PC creates it; nothing runs on the phone. */
@Composable
internal fun NewTaskDialog(state: NewTaskState, onCreate: (String, String, String) -> Unit, onDismiss: () -> Unit) {
    var project by rememberSaveable { mutableStateOf<String?>(null) }
    var title by rememberSaveable { mutableStateOf("") }
    var description by rememberSaveable { mutableStateOf("") }
    val chosen = project ?: state.projects.firstOrNull()
    OrbDialog(
        onDismiss = { if (!state.saving) onDismiss() }, title = TaskTexts.NEW_TASK,
        confirm = OrbDialogAction(
            TaskTexts.NEW_TASK_CREATE, { chosen?.let { onCreate(it, title, description) } },
            enabled = !state.saving && chosen != null && title.isNotBlank() && description.isNotBlank(),
        ),
        dismiss = OrbDialogAction(ChatTexts.CANCEL, onDismiss, enabled = !state.saving),
    ) {
        // The keyboard and a long project list must not push the buttons off a small screen.
        Column(Modifier.heightIn(max = 380.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            when {
                state.loading -> Text(TaskTexts.NEW_TASK_LOADING, color = OrbKit.mutedForeground, fontSize = 14.5.sp, lineHeight = 20.sp)
                state.projects.isEmpty() -> Text(TaskTexts.NEW_TASK_NO_PROJECTS, color = OrbKit.mutedForeground, fontSize = 14.5.sp, lineHeight = 20.sp)
                else -> Column {
                    Text(TaskTexts.NEW_TASK_PROJECT, color = OrbKit.faintForeground, fontSize = 12.sp, lineHeight = 16.sp)
                    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        for (p in state.projects) OrbChip(p, selected = p == chosen, onClick = { project = p })
                    }
                }
            }
            OrbTextField(title, { title = it }, TaskTexts.NEW_TASK_TITLE)
            TextArea(description, { description = it }, TaskTexts.NEW_TASK_DESCRIPTION)
            state.error?.let { Text(it, color = OrbKit.destructive, fontSize = 13.sp, lineHeight = 18.sp) }
            Spacer(Modifier.height(2.dp))
        }
    }
}

/** The field of [OrbTextField] for a longer text: the same border and type, several lines; [soft] is the sheets' grey one. */
@Composable
internal fun TextArea(value: String, onValueChange: (String) -> Unit, label: String, modifier: Modifier = Modifier, soft: Boolean = false) {
    val shape = RoundedCornerShape(12.dp)
    Box(
        modifier.fillMaxWidth().defaultMinSize(minHeight = 96.dp).clip(shape).background(if (soft) OrbKit.secondary else OrbKit.card)
            .then(if (soft) Modifier else Modifier.border(1.dp, OrbKit.border, shape)).padding(horizontal = 14.dp, vertical = 13.dp),
        contentAlignment = Alignment.TopStart,
    ) {
        if (value.isEmpty()) Text(label, color = if (soft) OrbKit.mutedForeground else OrbKit.faintForeground, fontSize = 15.sp, maxLines = 1)
        BasicTextField(
            value, onValueChange, Modifier.fillMaxWidth().semantics { contentDescription = label }, minLines = 3, maxLines = 6,
            textStyle = TextStyle(color = OrbKit.foreground, fontSize = 15.sp, lineHeight = 21.sp), cursorBrush = SolidColor(OrbKit.foreground),
        )
    }
}

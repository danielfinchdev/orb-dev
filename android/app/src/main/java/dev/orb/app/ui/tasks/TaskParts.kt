package dev.orb.app.ui.tasks

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.orb.app.ui.chats.agentName
import dev.orb.app.ui.theme.OrbTheme

/** The state of a task as a small pill; the colour says whether it is fine, needs the person or went wrong. */
@Composable
fun TaskStatusPill(row: TaskRow, modifier: Modifier = Modifier) {
    val c = OrbTheme.colors
    val scheme = MaterialTheme.colorScheme
    val (bg: Color, fg: Color) = when {
        row.held != null || row.status == "awaiting_approval" -> c.warnSoft to c.warn
        row.status == "done" -> c.okSoft to c.ok
        row.status == "failed" || row.status == "blocked" || row.status == "limited" -> c.errSoft to scheme.error
        row.status == "running" -> scheme.primaryContainer to scheme.onPrimaryContainer
        else -> scheme.surfaceContainerHigh to c.text2
    }
    Text(
        TaskTexts.status(row.status, row.held != null), modifier.clip(RoundedCornerShape(50)).background(bg).padding(horizontal = 10.dp, vertical = 3.dp),
        style = MaterialTheme.typography.labelMedium, color = fg, maxLines = 1,
    )
}

/** «Proyecto · Claude · Sonnet» under a task's title. */
fun taskSubtitle(row: TaskRow): String =
    listOfNotNull(row.project?.takeIf { it.isNotBlank() }, agentName(row.agent), row.model?.takeIf { it.isNotBlank() }).joinToString(" · ")

@Composable
fun TaskProgress(row: TaskRow, modifier: Modifier = Modifier) {
    if (!row.running) return
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        val p = row.percent
        if (p != null) LinearProgressIndicator(progress = { p.coerceIn(0, 100) / 100f }, Modifier.fillMaxWidth())
        else LinearProgressIndicator(Modifier.fillMaxWidth())
        row.note?.takeIf { it.isNotBlank() }?.let {
            Text(it, style = MaterialTheme.typography.bodySmall, color = OrbTheme.colors.text2, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(text, modifier.padding(top = 16.dp, bottom = 4.dp), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
}

@Composable
fun LabelValue(label: String, value: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 3.dp), verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(label, Modifier.weight(0.4f), style = MaterialTheme.typography.bodyMedium, color = OrbTheme.colors.text2)
        Text(value, Modifier.weight(0.6f), style = MaterialTheme.typography.bodyMedium)
    }
}

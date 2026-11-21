package dev.orb.app.ui.schedules

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.kit.OrbBadge
import dev.orb.app.ui.kit.OrbButton
import dev.orb.app.ui.kit.OrbButtonKind
import dev.orb.app.ui.kit.OrbCard
import dev.orb.app.ui.kit.OrbChip
import dev.orb.app.ui.kit.OrbKit
import dev.orb.app.ui.kit.OrbNote
import dev.orb.app.ui.kit.OrbSettingRow
import dev.orb.app.ui.kit.OrbSheet
import dev.orb.app.ui.kit.OrbSheetItem
import dev.orb.app.ui.kit.OrbSheetLabel
import dev.orb.app.ui.kit.OrbSwitch
import dev.orb.app.ui.kit.OrbTextField
import java.util.TimeZone

/**
 * `Programar` (the mockup's create sheet) and its edit twin: a name, the instructions (the PC asks for them: without them
 * there is no task), the days, the time and the project. Everything else the PC takes is under «Más opciones».
 * An edit sends only what the person changed.
 */
@Composable
fun ScheduleSheet(
    f: ScheduleForm, pcFields: Boolean, onCreate: (NewSchedule) -> Unit, onSave: (SchedulePatch) -> Unit, onDismiss: () -> Unit,
) {
    val editing = f.editing
    val initial = remember(editing?.id) { editing?.let(ScheduleDraft::of) ?: ScheduleDraft() }
    var draft by rememberSaveable(editing?.id, stateSaver = ScheduleDraft.Saver) { mutableStateOf(initial) }
    var more by rememberSaveable { mutableStateOf(false) }
    var picking by rememberSaveable { mutableStateOf<String?>(null) }
    var pickingProject by rememberSaveable { mutableStateOf(false) }
    val project = draft.project ?: f.projects.firstOrNull()
    val ready = !f.saving && draft.ready(project)

    when (picking) {
        "time" -> ScheduleTimeDialog(draft.time, { draft = draft.copy(time = it); picking = null }, { picking = null })
        "date" -> ScheduleDateSheet(draft.date, { draft = draft.copy(date = it); picking = null }, { picking = null })
    }
    if (pickingProject) ProjectSheet(f.projects, project, { draft = draft.copy(project = it); pickingProject = false }) { pickingProject = false }

    OrbSheet(
        onDismiss = { if (!f.saving) onDismiss() }, title = if (editing != null) SchedulesTexts.EDIT_TITLE else SchedulesTexts.NEW_TITLE,
        footer = {
            Box(Modifier.fillMaxWidth().height(1.dp).background(OrbKit.border))
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End), verticalAlignment = Alignment.CenterVertically,
            ) {
                OrbButton(SchedulesTexts.CANCEL, onDismiss, kind = OrbButtonKind.Ghost, enabled = !f.saving)
                OrbButton(
                    if (f.saving) SchedulesTexts.SAVING else SchedulesTexts.EDIT_OK,
                    {
                        val chosen = project ?: return@OrbButton
                        if (editing != null) onSave(draft.toPatch(initial, chosen, editing.project, pcFields)) else onCreate(draft.toNew(chosen, pcFields))
                    },
                    kind = OrbButtonKind.Primary, enabled = ready,
                )
            }
        },
    ) {
        Column(Modifier.padding(horizontal = 16.dp).padding(bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            OrbTextField(draft.title, { draft = draft.copy(title = it) }, SchedulesTexts.FIELD_NAME, soft = true)
            ScheduleField(draft.what, { draft = draft.copy(what = it) }, SchedulesTexts.FIELD_WHAT, hint = SchedulesTexts.FIELD_WHAT_HINT, minLines = 3)
            if (draft.kind == ScheduleKind.DAYS && !draft.foreignTiming) {
                DayChips(draft.days) { draft = draft.copy(days = it) }
                if (draft.days.isEmpty()) Text(SchedulesTexts.DAYS_NEED_ONE, color = OrbKit.destructive, fontSize = 12.sp, lineHeight = 16.sp)
            }
            OrbCard {
                var rows = 0
                fun divider() = rows++ > 0
                if (!draft.foreignTiming) {
                    when (draft.kind) {
                        ScheduleKind.MONTHLY -> {
                            NumberRow(SchedulesTexts.FIELD_MONTH_DAY, draft.monthDay, { draft = draft.copy(monthDay = it.take(2)) }, divider(), SchedulesTexts.FIELD_MONTH_DAY_HINT)
                            TimeRow(draft, divider()) { picking = "time" }
                        }
                        ScheduleKind.EVERY_HOURS -> NumberRow(SchedulesTexts.FIELD_HOURS, draft.hours, { draft = draft.copy(hours = it.take(3)) }, divider(), null)
                        ScheduleKind.HOURLY -> Unit
                        ScheduleKind.ONCE -> {
                            OrbSettingRow(
                                SchedulesTexts.FIELD_DATE, divider = divider(), onClick = { picking = "date" },
                                trailing = { OrbBadge(draft.date.ifEmpty { SchedulesTexts.PICK_PLACEHOLDER }) },
                            )
                            TimeRow(draft, divider()) { picking = "time" }
                        }
                        else -> TimeRow(draft, divider()) { picking = "time" }
                    }
                }
                OrbSettingRow(
                    SchedulesTexts.FIELD_PROJECT, subtitle = project ?: SchedulesTexts.PICK_PLACEHOLDER, divider = divider(),
                    onClick = if (f.projects.isNotEmpty()) ({ pickingProject = true }) else null,
                    trailing = { Icon(OrbIcons.ChevronRight, null, Modifier.size(20.dp), tint = OrbKit.faintForeground) },
                )
            }
            if (f.projects.isEmpty() && editing == null) Text(SchedulesTexts.NO_PROJECT, color = OrbKit.warningInk, fontSize = 12.sp, lineHeight = 16.sp)
            f.error?.let { Text(it, Modifier.semantics { liveRegion = LiveRegionMode.Polite }, color = OrbKit.destructive, fontSize = 13.sp, lineHeight = 18.sp) }
        }
        OrbSheetItem(SchedulesTexts.MORE_OPTIONS, onClick = { more = !more }, icon = if (more) OrbIcons.ChevronUp else OrbIcons.ChevronDown)
        if (more) MoreOptions(f, draft, editing, pcFields) { draft = it }
    }
}

@Composable
private fun DayChips(days: Set<Int>, onChange: (Set<Int>) -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        for ((letter, day) in SchedulesTexts.WEEK) {
            OrbChip(
                letter, day in days, { onChange(if (day in days) days - day else days + day) },
                Modifier.semantics { contentDescription = SchedulesTexts.dayName(day) },
            )
        }
    }
}

@Composable
private fun TimeRow(d: ScheduleDraft, divider: Boolean, onClick: () -> Unit) {
    val zone = d.tz.trim().takeIf { it.isNotEmpty() }?.let { "${ScheduleStamps.city(it)}, ${SchedulesTexts.ZONE_CHOSEN}" } ?: SchedulesTexts.ZONE_OF_PC
    OrbSettingRow(SchedulesTexts.FIELD_TIME, subtitle = zone.replaceFirstChar { it.uppercase() }, divider = divider, onClick = onClick, trailing = { OrbBadge(d.time.removePrefix("0")) })
}

@Composable
private fun NumberRow(title: String, value: String, onChange: (String) -> Unit, divider: Boolean, hint: String?) {
    OrbSettingRow(
        title, subtitle = hint, divider = divider,
        trailing = { ScheduleField(value, { onChange(it.filter(Char::isDigit)) }, title, Modifier.width(80.dp), numeric = true) },
    )
}

@Composable
private fun ProjectSheet(projects: List<String>, chosen: String?, onPick: (String) -> Unit, onDismiss: () -> Unit) {
    OrbSheet(onDismiss = onDismiss, title = SchedulesTexts.FIELD_PROJECT) {
        for (p in projects) OrbSheetItem(p, onClick = { onPick(p) }, icon = OrbIcons.FolderGit2, checked = p == chosen)
    }
}

@Composable
private fun ChipsRow(content: @Composable () -> Unit) {
    Row(
        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 20.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically,
    ) { content() }
}

/** What the mockup's sheet leaves out, so nothing the PC can do with a schedule is lost on the phone. */
@Composable
private fun MoreOptions(f: ScheduleForm, d: ScheduleDraft, editing: ScheduleItem?, pcFields: Boolean, onChange: (ScheduleDraft) -> Unit) {
    val kinds = ScheduleKind.all.filter { it != ScheduleKind.MONTHLY || pcFields || ScheduleKind.of(editing?.every.orEmpty()) == ScheduleKind.MONTHLY }
    OrbSheetLabel(SchedulesTexts.FIELD_FREQUENCY)
    ChipsRow {
        for (k in kinds) OrbChip(ScheduleKind.label(k), d.kind == k && !d.foreignTiming, { onChange(d.copy(kind = k, foreignTiming = false)) })
    }
    // A frequency the app cannot draw stays as the PC has it until the person picks one of the above.
    if (d.foreignTiming) {
        Text(SchedulesTexts.FOREIGN_NOTE, Modifier.padding(horizontal = 20.dp, vertical = 8.dp), color = OrbKit.mutedForeground, fontSize = 13.sp, lineHeight = 18.sp)
    }

    val agents = f.agents.map { it.id to it.label }.let { list -> if (d.agent != "any" && list.none { it.first == d.agent }) list + (d.agent to SchedulesTexts.agentName(d.agent)) else list }
    if (agents.isNotEmpty()) {
        OrbSheetLabel(SchedulesTexts.FIELD_AGENT)
        ChipsRow {
            OrbChip(SchedulesTexts.ANY_AGENT, d.agent == "any", { onChange(d.copy(agent = "any", model = null)) })
            for ((id, label) in agents) OrbChip(label, d.agent == id, { onChange(d.copy(agent = id, model = null)) })
        }
        val models = f.agents.firstOrNull { it.id == d.agent }?.models.orEmpty().filter { it.id.isNotEmpty() }
        if (models.isNotEmpty()) {
            OrbSheetLabel(SchedulesTexts.FIELD_MODEL)
            ChipsRow {
                OrbChip(SchedulesTexts.DEFAULT_MODEL, d.model == null, { onChange(d.copy(model = null)) })
                for (m in models) OrbChip(m.label, d.model == m.id, { onChange(d.copy(model = m.id)) })
            }
        }
    }

    // The PC only lets its own window take «read only» or the permission question away, so a set one is shown locked.
    val readonlyLocked = editing?.readonly == true
    val askLocked = editing?.autonomy == "preguntar"
    Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp)) {
        OrbCard {
            OrbSettingRow(
                SchedulesTexts.FIELD_READONLY, subtitle = if (readonlyLocked) SchedulesTexts.FIELD_READONLY_LOCKED else SchedulesTexts.FIELD_READONLY_HINT, divider = false,
                trailing = { OrbSwitch(d.readonly, { onChange(d.copy(readonly = it)) }, label = SchedulesTexts.FIELD_READONLY, enabled = !readonlyLocked) },
            )
            OrbSettingRow(
                SchedulesTexts.FIELD_SAME_CHAT, subtitle = SchedulesTexts.FIELD_SAME_CHAT_HINT,
                trailing = { OrbSwitch(d.sameChat, { onChange(d.copy(sameChat = it)) }, label = SchedulesTexts.FIELD_SAME_CHAT) },
            )
            if (pcFields) {
                OrbSettingRow(
                    SchedulesTexts.FIELD_NOTIFY, subtitle = SchedulesTexts.FIELD_NOTIFY_HINT,
                    trailing = { OrbSwitch(d.notify, { onChange(d.copy(notify = it)) }, label = SchedulesTexts.FIELD_NOTIFY) },
                )
                OrbSettingRow(
                    SchedulesTexts.FIELD_ASK, subtitle = if (askLocked) SchedulesTexts.FIELD_ASK_LOCKED else SchedulesTexts.FIELD_ASK_HINT,
                    trailing = { OrbSwitch(d.askAlways, { onChange(d.copy(askAlways = it)) }, label = SchedulesTexts.FIELD_ASK, enabled = !askLocked) },
                )
            }
        }
    }
    if (pcFields) ZoneField(d, onChange)
    OrbNote(SchedulesTexts.NEW_NOTE, Modifier.padding(horizontal = 20.dp, vertical = 4.dp))
}

@Composable
private fun ZoneField(d: ScheduleDraft, onChange: (ScheduleDraft) -> Unit) {
    OrbSheetLabel(SchedulesTexts.FIELD_ZONE)
    Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        ScheduleField(d.tz, { onChange(d.copy(tz = it.trim().take(64))) }, SchedulesTexts.FIELD_ZONE, hint = SchedulesTexts.ZONE_HINT)
    }
    ChipsRow {
        val phone = TimeZone.getDefault().id
        OrbChip(SchedulesTexts.ZONE_PC, d.tz.isEmpty(), { onChange(d.copy(tz = "")) })
        OrbChip(SchedulesTexts.ZONE_PHONE, d.tz == phone, { onChange(d.copy(tz = phone)) })
    }
}

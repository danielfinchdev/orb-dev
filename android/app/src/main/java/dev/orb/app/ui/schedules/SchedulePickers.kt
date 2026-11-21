package dev.orb.app.ui.schedules

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.DatePicker
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.orb.app.ui.kit.OrbButton
import dev.orb.app.ui.kit.OrbButtonKind
import dev.orb.app.ui.kit.OrbDialog
import dev.orb.app.ui.kit.OrbDialogAction
import dev.orb.app.ui.kit.OrbSheet

/** Picks a time of day; [initial] is `HH:mm` and [onPick] gets `HH:mm`. The 24-hour clock matches what the PC stores. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScheduleTimeDialog(initial: String, onPick: (String) -> Unit, onDismiss: () -> Unit) {
    val (h, m) = ScheduleWhen.hourMinute(initial)
    val state = rememberTimePickerState(initialHour = h, initialMinute = m, is24Hour = true)
    OrbDialog(
        onDismiss = onDismiss, title = SchedulesTexts.PICK_TIME,
        confirm = OrbDialogAction(SchedulesTexts.PICK_OK, { onPick(ScheduleWhen.time(state.hour, state.minute)) }),
        dismiss = OrbDialogAction(SchedulesTexts.CANCEL, onDismiss),
    ) {
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) { TimePicker(state) }
    }
}

/**
 * Picks a day; [initial] is `YYYY-MM-DD` or empty and [onPick] gets `YYYY-MM-DD`. A sheet, not a dialog: the calendar is
 * 360 dp wide and a dialog leaves the phone less than that.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScheduleDateSheet(initial: String, onPick: (String) -> Unit, onDismiss: () -> Unit) {
    val state = rememberDatePickerState(initialSelectedDateMillis = ScheduleWhen.pickerFromDate(initial))
    OrbSheet(
        onDismiss = onDismiss, title = SchedulesTexts.PICK_DATE,
        footer = {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
                OrbButton(SchedulesTexts.CANCEL, onDismiss, kind = OrbButtonKind.Ghost)
                OrbButton(
                    SchedulesTexts.PICK_OK, { state.selectedDateMillis?.let { onPick(ScheduleWhen.dateFromPicker(it)) } },
                    kind = OrbButtonKind.Primary, enabled = state.selectedDateMillis != null,
                )
            }
        },
    ) { DatePicker(state, title = null, headline = null, showModeToggle = false) }
}

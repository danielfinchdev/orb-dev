package dev.orb.app.ui.schedules

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/** Picks a time of day; [initial] is `HH:mm` and [onPick] gets `HH:mm`. The 24-hour clock matches what the PC stores. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScheduleTimeDialog(initial: String, onPick: (String) -> Unit, onDismiss: () -> Unit) {
    val (h, m) = ScheduleWhen.hourMinute(initial)
    val state = rememberTimePickerState(initialHour = h, initialMinute = m, is24Hour = true)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(SchedulesTexts.PICK_TIME) },
        text = { Column(Modifier.fillMaxWidth()) { TimePicker(state) } },
        confirmButton = { TextButton(onClick = { onPick(ScheduleWhen.time(state.hour, state.minute)) }) { Text(SchedulesTexts.PICK_OK) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(SchedulesTexts.CANCEL) } },
    )
}

/** Picks a day; [initial] is `YYYY-MM-DD` or empty and [onPick] gets `YYYY-MM-DD`. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScheduleDateDialog(initial: String, onPick: (String) -> Unit, onDismiss: () -> Unit) {
    val state = rememberDatePickerState(initialSelectedDateMillis = ScheduleWhen.pickerFromDate(initial))
    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(
                onClick = { state.selectedDateMillis?.let { onPick(ScheduleWhen.dateFromPicker(it)) } },
                enabled = state.selectedDateMillis != null,
            ) { Text(SchedulesTexts.PICK_OK) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(SchedulesTexts.CANCEL) } },
    ) { DatePicker(state) }
}

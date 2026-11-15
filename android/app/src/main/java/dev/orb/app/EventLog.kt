package dev.orb.app

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * The last few lines of what the link did, for the connection-test screen. Only kinds, statuses and timings go in:
 * callers must never pass a body, a key, a nonce or a password.
 */
class EventLog(private val max: Int = 30, private val clock: () -> Long = System::currentTimeMillis) {
    private val _lines = MutableStateFlow<List<String>>(emptyList())
    val lines: StateFlow<List<String>> = _lines.asStateFlow()

    // SimpleDateFormat is not thread safe and lines come from several threads.
    private fun stamp(): String = synchronized(this) { SimpleDateFormat("HH:mm:ss", Locale.ROOT).format(Date(clock())) }

    fun add(line: String) {
        val entry = "${stamp()} $line"
        _lines.value = (_lines.value + entry).takeLast(max)
    }
}

package dev.orb.app.ui.thisphone

import dev.orb.app.link.net.PathStatus
import dev.orb.app.link.net.PcEntry
import org.junit.Assert.assertTrue
import org.junit.Test

class PathLinesTest {
    private val now = 1_700_000_000_000L

    @Test
    fun `the pcs account of a door is matched by kind, not by the spelling of its url`() {
        val paths = listOf(PathStatus("http://192.168.1.5:3131", now, now, null), PathStatus("https://orb.tail1234.ts.net", now, now, null))
        val entries = listOf(
            PcEntry("wifi", "http://192.168.1.5:3131/", false, null, "puerto ocupado"),
            PcEntry("tailscale", null, false, null, null),
        )
        val lines = ThisPhoneTexts.pathLines(paths, entries, now)
        assertTrue(lines[0].text, lines[0].text.contains("cerrada en el PC: puerto ocupado"))
        assertTrue(lines[1].text, lines[1].text.contains("cerrada en el PC"))
    }
}

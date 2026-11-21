package dev.orb.app.notify

import android.app.PendingIntent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PendingFlagsTest {
    @Test fun theNoticeButtonsKeepTheirReplyMutableOnEveryVersion() {
        val immutable = PendingIntent.FLAG_IMMUTABLE
        val mutable = PendingIntent.FLAG_MUTABLE
        // Android 12 and later: the reply says it is mutable; the other buttons say they are not.
        assertTrue(pendingFlags(true, 31) and mutable != 0)
        assertEquals(0, pendingFlags(true, 31) and immutable)
        assertTrue(pendingFlags(false, 34) and immutable != 0)
        // Android 11 and earlier: not being immutable is what lets Android fill in the typed text.
        assertEquals(0, pendingFlags(true, 30) and immutable)
        assertEquals(0, pendingFlags(true, 24) and immutable)
        assertTrue(pendingFlags(false, 24) and immutable != 0)
    }
}

package dev.orb.app

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ReadSavedSessionTest {
    @Test fun aBusyKeystoreIsRetriedBeforeGivingUp() = runTest {
        var calls = 0
        val s = readSavedSession(attempts = 3, pauseMs = 10) {
            calls++
            if (calls < 3) throw SecureStore.Busy(RuntimeException("busy")) else null
        }
        assertNull(s)
        assertEquals(3, calls)
    }

    @Test fun itStopsAfterTheLastAttempt() = runTest {
        var calls = 0
        val s = readSavedSession(attempts = 4, pauseMs = 10) { calls++; throw SecureStore.Busy(RuntimeException("busy")) }
        assertNull(s)
        assertEquals(4, calls)
    }

    @Test fun anAbsentLinkIsNotRetried() = runTest {
        var calls = 0
        assertNull(readSavedSession(attempts = 4, pauseMs = 10) { calls++; null })
        assertEquals(1, calls)
    }
}

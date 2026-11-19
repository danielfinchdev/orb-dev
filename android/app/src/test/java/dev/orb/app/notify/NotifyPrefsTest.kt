package dev.orb.app.notify

import dev.orb.app.ui.theme.MemoryStore
import org.junit.Assert.assertEquals
import org.junit.Test

class NotifyPrefsTest {
    private val store = MemoryStore()

    @Test fun theLockScreenStartsWithOnlyOrb() {
        assertEquals(LockScreenNotice.Generic, NotifyPrefs(store).settings.value.lockScreen)
    }

    @Test fun whoeverShowedTheTextKeepsTheFullNotice() {
        store.edit { putBoolean("lock.public", true) }
        assertEquals(LockScreenNotice.Full, NotifyPrefs(store).settings.value.lockScreen)
    }

    @Test fun whoeverHidItKeepsTheGenericNotice() {
        store.edit { putBoolean("lock.public", false) }
        assertEquals(LockScreenNotice.Generic, NotifyPrefs(store).settings.value.lockScreen)
    }

    @Test fun theChoiceSurvivesARestartAndBeatsTheOldFlag() {
        store.edit { putBoolean("lock.public", true) }
        NotifyPrefs(store).setLockScreen(LockScreenNotice.Hidden)
        assertEquals(LockScreenNotice.Hidden, NotifyPrefs(store).settings.value.lockScreen)
        NotifyPrefs(store).setLockScreen(LockScreenNotice.Generic)
        assertEquals(LockScreenNotice.Generic, NotifyPrefs(store).settings.value.lockScreen)
    }

    @Test fun anUnknownSavedValueFallsBackToTheOldFlag() {
        store.edit { putString("lock.screen", "weird"); putBoolean("lock.public", true) }
        assertEquals(LockScreenNotice.Full, NotifyPrefs(store).settings.value.lockScreen)
    }
}

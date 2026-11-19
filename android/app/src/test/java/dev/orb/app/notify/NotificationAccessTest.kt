package dev.orb.app.notify

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.provider.Settings
import androidx.test.core.app.ApplicationProvider
import dev.orb.app.ui.theme.MemoryStore
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NotificationAccessTest {
    private val app: Application = ApplicationProvider.getApplicationContext()
    private val context: Context = app
    private val nm = context.getSystemService(NotificationManager::class.java)
    private val prefs = NotifyPrefs(MemoryStore())
    private var clock = 0L
    private var dialogs = 0

    private fun access(sdk: Int) = AndroidNotificationAccess(context, prefs, sdk) { clock }.also { it.launchDialog = { dialogs++ } }

    private fun settingsOpened() = shadowOf(app).nextStartedActivity?.action

    private fun notificationsOff() = shadowOf(nm).setNotificationsEnabled(false)

    @Test fun beforeAndroid13ThereIsNoDialogToShowAndTheSettingsOpenInstead() {
        notificationsOff()
        val a = access(sdk = 32)
        assertFalse(a.status.value.allowed)
        assertFalse(a.status.value.canAsk)
        a.request()
        assertEquals(0, dialogs)
        assertEquals(Settings.ACTION_APP_NOTIFICATION_SETTINGS, settingsOpened())
        assertFalse(prefs.permissionAsked)
    }

    @Test fun onAndroid13TheDialogComesOnceAndLaterTapsOpenTheSettings() {
        notificationsOff()
        val a = access(sdk = 33)
        assertTrue(a.status.value.canAsk)
        a.request()
        assertEquals(1, dialogs)
        assertNull(settingsOpened())
        // The person refused after reading it: nothing else opens by itself, and the state says Android will not ask again.
        clock += 5_000_000_000L
        a.dialogResult(false)
        assertNull(settingsOpened())
        assertFalse(a.status.value.canAsk)
        a.request()
        assertEquals(1, dialogs)
        assertEquals(Settings.ACTION_APP_NOTIFICATION_SETTINGS, settingsOpened())
    }

    @Test fun aRefusalThatCameBackAtOnceOpensTheSettingsSoTheButtonLeadsSomewhere() {
        notificationsOff()
        val a = access(sdk = 33)
        a.request()
        clock += 20_000_000L
        a.dialogResult(false)
        assertEquals(Settings.ACTION_APP_NOTIFICATION_SETTINGS, settingsOpened())
    }

    @Test fun aGrantedAnswerOpensNothing() {
        notificationsOff()
        val a = access(sdk = 33)
        a.request()
        shadowOf(nm).setNotificationsEnabled(true)
        clock += 1_000_000_000L
        a.dialogResult(true)
        assertNull(settingsOpened())
        assertTrue(a.status.value.working)
        assertTrue(a.enabled.value)
    }

    @Test fun withTheNoticesAllowedRequestDoesNothing() {
        val a = access(sdk = 33)
        a.request()
        assertEquals(0, dialogs)
        assertNull(settingsOpened())
        assertFalse(prefs.permissionAsked)
    }

    @Test fun aChannelTurnedOffInAndroidIsReadAsOffAndOnlyForTheOnesThatMatter() {
        NotifyChannels.ensure(context)
        val a = access(sdk = 33)
        assertTrue(a.status.value.working)
        nm.createNotificationChannel(NotificationChannel(NoteChannel.Messages.id, "Mensajes", NotificationManager.IMPORTANCE_NONE))
        nm.createNotificationChannel(NotificationChannel(NoteChannel.Status.id, "Estado", NotificationManager.IMPORTANCE_NONE))
        a.refresh()
        assertTrue(a.status.value.allowed)
        assertFalse(a.status.value.working)
        assertEquals(listOf(NoteChannel.Messages), a.status.value.offChannels)
    }

    @Test fun theStatusIsReadFromAndroidEachTimeNotRemembered() {
        val a = access(sdk = 33)
        assertTrue(a.status.value.working)
        notificationsOff()
        a.refresh()
        assertFalse(a.status.value.allowed)
        shadowOf(nm).setNotificationsEnabled(true)
        a.refresh()
        assertTrue(a.status.value.working)
    }
}

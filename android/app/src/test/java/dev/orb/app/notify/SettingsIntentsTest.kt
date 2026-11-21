package dev.orb.app.notify

import android.provider.Settings
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class SettingsIntentsTest {
    @Test fun fromAndroid8TheNoticePageOfTheAppOpens() {
        val i = SettingsIntents.appNotices("dev.orb.app", sdk = 26)
        assertEquals(Settings.ACTION_APP_NOTIFICATION_SETTINGS, i.action)
        assertEquals("dev.orb.app", i.getStringExtra(Settings.EXTRA_APP_PACKAGE))
    }

    @Test fun onAndroid7TheAppsOwnPageOpensInstead() {
        val i = SettingsIntents.appNotices("dev.orb.app", sdk = 25)
        assertEquals(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, i.action)
        assertEquals("package:dev.orb.app", i.data.toString())
        assertNull(i.getStringExtra(Settings.EXTRA_APP_PACKAGE))
    }

    @Test fun aChannelPageNeedsAndroid8AndFallsBackToTheAppPage() {
        val new = SettingsIntents.channelNotices("dev.orb.app", "chats", sdk = 26)
        assertEquals(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS, new.action)
        assertEquals("chats", new.getStringExtra(Settings.EXTRA_CHANNEL_ID))
        assertEquals(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, SettingsIntents.channelNotices("dev.orb.app", "chats", sdk = 25).action)
    }
}

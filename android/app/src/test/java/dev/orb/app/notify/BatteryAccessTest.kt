package dev.orb.app.notify

import android.app.Application
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.content.pm.PackageManager
import android.os.PowerManager
import android.provider.Settings
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class BatteryAccessTest {
    private val app: Application = ApplicationProvider.getApplicationContext()

    @Test fun orbIsRestrictedUntilAndroidIsToldToLeaveItAlone() {
        val access = AndroidBatteryAccess(app)
        val power = shadowOf(app.getSystemService(PowerManager::class.java))
        assertTrue(access.restricted())
        power.setIgnoringBatteryOptimizations(app.packageName, true)
        assertFalse(access.restricted())
        power.setIgnoringBatteryOptimizations(app.packageName, false)
        assertTrue(access.restricted())
    }

    @Test fun theBatteryListOfAndroidOpensWithoutAskingForAnyPermission() {
        AndroidBatteryAccess(app).openSettings()
        assertEquals(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS, shadowOf(app).nextStartedActivity.action)
        val requested = app.packageManager.getPackageInfo(app.packageName, PackageManager.GET_PERMISSIONS).requestedPermissions.orEmpty()
        assertFalse("android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" in requested)
    }

    @Test fun aPhoneWithoutThatPageOpensTheSettingsOfTheApp() {
        val started = ArrayList<Intent>()
        val context = object : ContextWrapper(app) {
            override fun getApplicationContext(): Context = this
            override fun startActivity(intent: Intent) {
                if (intent.action == Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS) throw ActivityNotFoundException()
                started += intent
            }
        }
        AndroidBatteryAccess(context).openSettings()
        assertEquals(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, started.single().action)
        assertEquals("package:${app.packageName}", started.single().dataString)
    }

    @Test fun withNoSettingsScreenAtAllNothingCrashes() {
        val context = object : ContextWrapper(app) {
            override fun startActivity(intent: Intent) = throw ActivityNotFoundException()
        }
        AndroidBatteryAccess(context).openSettings()
    }
}

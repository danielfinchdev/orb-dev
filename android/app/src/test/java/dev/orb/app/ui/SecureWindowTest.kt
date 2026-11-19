package dev.orb.app.ui

import android.app.Activity
import android.view.WindowManager
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class SecureWindowTest {
    private val window = Robolectric.buildActivity(Activity::class.java).setup().get().window
    private fun secure() = window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0

    @Test fun theFlagFollowsTheUnionOfTheReasons() {
        assertFalse(secure())
        SecureWindow.hold(window, "master-password")
        assertTrue(secure())
        SecureWindow.hold(window, "app-lock")
        SecureWindow.release(window, "master-password")
        assertTrue(secure())
        SecureWindow.release(window, "app-lock")
        assertFalse(secure())
    }
}

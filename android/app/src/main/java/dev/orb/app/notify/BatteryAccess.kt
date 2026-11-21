package dev.orb.app.notify

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings

/**
 * Android's battery optimization as it concerns Orb: whether it may close or delay the app to save battery, and the way to the
 * system page where the person changes that. Orb never asks for the permission that would let it switch this off by itself.
 */
interface BatteryAccess {
    /** True while Android may limit Orb in the background (the default); false once the person left it unrestricted. */
    fun restricted(): Boolean

    /** The system's list of battery optimizations; the app's own settings page when this phone has no such list. */
    fun openSettings()
}

class AndroidBatteryAccess(private val context: Context) : BatteryAccess {
    override fun restricted(): Boolean {
        val power = context.getSystemService(PowerManager::class.java) ?: return false
        return !power.isIgnoringBatteryOptimizations(context.packageName)
    }

    override fun openSettings() {
        val list = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        // Starting it needs no package visibility: a phone without the page throws and the app's own page opens instead.
        try {
            context.startActivity(list)
        } catch (e: Exception) {
            val app = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            try { context.startActivity(app) } catch (e2: Exception) { /* no settings screen to show */ }
        }
    }
}

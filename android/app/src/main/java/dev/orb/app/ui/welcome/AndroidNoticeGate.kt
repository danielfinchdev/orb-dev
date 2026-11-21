package dev.orb.app.ui.welcome

import android.os.Build
import dev.orb.app.notify.NotificationAccess

/** The first-run flow's view of Android's notification permission: there is only a permission to ask for from Android 13. */
class AndroidNoticeGate(private val access: NotificationAccess, private val sdk: Int = Build.VERSION.SDK_INT) : NoticeGate {
    override fun shouldAsk(): Boolean {
        access.refresh()
        return sdk >= 33 && !access.enabled.value
    }

    override val enabled: Boolean get() = access.enabled.value
    override fun request() = access.request()
}

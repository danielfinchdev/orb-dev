package dev.orb.app.ui.welcome

import dev.orb.app.lock.AppLock
import dev.orb.app.lock.AuthCapability
import dev.orb.app.lock.AuthResult

/** The first-run offer to lock the app, backed by the app's real lock. */
class AndroidLockOffer(private val lock: AppLock) : LockOffer {
    override fun available() = lock.capability() == AuthCapability.Ready
    override val enabled: Boolean get() = lock.settings.value.enabled
    override fun enable(onDone: (Boolean) -> Unit) = lock.enable { onDone(it == AuthResult.Success) }
}

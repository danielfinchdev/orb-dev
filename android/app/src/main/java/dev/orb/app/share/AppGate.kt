package dev.orb.app.share

/**
 * Whether the app may show its content right now. Shared content waits while this says no; the app lock (fingerprint,
 * face or PIN) plugs in here and today nothing locks the app.
 */
fun interface AppGate {
    fun isOpen(): Boolean

    companion object {
        val AlwaysOpen = AppGate { true }
    }
}

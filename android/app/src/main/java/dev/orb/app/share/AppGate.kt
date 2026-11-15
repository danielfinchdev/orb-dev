package dev.orb.app.share

/**
 * Whether the app may show its content right now. Shared content waits while this says no; the app lock (fingerprint,
 * face or PIN) is the gate that closes it.
 */
fun interface AppGate {
    fun isOpen(): Boolean

    companion object {
        val AlwaysOpen = AppGate { true }
    }
}

package dev.orb.app.ui.thisphone

import dev.orb.app.link.payload.WhatwgUrl
import dev.orb.app.link.payload.isPrivateHost

/** Which way the phone reaches the PC, told from the address the link uses. */
enum class RouteKind(val label: String) {
    Tailscale("Tailscale"), Lan("Red local"), Internet("Internet");

    companion object {
        private val CGNAT = Regex("""^100\.(\d{1,3})\.\d{1,3}\.\d{1,3}$""")

        /** Null when [base] is not an address at all. */
        fun of(base: String?): RouteKind? {
            val host = WhatwgUrl.parseHttp(base ?: return null)?.hostname?.lowercase()?.removeSurrounding("[", "]") ?: return null
            return when {
                isTailscale(host) -> Tailscale
                isPrivateHost(host) -> Lan
                else -> Internet
            }
        }

        private fun isTailscale(h: String): Boolean {
            if (h.endsWith(".ts.net") || h.startsWith("fd7a:115c:a1e0:")) return true
            // Tailscale's own range, 100.64.0.0/10.
            CGNAT.find(h)?.groupValues?.get(1)?.toIntOrNull()?.let { if (it in 64..127) return true }
            // A MagicDNS short name («home-server»): a dot-less name that is not a number nor this device.
            return h.isNotEmpty() && h != "localhost" && h.all { it in 'a'..'z' || it in '0'..'9' || it == '-' } && !h.all { it in '0'..'9' }
        }
    }
}

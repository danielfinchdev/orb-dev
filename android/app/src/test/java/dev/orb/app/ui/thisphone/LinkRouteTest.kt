package dev.orb.app.ui.thisphone

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LinkRouteTest {
    private fun kind(base: String) = RouteKind.of(base)

    @Test fun tailscaleRangeAndNamesAreTailscale() {
        assertEquals(RouteKind.Tailscale, kind("http://100.64.0.1:4310"))
        assertEquals(RouteKind.Tailscale, kind("http://100.101.102.103:4310"))
        assertEquals(RouteKind.Tailscale, kind("http://100.127.255.254"))
        assertEquals(RouteKind.Tailscale, kind("https://dan-laptop.tail1234.ts.net"))
        assertEquals(RouteKind.Tailscale, kind("http://[fd7a:115c:a1e0::1]:4310"))
        // a MagicDNS short name
        assertEquals(RouteKind.Tailscale, kind("http://home-server:4310"))
    }

    @Test fun otherPrivateAddressesAreTheLocalNetwork() {
        assertEquals(RouteKind.Lan, kind("http://192.168.1.20:4310"))
        assertEquals(RouteKind.Lan, kind("http://10.0.0.5:4310"))
        assertEquals(RouteKind.Lan, kind("http://172.16.4.2:4310"))
        assertEquals(RouteKind.Lan, kind("http://dan-pc.local:4310"))
    }

    @Test fun justOutsideTheTailscaleRangeIsNotPrivateAtAll() {
        assertEquals(RouteKind.Internet, kind("http://100.63.255.255"))
        assertEquals(RouteKind.Internet, kind("http://100.128.0.1"))
    }

    @Test fun aPublicAddressIsInternet() {
        assertEquals(RouteKind.Internet, kind("https://orb.example.com"))
    }

    @Test fun nonsenseIsNothing() {
        assertNull(RouteKind.of(null))
        assertNull(RouteKind.of("no address"))
    }

    @Test fun theLabelsAreTheMockupsWords() {
        assertEquals(listOf("Tailscale", "Red local", "Internet"), RouteKind.entries.map { it.label })
    }
}

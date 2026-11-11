package dev.orb.app.ui

import dev.orb.app.link.net.LinkSession
import dev.orb.app.link.net.PairError
import dev.orb.app.link.net.PairOk
import dev.orb.app.link.net.PairingException
import dev.orb.app.link.net.ResolvedLink
import dev.orb.app.link.payload.LinkPayload
import dev.orb.app.link.payload.LinkVia
import dev.orb.app.ui.welcome.WelcomeViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class WelcomeViewModelTest {
    private val dispatcher = UnconfinedTestDispatcher()

    @Before fun setUp() = Dispatchers.setMain(dispatcher)
    @After fun tearDown() = Dispatchers.resetMain()

    private class FakeLinker(var linkResult: Result<PairOk>) : Linker {
        var linkCalls = 0
        var lastPassword: String? = null
        override suspend fun resolve(payload: LinkPayload): Result<ResolvedLink> =
            Result.success(ResolvedLink(payload.urls, payload.code, "pc", ByteArray(32), "fp", null, LinkVia.CODE))

        override suspend fun link(link: ResolvedLink, password: String, deviceName: String): Result<PairOk> {
            linkCalls++
            lastPassword = password
            return linkResult
        }
    }

    private fun ok() = PairOk(LinkSession("id", ByteArray(32), ByteArray(32), listOf("http://192.168.1.20:3131")), null, 0)
    private fun vm(linker: Linker, onLinked: (PairOk) -> Unit = {}) = WelcomeViewModel(linker, "Test", onLinked, dispatcher)

    private fun WelcomeViewModel.fill(password: String = "secreto") {
        setCode("ABCDEF")
        setAddress("http://192.168.1.20:3131")
        setPassword(password)
    }

    @Test fun missingCodeIsExplainedAndNothingIsSent() {
        val linker = FakeLinker(Result.success(ok()))
        val vm = vm(linker)
        vm.setPassword("secreto")
        vm.submit()
        assertTrue(vm.state.value.error!!.contains("código"))
        assertEquals(0, linker.linkCalls)
    }

    @Test fun missingPasswordIsExplained() {
        val linker = FakeLinker(Result.success(ok()))
        val vm = vm(linker)
        vm.fill(password = "")
        vm.submit()
        assertTrue(vm.state.value.error!!.contains("contraseña"))
        assertEquals(0, linker.linkCalls)
    }

    @Test fun wrongPasswordShowsAttemptsLeftAndClearsThePassword() {
        val linker = FakeLinker(Result.failure(PairingException(PairError.Refused(403, "x", "password", 2, null))))
        val vm = vm(linker)
        vm.fill()
        vm.submit()
        val s = vm.state.value
        assertTrue(s.error!!.contains("2 intentos"))
        assertEquals("", s.password)
        assertFalse(s.busy)
        assertFalse(s.linked)
    }

    @Test fun typedErrorsAreMappedToPlainSpanish() {
        assertTrue(pairErrorText(PairError.Offline(false)).contains("No se pudo llegar"))
        assertTrue(pairErrorText(PairError.KdfTooHeavy).contains("memoria"))
        assertTrue(pairErrorText(PairError.Refused(426, "x", null, null, "pair")).contains("actualizar"))
        assertTrue(pairErrorText(PairError.Refused(403, "x", "newCode", null, null)).contains("código"))
        assertTrue(pairErrorText(PairError.BadAnswer).contains("No se ha enlazado"))
    }

    @Test fun successSavesTheLinkAndMarksLinked() {
        val linker = FakeLinker(Result.success(ok()))
        var saved: PairOk? = null
        val vm = vm(linker) { saved = it }
        vm.fill()
        vm.submit()
        assertNotNull(saved)
        assertEquals("secreto", linker.lastPassword)
        val s = vm.state.value
        assertTrue(s.linked)
        assertNull(s.error)
        assertEquals("", s.password)
    }
}

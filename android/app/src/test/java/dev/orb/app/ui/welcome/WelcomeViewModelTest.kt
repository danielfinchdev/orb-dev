package dev.orb.app.ui.welcome

import dev.orb.app.link.net.LinkSession
import dev.orb.app.link.net.PairError
import dev.orb.app.link.net.PairOk
import dev.orb.app.link.net.PairingException
import dev.orb.app.link.net.ResolvedLink
import dev.orb.app.link.payload.LinkPayload
import dev.orb.app.link.payload.LinkVia
import dev.orb.app.ui.Linker
import dev.orb.app.ui.pairErrorText
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

    private class FakeLinker(
        var linkResult: Result<PairOk>,
        var resolveResult: (LinkPayload) -> Result<ResolvedLink> = { p ->
            Result.success(ResolvedLink(p.urls, p.code, "pc", ByteArray(32), "8f3a-c21d-77e0", "DanLaptop", p.via))
        },
    ) : Linker {
        var resolveCalls = 0
        var holdResolve: kotlinx.coroutines.CompletableDeferred<Unit>? = null
        var linkCalls = 0
        var lastPassword: String? = null
        var lastLink: ResolvedLink? = null
        // When set, link() waits for it, so a second tap can arrive while the first is in flight.
        var hold: kotlinx.coroutines.CompletableDeferred<Unit>? = null
        override suspend fun resolve(payload: LinkPayload): Result<ResolvedLink> {
            resolveCalls++
            holdResolve?.await()
            return resolveResult(payload)
        }

        override suspend fun link(link: ResolvedLink, password: String, deviceName: String): Result<PairOk> {
            linkCalls++
            lastPassword = password
            lastLink = link
            hold?.await()
            return linkResult
        }
    }

    private class FakeNotices(var ask: Boolean = true, override var enabled: Boolean = false, var failing: Boolean = false) : NoticeGate {
        var requests = 0
        override fun shouldAsk(): Boolean = if (failing) error("no permission service") else ask
        override fun request() { requests++ }
    }

    private fun ok() = PairOk(LinkSession("id", ByteArray(32), ByteArray(32), listOf("http://192.168.1.20:3131")), null, 0)
    private fun vm(linker: Linker, notices: NoticeGate? = null, onLinked: (PairOk) -> Unit = {}) =
        WelcomeViewModel(linker, "Test", onLinked, dispatcher, notices)

    private fun WelcomeViewModel.fillCode() {
        setCode("ABCDEF")
        setAddress("http://192.168.1.20:3131")
    }

    private fun refused(reason: String?, left: Int? = null, status: Int = 403) = Result.failure<PairOk>(PairingException(PairError.Refused(status, "x", reason, left, null)))

    @Test fun aScannedLinkTakesTheRoadOfAPastedOneAndAsksThePcOnce() {
        val linker = FakeLinker(Result.success(ok()))
        val vm = vm(linker)
        vm.scanned("http://192.168.1.20:3131/#vincular=ABCDEF&pc=" + "A".repeat(43) + "&v=4")
        assertEquals(1, linker.resolveCalls)
        assertEquals(WelcomeStage.Fingerprint, vm.state.value.stage)
        assertFalse(vm.state.value.sheet)
        assertEquals("DanLaptop", vm.state.value.pc!!.name)
        assertFalse(vm.state.value.pc!!.viaCode)
    }

    @Test fun missingCodeIsExplainedAndNothingIsAsked() {
        val linker = FakeLinker(Result.success(ok()))
        val vm = vm(linker)
        vm.resolve()
        assertTrue(vm.state.value.error!!.contains("código"))
        assertEquals(0, linker.resolveCalls)
        assertEquals(WelcomeStage.Entry, vm.state.value.stage)
    }

    @Test fun publicAddressesAreStillRefusedBeforeAskingAnyone() {
        val linker = FakeLinker(Result.success(ok()))
        val vm = vm(linker)
        vm.setCode("ABCDEF")
        vm.setAddress("http://8.8.8.8:3131")
        vm.resolve()
        assertTrue(vm.state.value.error!!.contains("no es privada"))
        assertEquals(WelcomeErrorKind.NotPrivate, vm.state.value.errorKind)
        assertEquals(0, linker.resolveCalls)
    }

    @Test fun resolvingShowsTheNameAndTheFingerprintInThreeGroupsAndDoesNotLink() {
        val linker = FakeLinker(Result.success(ok()))
        val vm = vm(linker)
        vm.fillCode()
        vm.resolve()
        val s = vm.state.value
        assertEquals(WelcomeStage.Fingerprint, s.stage)
        assertEquals("DanLaptop", s.pc!!.name)
        assertEquals(listOf("8f3a", "c21d", "77e0"), s.pc!!.groups)
        assertTrue(s.pc!!.viaCode)
        assertEquals(1, linker.resolveCalls)
        assertEquals(0, linker.linkCalls)
    }

    @Test fun resolveErrorsStayOnTheWelcomeInThePlainWords() {
        val linker = FakeLinker(Result.success(ok()), { Result.failure(PairingException(PairError.Offline(true))) })
        val vm = vm(linker)
        vm.fillCode()
        vm.resolve()
        val s = vm.state.value
        assertTrue(s.error!!.contains("No se pudo llegar"))
        assertEquals(WelcomeStage.Entry, s.stage)
        assertFalse(s.busy)
        assertEquals(0, linker.linkCalls)
    }

    @Test fun fingerprintGroupsKeepTheFormatTheCryptoGives() {
        assertEquals(listOf("8f3a", "c21d", "77e0"), fingerprintGroups("8f3a-c21d-77e0"))
        assertEquals(3, fingerprintGroups(dev.orb.app.link.crypto.LinkCrypto.fingerprint(ByteArray(32) { it.toByte() })).size)
        assertEquals(emptyList<String>(), fingerprintGroups(""))
    }

    @Test fun missingPasswordIsExplainedAndNothingIsLinked() {
        val linker = FakeLinker(Result.success(ok()))
        val vm = vm(linker)
        vm.fillCode()
        vm.resolve()
        vm.confirm()
        assertTrue(vm.state.value.passwordError!!.contains("contraseña"))
        assertEquals(0, linker.linkCalls)
    }

    @Test fun confirmBeforeTheFingerprintWasShownDoesNothing() {
        val linker = FakeLinker(Result.success(ok()))
        val vm = vm(linker)
        vm.setPassword("secreto")
        vm.confirm()
        assertEquals(0, linker.linkCalls)
    }

    @Test fun wrongPasswordShowsAttemptsLeftUnderTheFieldAndClearsThePassword() {
        val linker = FakeLinker(refused("password", 2))
        val vm = vm(linker)
        vm.fillCode()
        vm.resolve()
        vm.setPassword("secreto")
        vm.confirm()
        val s = vm.state.value
        assertEquals("No es la contraseña. Te quedan 2 intentos con este código.", s.passwordError)
        assertNull(s.error)
        assertEquals("", s.password)
        assertFalse(s.checking)
        assertEquals(WelcomeStage.Fingerprint, s.stage)
    }

    @Test fun otherRefusalsAreNotShownAsWrongPassword() {
        val linker = FakeLinker(refused("newCode"))
        val vm = vm(linker)
        vm.fillCode()
        vm.resolve()
        vm.setPassword("secreto")
        vm.confirm()
        assertNull(vm.state.value.passwordError)
        assertTrue(vm.state.value.error!!.contains("código"))
    }

    @Test fun theFingerprintShownIsTheOneOfTheLinkThatIsConfirmed() {
        val linker = FakeLinker(Result.success(ok()))
        val vm = vm(linker)
        vm.fillCode(); vm.resolve(); vm.setPassword("x")
        val shown = vm.state.value.pc!!.groups.joinToString("-")
        vm.confirm()
        assertEquals(shown, linker.lastLink!!.fp)
    }

    @Test fun twoTapsOnConfirmLinkOnlyOnce() {
        val linker = FakeLinker(Result.success(ok())).also { it.hold = kotlinx.coroutines.CompletableDeferred() }
        val vm = vm(linker)
        vm.fillCode(); vm.resolve(); vm.setPassword("x")
        vm.confirm()
        vm.confirm()
        assertEquals(1, linker.linkCalls)
        assertTrue(vm.state.value.checking)
        linker.hold!!.complete(Unit)
        assertEquals(WelcomeStage.Done, vm.state.value.stage)
        assertEquals(1, linker.linkCalls)
    }

    @Test fun savingTheLinkFailingAfterThePcAcceptedNeverGoesBackToTheFingerprint() {
        val linker = FakeLinker(Result.success(ok()))
        val vm = vm(linker) { error("disk full") }
        vm.fillCode(); vm.resolve(); vm.setPassword("x")
        vm.confirm()
        val s = vm.state.value
        assertEquals(WelcomeStage.Entry, s.stage)
        assertTrue(s.error!!.contains("aceptó el enlace"))
        assertFalse(s.checking)
        assertNull(s.pc)
        // The spent code is gone and there is nothing left to confirm.
        assertEquals("", s.code)
        vm.confirm()
        assertEquals(1, linker.linkCalls)
    }

    @Test fun theNoticeQuestionFailingStillEndsInDone() {
        val vm = vm(FakeLinker(Result.success(ok())), FakeNotices(failing = true))
        vm.fillCode(); vm.resolve(); vm.setPassword("x"); vm.confirm()
        assertEquals(WelcomeStage.Done, vm.state.value.stage)
        assertFalse(vm.state.value.noticeDialog)
        assertFalse(vm.state.value.checking)
    }

    @Test fun aCodeThatCannotWorkAgainSendsThePersonBackToTheStartWithABanner() {
        val cases = listOf(refused(null, status = 401), refused("newCode"), refused("password", 0))
        for (case in cases) {
            val vm = vm(FakeLinker(case))
            vm.fillCode(); vm.resolve(); vm.setPassword("secreto"); vm.confirm()
            val s = vm.state.value
            assertEquals(WelcomeStage.Entry, s.stage)
            assertEquals(WelcomeErrorKind.CodeSpent, s.errorKind)
            assertNull(s.pc)
            assertNull(s.passwordError)
            assertFalse(s.checking)
            assertEquals("", s.code)
            assertFalse(s.error!!.contains("0 intentos"))
            vm.dismissError()
            assertNull(vm.state.value.error)
            assertNull(vm.state.value.errorKind)
        }
    }

    @Test fun theMasterPasswordLockKeepsThePersonOnTheFingerprintWithTheCode() {
        val vm = vm(FakeLinker(refused("tries", status = 503)))
        vm.fillCode(); vm.resolve(); vm.setPassword("secreto"); vm.confirm()
        val s = vm.state.value
        assertEquals(WelcomeStage.Fingerprint, s.stage)
        assertNull(s.errorKind)
        assertTrue(s.error!!.contains("Espera un rato"))
        assertEquals("ABCDEF", s.code)
        assertNotNull(s.pc)
    }

    @Test fun generalAnswersAreNeverShownAsAnExpiredCode() {
        val cases = listOf(
            refused(null, status = 404), refused(null, status = 410), refused(null, status = 429), refused("wait", status = 429),
            refused("noMaster"), refused(null, status = 426),
        )
        for (case in cases) {
            val vm = vm(FakeLinker(case))
            vm.fillCode(); vm.resolve(); vm.setPassword("secreto"); vm.confirm()
            val s = vm.state.value
            assertEquals(WelcomeStage.Fingerprint, s.stage)
            assertNull(s.errorKind)
            assertFalse(s.error!!.contains("caducado"))
        }
    }

    @Test fun anAddressThatIsNotAnOrbWhileAskingStaysInTheSheet() {
        val vm = vm(FakeLinker(Result.success(ok()), { Result.failure(PairingException(PairError.Refused(404, "x", null, null, null))) }))
        vm.openSheet(); vm.fillCode(); vm.resolve()
        val s = vm.state.value
        assertNull(s.errorKind)
        assertTrue(s.sheet)
        assertFalse(s.error!!.contains("caducado"))
    }

    @Test fun otherResolveErrorsStayInTheSheetAsPlainText() {
        val vm = vm(FakeLinker(Result.success(ok()), { Result.failure(PairingException(PairError.Offline(true))) }))
        vm.openSheet()
        vm.fillCode()
        vm.resolve()
        assertTrue(vm.state.value.sheet)
        assertNull(vm.state.value.errorKind)
    }

    @Test fun theSheetCannotBeClosedWhileThePcIsBeingAsked() {
        val linker = FakeLinker(Result.success(ok())).also { it.holdResolve = kotlinx.coroutines.CompletableDeferred() }
        val vm = vm(linker)
        vm.openSheet()
        vm.fillCode()
        vm.resolve()
        vm.closeSheet()
        assertTrue(vm.state.value.sheet)
        assertTrue(vm.state.value.busy)
        linker.holdResolve!!.complete(Unit)
        assertEquals(WelcomeStage.Fingerprint, vm.state.value.stage)
    }


    @Test fun aLinkScannedTwiceWhileThePcIsBeingAskedAsksOnce() {
        val linker = FakeLinker(Result.success(ok())).also { it.holdResolve = kotlinx.coroutines.CompletableDeferred() }
        val vm = vm(linker)
        val text = "http://192.168.1.20:3131/#vincular=ABCDEF&pc=" + "A".repeat(43) + "&v=4"
        vm.scanned(text)
        vm.scanned(text)
        linker.holdResolve!!.complete(Unit)
        assertEquals(1, linker.resolveCalls)
    }

    @Test fun protocolAnswersAreWordedForWhatTheyReallyMean() {
        assertTrue(pairErrorText(PairError.Refused(401, "x", null, null, null)).contains("ya no vale"))
        assertTrue(pairErrorText(PairError.Refused(503, "x", "tries", null, null)).contains("Espera un rato"))
        assertTrue(pairErrorText(PairError.Refused(429, "x", null, null, null)).contains("Demasiados intentos"))
        assertFalse(pairErrorText(PairError.Refused(404, "x", null, null, null)).contains("caducado"))
    }

    @Test fun lastAttemptIsSingular() {
        assertEquals(
            "No es la contraseña. Te quedan 1 intento con este código.",
            pairErrorText(PairError.Refused(403, "x", "password", 1, null)),
        )
    }

    @Test fun successLinksOnlyAfterTheFingerprintAndForgetsThePassword() {
        val linker = FakeLinker(Result.success(ok()))
        var saved: PairOk? = null
        val vm = vm(linker) { saved = it }
        vm.fillCode()
        vm.resolve()
        assertEquals(0, linker.linkCalls)
        vm.setPassword("secreto")
        vm.confirm()
        assertNotNull(saved)
        assertEquals("secreto", linker.lastPassword)
        val s = vm.state.value
        assertEquals(WelcomeStage.Done, s.stage)
        assertEquals(3, s.stepsDone)
        assertEquals("", s.password)
        assertEquals(0, s.passwordLength)
        assertNull(s.error)
    }

    @Test fun backForgetsWhatThePcAnsweredAndThePassword() {
        val linker = FakeLinker(Result.success(ok()))
        val vm = vm(linker)
        vm.fillCode()
        vm.resolve()
        vm.setPassword("secreto")
        vm.back()
        val s = vm.state.value
        assertEquals(WelcomeStage.Entry, s.stage)
        assertNull(s.pc)
        assertEquals("", s.password)
        // The fields typed on the welcome are kept, so a typo can be fixed.
        assertEquals("ABCDEF", s.code)
        vm.confirm()
        assertEquals(0, linker.linkCalls)
    }

    @Test fun pasteFillsTheLinkAndIgnoresAnEmptyClipboard() {
        val vm = vm(FakeLinker(Result.success(ok())))
        vm.paste("  orb://enlazar?x=1 ")
        assertEquals("orb://enlazar?x=1", vm.state.value.link)
        vm.paste(null)
        vm.paste("   ")
        assertEquals("orb://enlazar?x=1", vm.state.value.link)
    }

    @Test fun noticeDialogIsOfferedOnceLinkedWhenAndroidWouldAsk() {
        val notices = FakeNotices()
        val vm = vm(FakeLinker(Result.success(ok())), notices)
        vm.fillCode(); vm.resolve(); vm.setPassword("x"); vm.confirm()
        assertTrue(vm.state.value.noticeDialog)
        assertEquals(0, notices.requests)
    }

    @Test fun notNowDoesNotAskAndroidAndLeavesThePointerToThisPhone() {
        val notices = FakeNotices()
        val vm = vm(FakeLinker(Result.success(ok())), notices)
        vm.fillCode(); vm.resolve(); vm.setPassword("x"); vm.confirm()
        vm.declineNotices()
        val s = vm.state.value
        assertEquals(0, notices.requests)
        assertFalse(s.noticeDialog)
        assertTrue(s.noticesLater)
    }

    @Test fun activateAsksAndroidOnce() {
        val notices = FakeNotices()
        val vm = vm(FakeLinker(Result.success(ok())), notices)
        vm.fillCode(); vm.resolve(); vm.setPassword("x"); vm.confirm()
        vm.activateNotices()
        assertEquals(1, notices.requests)
        assertFalse(vm.state.value.noticeDialog)
        assertFalse(vm.state.value.noticesLater)
        vm.noticesChanged(true)
        assertTrue(vm.state.value.noticesOn)
    }

    @Test fun noDialogWhenThereIsNothingToAskAndroid() {
        val notices = FakeNotices(ask = false)
        val vm = vm(FakeLinker(Result.success(ok())), notices)
        vm.fillCode(); vm.resolve(); vm.setPassword("x"); vm.confirm()
        assertFalse(vm.state.value.noticeDialog)
        assertEquals(0, notices.requests)
    }

    @Test fun beforeAndroid13ThereIsNoPermissionToAsk() {
        val access = object : dev.orb.app.notify.NotificationAccess {
            override val enabled = kotlinx.coroutines.flow.MutableStateFlow(false)
            override val status = kotlinx.coroutines.flow.MutableStateFlow(dev.orb.app.notify.NoticeStatus.On)
            override fun refresh() {}
            override fun request() {}
            override fun dialogResult(granted: Boolean) {}
        }
        assertFalse(AndroidNoticeGate(access, sdk = 32).shouldAsk())
        assertTrue(AndroidNoticeGate(access, sdk = 33).shouldAsk())
        access.enabled.value = true
        assertFalse(AndroidNoticeGate(access, sdk = 34).shouldAsk())
    }

    @Test fun typedErrorsAreMappedToPlainSpanish() {
        assertTrue(pairErrorText(PairError.Offline(false)).contains("No se pudo llegar"))
        assertTrue(pairErrorText(PairError.KdfTooHeavy).contains("memoria"))
        assertTrue(pairErrorText(PairError.Refused(426, "x", null, null, "pair")).contains("actualizar"))
        assertTrue(pairErrorText(PairError.Refused(403, "x", "newCode", null, null)).contains("código"))
        assertTrue(pairErrorText(PairError.BadAnswer).contains("No se ha enlazado"))
    }
}

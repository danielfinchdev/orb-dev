package dev.orb.app.ui.update

import android.content.ActivityNotFoundException
import android.content.Intent
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.PcVersions
import dev.orb.app.link.payload.PROTOCOL
import dev.orb.app.ui.ChatRoute
import dev.orb.app.ui.UpdateRoute
import dev.orb.app.ui.noticeRoute
import dev.orb.app.ui.notes.NoticeTarget
import dev.orb.app.ui.offline.OfflineInfo
import dev.orb.app.ui.theme.OrbPaletteChoice
import dev.orb.app.ui.theme.OrbTheme
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.io.File

class UpdateViewTest {
    private val online = ConnectionState.Online("b", "PC", PcVersions(4, 2, "3.8.8"))

    @Test fun anAppTooOldNamesTheRealLinksAndVersions() {
        val v = updateView(ConnectionState.UpdateApp, PcVersions(PROTOCOL + 1, PROTOCOL + 1, "3.9.0"), "3.8.8") as UpdateView.App
        assertEquals("Tu Orb (3.9.0) habla una versión más nueva del enlace. Esta app es la 3.8.8.", UpdateTexts.bodyApp(v))
        assertEquals("3.8.8 · enlace $PROTOCOL", UpdateTexts.phone(v.appVersion))
        assertEquals("enlace ${PROTOCOL + 1} o más", UpdateTexts.asks(v))
    }

    @Test fun withoutWhatThePcSaidItDoesNotInventNumbers() {
        val v = updateView(ConnectionState.UpdateApp, null, "3.8.8") as UpdateView.App
        assertEquals("Tu Orb habla una versión más nueva del enlace. Esta app es la 3.8.8.", UpdateTexts.bodyApp(v))
        assertEquals("un enlace más nuevo", UpdateTexts.asks(v))
        // A minimum this app already meets is not what asked for the update.
        assertNull((updateView(ConnectionState.UpdateApp, PcVersions(PROTOCOL, PROTOCOL, null), "3.8.8") as UpdateView.App).pcMin)
    }

    @Test fun anOldPcSaysWhatItSpeaksOnlyWhenItSaid() {
        val known = updateView(ConnectionState.UpdatePc, PcVersions(3, 2, "3.6.1"), "3.8.8") as UpdateView.Pc
        assertEquals("3.6.1 · enlace 3", UpdateTexts.pcOld(known))
        val unknown = updateView(ConnectionState.UpdatePc, null, "3.8.8") as UpdateView.Pc
        assertEquals("anterior a la 3.8", UpdateTexts.pcOld(unknown))
        assertEquals("Tu Orb es anterior a la 3.8 y esta app no puede hablar con él.", UpdateTexts.bodyPc())
    }

    @Test fun aWorkingLinkHasNothingToUpdateAndAnUnknownOneSaysSo() {
        val ok = updateView(online, null, "3.8.8")
        assertTrue(ok is UpdateView.UpToDate)
        assertEquals("3.8.8 · enlace 4", UpdateTexts.pcNow(4, "3.8.8"))
        assertEquals("sin respuesta del PC", UpdateTexts.pcNow(null, null))
        for (c in listOf(ConnectionState.Connecting, ConnectionState.Offline(null, null), ConnectionState.Unlinked, ConnectionState.Attention("x"))) {
            assertTrue(updateView(c, null, "3.8.8") is UpdateView.Unknown)
        }
    }

    @Test fun theVersionNoticeLeadsToTheUpdatePageAndTheOthersWhereTheyDid() {
        assertEquals(UpdateRoute, noticeRoute(NoticeTarget.Version("3.8.9")))
        assertEquals(ChatRoute("session", "a"), noticeRoute(NoticeTarget.Chat("session", "a")))
        assertNull(noticeRoute(NoticeTarget.ChatsTab))
    }

    @Test fun theManifestGainsNoPermissionToDownloadOrInstall() {
        val manifest = File("src/main/AndroidManifest.xml").readText()
        val permissions = Regex("""<uses-permission android:name="([^"]+)"""").findAll(manifest).map { it.groupValues[1] }.toSet()
        assertEquals(
            setOf(
                "android.permission.INTERNET", "android.permission.POST_NOTIFICATIONS", "android.permission.ACCESS_NETWORK_STATE", "android.permission.ACCESS_LOCAL_NETWORK",
                "android.permission.FOREGROUND_SERVICE", "android.permission.FOREGROUND_SERVICE_REMOTE_MESSAGING",
                "android.permission.RECEIVE_BOOT_COMPLETED", "android.permission.CAMERA",
            ),
            permissions,
        )
        assertFalse(manifest.contains("REQUEST_INSTALL_PACKAGES"))
    }

    @Test fun theDownloadSourcesNeverUseTheSystemDownloader() {
        val root = File("src/main/java/dev/orb/app")
        val offenders = root.walkTopDown().filter { it.extension == "kt" }.filter {
            val t = it.readText()
            t.contains("DownloadManager") || t.contains("REQUEST_INSTALL_PACKAGES") || t.contains("application/vnd.android.package-archive")
        }.toList()
        assertEquals(emptyList<File>(), offenders)
    }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class OpenDownloadPageTest {
    @Test fun launchesAPlainViewOfTheFixedAddress() {
        val started = mutableListOf<Intent>()
        assertTrue(openDownloadPage { started += it })
        assertEquals(1, started.size)
        assertEquals(Intent.ACTION_VIEW, started[0].action)
        assertEquals(UpdateLinks.RELEASES, started[0].data.toString())
        assertEquals("https://github.com/danielfinchdev/orb-dev/releases/latest", UpdateLinks.RELEASES)
    }

    @Test fun withoutABrowserItReportsInsteadOfCrashing() {
        assertFalse(openDownloadPage { throw ActivityNotFoundException() })
    }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class UpdateScreenTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()
    private val connection = MutableStateFlow<ConnectionState>(ConnectionState.UpdateApp)
    private var retries = 0
    private var saved = 0
    private var versions: PcVersions? = PcVersions(5, 5, "3.9.0")

    private fun show(seeSaved: Boolean = false) {
        val info = OfflineInfo(connection, MutableStateFlow(null), { retries++ }, pcVersions = { versions })
        rule.setContent {
            OrbTheme(OrbPaletteChoice.Grafito, dark = false) { UpdateScreen(info, seeSaved = if (seeSaved) ({ saved++ }) else null) }
        }
        rule.waitForIdle()
    }

    @Test fun theAppVariantShowsTheRealVersionsAndOpensTheBrowserWithNothingElse() {
        show()
        rule.onNodeWithText("Actualiza la app").assertIsDisplayed()
        rule.onNode(hasText("Tu Orb (3.9.0) habla una versión más nueva del enlace.", substring = true)).assertIsDisplayed()
        rule.onNodeWithText("enlace 5 o más").assertIsDisplayed()
        rule.onNode(hasText("· enlace $PROTOCOL", substring = true)).assertIsDisplayed()
        rule.onNodeWithText("Ir a la descarga").performClick()
        val shadow = shadowOf(rule.activity)
        val intent = shadow.nextStartedActivity
        assertNotNull(intent)
        assertEquals(Intent.ACTION_VIEW, intent.action)
        assertEquals(UpdateLinks.RELEASES, intent.data.toString())
        assertNull(shadow.nextStartedActivity)
        assertEquals(0, rule.onAllNodesWithText(UpdateTexts.NO_BROWSER).fetchSemanticsNodes().size)
    }

    @Test fun thePcVariantRetriesForReal() {
        connection.value = ConnectionState.UpdatePc
        versions = PcVersions(3, 2, "3.6.1")
        show()
        rule.onNodeWithText("Actualiza Orb en el PC").assertIsDisplayed()
        rule.onNodeWithText("3.6.1 · enlace 3").assertIsDisplayed()
        rule.onNodeWithText("Reintentar").performClick()
        assertEquals(1, retries)
        assertNull(shadowOf(rule.activity).nextStartedActivity)
    }

    @Test fun aWorkingLinkSaysThereIsNothingToUpdateInsteadOfInventingAVersion() {
        connection.value = ConnectionState.Online("b", "PC", PcVersions(4, 2, "3.8.8"))
        show()
        rule.onNodeWithText("Todo está al día").assertIsDisplayed()
        rule.onNodeWithText(UpdateTexts.BODY_OK).assertIsDisplayed()
        assertEquals(0, rule.onAllNodesWithText("Actualiza la app").fetchSemanticsNodes().size)
    }

    @Test fun withoutALinkItDoesNotGuess() {
        connection.value = ConnectionState.Offline(null, null)
        show()
        rule.onNodeWithText("No se puede comprobar ahora").assertIsDisplayed()
        rule.onNodeWithText("Reintentar").performClick()
        assertEquals(1, retries)
    }

    @Test fun theLaunchVariantOffersTheSavedChatsToo() {
        show(seeSaved = true)
        rule.onNodeWithText("Ver chats guardados").performClick()
        assertEquals(1, saved)
    }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class UpdateContentTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    @Test fun withoutABrowserTheScreenSaysSoWithOneSentenceAndTheAddress() {
        rule.setContent {
            OrbTheme(OrbPaletteChoice.Grafito, dark = false) {
                UpdateContent(UpdateView.App("3.8.8", 5, "3.9.0"), browserMissing = true, actions = UpdateActions())
            }
        }
        rule.waitForIdle()
        rule.onNodeWithText(UpdateTexts.NO_BROWSER).assertIsDisplayed()
        assertTrue(UpdateTexts.NO_BROWSER.contains("github.com/danielfinchdev/orb-dev/releases/latest"))
    }
}

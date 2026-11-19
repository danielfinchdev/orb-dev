package dev.orb.app.ui.chats

import android.app.Activity
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.ResolveInfo
import android.speech.RecognizerIntent
import androidx.activity.result.ActivityResultRegistry
import androidx.activity.result.ActivityResultRegistryOwner
import androidx.activity.result.contract.ActivityResultContract
import androidx.activity.compose.LocalActivityResultRegistryOwner
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.core.app.ActivityOptionsCompat
import androidx.test.core.app.ApplicationProvider
import dev.orb.app.data.json
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.theme.OrbPaletteChoice
import dev.orb.app.ui.theme.OrbTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** «@» mentions, «/» commands and dictation of the writing box, and the parts they are made of. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ComposerAssistTest {
    @get:Rule val rule = createComposeRule()

    private val field = ChatTexts.MESSAGE_FIELD

    private fun options() = listOf(
        MentionOption("@tarea:43", "#43 Borrar build/ y reinstalar", "tarea · app-movil", MentionKind.Task),
        MentionOption("@conversacion:9", "Pantalla de pagos", "conversación · claude", MentionKind.Conversation),
        MentionOption("@bitacora:app-movil", "Bitácora de app-movil", "bitácora", MentionKind.Log),
    )

    private fun box(
        online: Boolean = true, mentions: MentionSource? = null, commands: List<ComposerCommand> = emptyList(),
        mic: Boolean = false, sent: MutableList<String> = ArrayList(), registry: ActivityResultRegistry? = null,
    ) {
        rule.setContent {
            OrbTheme(OrbPaletteChoice.Grafito, dark = false) {
                val owner = registry?.let { r -> object : ActivityResultRegistryOwner { override val activityResultRegistry = r } }
                CompositionLocalProvider(*listOfNotNull(owner?.let { LocalActivityResultRegistryOwner provides it }).toTypedArray()) {
                    Composer(
                        online = online, busy = false, mode = null, canSetMode = false, onSend = { sent += it }, onStop = {},
                        mic = mic, mentions = mentions, commands = commands,
                    )
                }
            }
        }
        rule.waitForIdle()
    }

    private fun type(text: String) {
        rule.onNode(hasSetTextAction()).performTextInput(text)
        rule.waitForIdle()
    }

    // --- the parts ---

    @Test fun theParserKeepsOnlyTokensThePcCanExpandAndNeverShowsAPath() {
        val raw = json(
            """[
              {"token":"@tarea:43","label":"#43 Borrar","hint":"tarea · app-movil","kind":"tarea"},
              {"token":"@tarea:44","label":"C:\\Users\\dani\\app\\styles.css","hint":"/home/dani/app/src","kind":"tarea"},
              {"token":"@archivo:../x","label":"raro","hint":"x","kind":"archivo"},
              {"token":"@tarea:43","label":"repetida","kind":"tarea"},
              {"token":"@bitacora:general"},
              {"label":"sin token"},
              7, null
            ]""",
        )
        val got = MentionParser.parse(raw)
        assertEquals(listOf("@tarea:43", "@tarea:44"), got.map { it.token })
        assertEquals("styles.css", got[1].label)
        assertEquals("src", got[1].hint)
        assertTrue(MentionParser.parse(json("""{"nope":1}""")).isEmpty())
        assertTrue(MentionParser.parse(null).isEmpty())
    }

    @Test fun theTriggerIsAnAtAtTheCursorAfterASpaceOrTheStart() {
        assertEquals("", MentionTrigger.at("Revisa el @", 11)?.query)
        assertEquals(10, MentionTrigger.at("Revisa el @", 11)?.start)
        assertEquals("sty", MentionTrigger.at("@sty", 4)?.query)
        assertNull(MentionTrigger.at("correo@sitio", 12))
        assertNull(MentionTrigger.at("Revisa el @tarea:43 y", 21))
        // the cursor decides, not the end of the text
        assertEquals("a", MentionTrigger.at("ver @a y más", 6)?.query)
    }

    @Test fun filteringIgnoresCaseAndAccentsAndCapsEachKind() {
        assertEquals(listOf("@bitacora:app-movil"), MentionFilter.filter(options(), "BITÁCORA").map { it.token })
        assertEquals(3, MentionFilter.filter(options(), "").size)
        val many = (1..30).map { MentionOption("@tarea:$it", "#$it tarea", null, MentionKind.Task) }
        assertEquals(8, MentionFilter.filter(many, "").size)
    }

    @Test fun theCommandTriggerIsASlashAloneAtTheStart() {
        assertEquals("", CommandTrigger.query("/"))
        assertEquals("com", CommandTrigger.query("/com"))
        assertNull(CommandTrigger.query("/compact ahora"))
        assertNull(CommandTrigger.query("hola /"))
        assertNull(CommandTrigger.query("/a/b"))
    }

    // --- mentions in the box ---

    @Test fun anAtOpensTheListFilteredAsYouTypeAndAPickWritesTheToken() {
        box(mentions = { options() })
        type("Revisa el @")
        rule.onNodeWithText("Mencionar").assertIsDisplayed()
        rule.onNodeWithText("#43 Borrar build/ y reinstalar").assertIsDisplayed()
        rule.onNodeWithText("Pantalla de pagos").assertIsDisplayed()
        rule.onNodeWithText("Bitácora de app-movil").assertIsDisplayed()
        type("pant")
        rule.onNodeWithText("Pantalla de pagos").assertIsDisplayed()
        rule.onNodeWithText("#43 Borrar build/ y reinstalar").assertDoesNotExist()
        rule.onNodeWithText("Pantalla de pagos").performClick()
        rule.waitForIdle()
        rule.onNode(hasSetTextAction()).assertTextContains("Revisa el @conversacion:9 ")
        rule.onNodeWithText("Mencionar").assertDoesNotExist()
    }

    @Test fun theListSpeaksItsTitleAndHowManyRows() {
        box(mentions = { options() })
        type("@")
        rule.onNodeWithContentDescription("Mencionar, 3 resultados").assertExists()
        type("pant")
        rule.onNodeWithContentDescription("Mencionar, 1 resultado").assertExists()
    }

    @Test fun withoutTheLinkOrWithAPcThatCannotTheAtIsJustAnAt() {
        box(online = false, mentions = { options() })
        type("Hola @")
        rule.onNodeWithText("Mencionar").assertDoesNotExist()
        rule.onNode(hasSetTextAction()).assertTextContains("Hola @")
    }

    @Test fun aPcWithoutMentionsOrAFailedAskShowsNothing() {
        box(mentions = { null })
        type("@")
        rule.onNodeWithText("Mencionar").assertDoesNotExist()
    }

    @Test fun noSourceNoList() {
        box(mentions = null)
        type("@")
        rule.onNodeWithText("Mencionar").assertDoesNotExist()
    }

    @Test fun anAtInsideAWordDoesNotOpenTheList() {
        box(mentions = { options() })
        type("correo@")
        rule.onNodeWithText("Mencionar").assertDoesNotExist()
    }

    // --- commands in the box ---

    private fun compact(log: MutableList<String>) = listOf(ComposerCommand("/compact", "Resume la conversación para liberar contexto", OrbIcons.Minimize2) { log += "compact" })

    @Test fun aSlashListsTheCommandsAndPickingOneRunsItAndEmptiesTheBox() {
        val log = ArrayList<String>()
        val sent = ArrayList<String>()
        box(commands = compact(log), sent = sent)
        type("/")
        rule.onNodeWithText("Comandos").assertIsDisplayed()
        rule.onNodeWithContentDescription("Comandos, 1 resultado").assertExists()
        rule.onNodeWithText("/compact").performClick()
        rule.waitForIdle()
        assertEquals(listOf("compact"), log)
        assertTrue(sent.isEmpty())
        rule.onNodeWithText("Comandos").assertDoesNotExist()
        rule.onNodeWithContentDescription(ChatTexts.SEND).assertIsNotEnabled()
    }

    @Test fun theListFollowsWhatIsTypedAndNeverOffersWhatDoesNotExist() {
        box(commands = compact(ArrayList()))
        type("/co")
        rule.onNodeWithText("/compact").assertIsDisplayed()
        type("x")
        rule.onNodeWithText("/compact").assertDoesNotExist()
    }

    @Test fun withoutCommandsASlashIsPlainText() {
        box(commands = emptyList())
        type("/")
        rule.onNodeWithText("Comandos").assertDoesNotExist()
    }

    @Test fun aSlashAfterTextIsNotACommand() {
        box(commands = compact(ArrayList()))
        type("hola /")
        rule.onNodeWithText("Comandos").assertDoesNotExist()
    }

    // --- dictation ---

    private class FakeRegistry(private val phrase: String?, private val code: Int = Activity.RESULT_OK) : ActivityResultRegistry() {
        var launched: Intent? = null
        override fun <I, O> onLaunch(requestCode: Int, contract: ActivityResultContract<I, O>, input: I, options: ActivityOptionsCompat?) {
            launched = input as Intent
            val data = Intent().also { if (phrase != null) it.putStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS, arrayListOf(phrase)) }
            dispatchResult(requestCode, code, data)
        }
    }

    private fun installRecognizer() {
        val info = ResolveInfo().apply { activityInfo = ActivityInfo().apply { packageName = "com.example.speech"; name = "Recognize" } }
        val pm = shadowOf(ApplicationProvider.getApplicationContext<android.app.Application>().packageManager)
        pm.addResolveInfoForIntent(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH), info)
    }

    @Test fun theMicAsksTheSystemRecognizerAndPutsTheTextInTheBoxWithoutSending() {
        installRecognizer()
        val registry = FakeRegistry("hola mundo")
        val sent = ArrayList<String>()
        box(mic = true, sent = sent, registry = registry)
        rule.onNodeWithContentDescription(ChatTexts.MIC).assertIsEnabled()
        type("Dime:")
        rule.onNodeWithContentDescription(ChatTexts.MIC).performClick()
        rule.waitForIdle()
        assertEquals(RecognizerIntent.ACTION_RECOGNIZE_SPEECH, registry.launched?.action)
        rule.onNode(hasSetTextAction()).assertTextContains("Dime: hola mundo")
        assertTrue(sent.isEmpty())
    }

    @Test fun aCancelledDictationLeavesTheBoxAlone() {
        installRecognizer()
        box(mic = true, registry = FakeRegistry(null, Activity.RESULT_CANCELED))
        type("Dime:")
        rule.onNodeWithContentDescription(ChatTexts.MIC).performClick()
        rule.waitForIdle()
        rule.onNode(hasSetTextAction()).assertTextContains("Dime:")
    }

    @Test fun withoutARecognizerTheMicIsOffAndSaysWhy() {
        val registry = FakeRegistry("no debería salir")
        box(mic = true, registry = registry)
        rule.onNodeWithContentDescription(ChatTexts.MIC_NONE).assertIsNotEnabled()
        rule.onNodeWithContentDescription(ChatTexts.MIC_NONE).performClick()
        assertNull(registry.launched)
    }

    @Test fun theAppAsksForNoMicrophonePermission() {
        val ctx = ApplicationProvider.getApplicationContext<android.app.Application>()
        @Suppress("DEPRECATION")
        val info = ctx.packageManager.getPackageInfo(ctx.packageName, android.content.pm.PackageManager.GET_PERMISSIONS)
        assertNotNull(info)
        assertTrue(info.requestedPermissions.orEmpty().none { it == "android.permission.RECORD_AUDIO" })
    }
}

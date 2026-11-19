package dev.orb.app.ui.shots

import android.net.Uri
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import dev.orb.app.attach.AttachController
import dev.orb.app.attach.AttachIo
import dev.orb.app.attach.AttachTexts
import dev.orb.app.attach.AttachUploader
import dev.orb.app.attach.SourceInfo
import dev.orb.app.attach.UploadPolicy
import dev.orb.app.share.ShareRequest
import dev.orb.app.share.SharedFile
import dev.orb.app.ui.chats.BrainInfo
import dev.orb.app.ui.chats.ChatKind
import dev.orb.app.ui.chats.ChatRow
import dev.orb.app.ui.chats.FakeOrbeChatBackend
import dev.orb.app.ui.chats.MentionKind
import dev.orb.app.ui.chats.MentionOption
import dev.orb.app.ui.chats.MentionSource
import dev.orb.app.ui.chats.OrbeChatScreen
import dev.orb.app.ui.chats.OrbeChatViewModel
import dev.orb.app.ui.chats.row
import dev.orb.app.ui.share.ShareBackend
import dev.orb.app.ui.share.ShareDest
import dev.orb.app.ui.share.ShareScreen
import dev.orb.app.ui.share.ShareViewModel
import dev.orb.app.ui.theme.OrbPaletteChoice
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

/**
 * Pictures of attachments, mentions, commands and «Compartir con Orb» (16) in each state of the mockup, to set them beside
 * it: `ORB_SHOTS=1` turns them on. The main one has no suffix.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = Shots.PHONE)
class AttachShotsTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()
    @get:Rule val tmp = TemporaryFolder()

    // The bars and the spinner stand still so a picture is the same every time.
    @Before fun still() {
        Settings.Global.putFloat(rule.activity.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 0f)
    }

    private val zone = ZoneId.systemDefault()
    private fun at(h: Int, m: Int): String = LocalDate.now().atTime(LocalTime.of(h, m)).atZone(zone).toInstant().toString()

    private fun line(id: Long, role: String, body: String, time: String) =
        """{"id":$id,"conversation_id":7,"role":"$role","body":${JsonPrimitive(body)},"meta":null,"at":"$time"}"""

    private fun backend() = FakeOrbeChatBackend(
        listOf(line(1, "orb", "¿Me pasas una captura del fallo?", at(13, 51)), line(2, "usuario", "Mira el botón de abajo, se sale", at(13, 52))),
    ).apply {
        headerRow.value = row("7", title = "Versión 2.0 de la app", project = "app-movil")
        brainOnPc = BrainInfo("Claude Code", "Opus", "high")
        modeOnPc = "preguntar"
    }

    private val policy = UploadPolicy(10_000_000, setOf("png", "pdf"))

    private class Gate : AttachUploader {
        val never = CompletableDeferred<Unit>()
        override suspend fun upload(bytes: ByteArray, mime: String?, name: String?): Result<String> { never.await(); return Result.success("x") }
    }

    private fun attachments(vararg files: Pair<String, String>): AttachController {
        val infos = files.toMap()
        val io = object : AttachIo {
            override fun info(uri: Uri) = SourceInfo(uri.lastPathSegment.orEmpty(), infos[uri.lastPathSegment])
            override fun read(uri: Uri, maxBytes: Long) = ByteArray(10)
        }
        val uploader = AttachUploader { _, _, name -> if (name == "PDF") Result.success("PDF") else Gate().upload(ByteArray(0), null, name) }
        return AttachController(
            CoroutineScope(SupervisorJob() + Dispatchers.Unconfined), io, uploader, { policy }, File(tmp.newFolder(), "w"), Dispatchers.Unconfined, reduce = { it },
        )
    }

    private val mentions = MentionSource {
        listOf(
            MentionOption("@tarea:43", "#43 Borrar build/ y reinstalar", "tarea · app-movil", MentionKind.Task),
            MentionOption("@conversacion:9", "Pantalla de pagos", "conversación · claude", MentionKind.Conversation),
            MentionOption("@bitacora:app-movil", "Bitácora de app-movil", "bitácora", MentionKind.Log),
        )
    }

    private fun shoot(palette: OrbPaletteChoice, suffix: String, attach: AttachController? = null, withMentions: Boolean = false, after: () -> Unit = {}) {
        Shots.assumeEnabled()
        val vm = OrbeChatViewModel(backend(), 7, dispatcher = Dispatchers.Unconfined, attach = attach)
        var dark by mutableStateOf(false)
        rule.setContent {
            ShotFrame(palette, dark) { OrbeChatScreen(vm, onBack = {}, liveRefreshMs = 0, mentions = if (withMentions) mentions else null) }
        }
        rule.waitForIdle()
        after()
        rule.waitForIdle()
        Shots.save(rule.activity, "16-adjuntos-${palette.key}-claro$suffix")
        dark = true
        repeat(4) { rule.mainClock.advanceTimeByFrame() }
        rule.waitForIdle()
        Shots.save(rule.activity, "16-adjuntos-${palette.key}-oscuro$suffix")
    }

    @Test fun base() = shoot(OrbPaletteChoice.Grafito, "", attachments())
    @Test fun baseOceano() = shoot(OrbPaletteChoice.Oceano, "", attachments())

    @Test fun tray() = shoot(OrbPaletteChoice.Grafito, "-bandeja", attachments(), after = {
        rule.onNodeWithContentDescription(AttachTexts.ADD).performClick()
    })

    @Test fun withAttachments() {
        val a = attachments("captura.png" to "image/png", "PDF" to "application/pdf")
        shoot(OrbPaletteChoice.Grafito, "-adjuntos", a, after = {
            a.addUris(listOf(Uri.parse("content://x/captura.png"), Uri.parse("content://x/PDF")))
            rule.waitForIdle()
            rule.onNode(hasSetTextAction()).performTextInput("Mira el botón de abajo, se sale")
        })
    }

    @Test fun mentions() = shoot(OrbPaletteChoice.Grafito, "-menciones", attachments(), withMentions = true, after = {
        rule.onNode(hasSetTextAction()).performTextInput("Revisa el @")
        rule.waitForIdle()
    })

    @Test fun commands() = shoot(OrbPaletteChoice.Grafito, "-comandos", attachments(), after = {
        rule.onNode(hasSetTextAction()).performTextInput("/")
        rule.waitForIdle()
    })

    @Test fun share() {
        Shots.assumeEnabled()
        val file = tmp.newFile().apply { writeBytes(ByteArray(5)) }
        val backend = object : ShareBackend {
            override fun recents(): Flow<List<ChatRow>> = flowOf(
                listOf(row("7", title = "Versión 2.0 de la app", project = "app-movil"), row("8", title = "Pantalla de pagos", project = "app-movil")),
            )
            override suspend fun projects() = emptyList<String>()
            override suspend fun send(dest: ShareDest, text: String, images: List<String>) = Result.success(Unit)
        }
        val a = attachments("captura.png" to "image/png")
        val vm = ShareViewModel(backend, ShareRequest(null, listOf(SharedFile(file, "captura.png", "image/png")), 0, false), a, Dispatchers.Unconfined)
        var dark by mutableStateOf(false)
        rule.setContent { ShotFrame(OrbPaletteChoice.Grafito, dark) { ShareScreen(vm, onClose = {}) } }
        rule.waitForIdle()
        Shots.save(rule.activity, "16-adjuntos-grafito-claro-compartir")
        dark = true
        repeat(4) { rule.mainClock.advanceTimeByFrame() }
        rule.waitForIdle()
        Shots.save(rule.activity, "16-adjuntos-grafito-oscuro-compartir")
    }
}

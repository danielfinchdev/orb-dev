package dev.orb.app.notify

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import dev.orb.app.link.net.LinkEvent
import dev.orb.app.ui.notes.NoticeTarget
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

private fun js(s: String) = Json.parseToJsonElement(s)

// What the PC really sends (src/shared/notes.mjs and src/engine/transport/notes-center.mjs), one per case of the notices.
private const val APPROVAL = """{"key":"session:s1","id":21000,"nid":4,"kind":"approval","title":"Claude Code","body":"npm install","route":{"view":"chat"},"card":{"method":"sessions.approve","id":"s1","request":"r9"},"actions":[{"id":"deny","title":"Rechazar"},{"id":"allow","title":"Aprobar"}],"silent":false}"""
private const val TASK_WAITS = """{"key":"conversation:5","id":27091,"nid":5,"line":31,"kind":"task","title":"Revisar pasarela","body":"Tarea #43 espera tu OK","route":{"view":"chat","id":5},"card":{"method":"tasks.approve","task":43},"actions":[{"id":"allow","title":"Aprobar","open":true}],"silent":false}"""
private const val TASK_ENDS = """{"key":"conversation:5","id":27091,"nid":6,"line":32,"kind":"message","title":"Revisar pasarela","body":"✅ #43 terminó","route":{"view":"chat","id":5},"actions":[{"id":"reply","title":"Responder","input":true}],"silent":false}"""
private const val TASK_FAILS = """{"key":"orb","id":20626,"nid":7,"line":40,"kind":"message","title":"Orb","body":"❌ #44 falló","route":{"view":"chat"},"actions":[{"id":"reply","title":"Responder","input":true}],"silent":false}"""
private const val HELD = """{"key":"held:39","id":22000,"nid":8,"kind":"held","title":"Orb","body":"Orb paró la #39 · borró 12 archivos","route":{"view":"tasks","id":39},"target":{"type":"task","id":39},"actions":[],"silent":false}"""
private const val SCHEDULE_ENDS = """{"key":"conversation:9","id":23000,"nid":9,"line":50,"kind":"message","title":"Resumen diario","body":"✅ Programada terminada","route":{"view":"chat","id":9},"actions":[{"id":"reply","title":"Responder","input":true}],"silent":false}"""
private const val DONE = """{"key":"done:42","id":24000,"nid":10,"kind":"done","title":"Orb","body":"#42 terminada y revisada","route":{"view":"tasks","id":42},"target":{"type":"task","id":42},"actions":[],"silent":false}"""
private const val LIMIT = """{"key":"limit:claude","id":25000,"nid":11,"kind":"limit","title":"Orb","body":"Claude ya tiene límite otra vez","route":{"view":"chat"},"target":{"type":"account","id":"claude"},"actions":[],"silent":false}"""
private const val UPDATE = """{"key":"update:3.8.9","id":26000,"nid":12,"kind":"update","title":"Orb","body":"Orb 3.8.9 disponible en el PC","route":{"view":"chat"},"target":{"type":"version","id":"3.8.9"},"actions":[],"silent":false}"""
private const val UNKNOWN = """{"key":"gizmo:1","id":28000,"nid":13,"kind":"gizmo","title":"Secreto","body":"texto privado","route":{"view":"chat"},"card":{"method":"sessions.approve","id":"s1","request":"r9"},"acts":{"allow":"tok-a","deny":"tok-d"},"actions":[{"id":"allow","title":"Aprobar"},{"id":"deny","title":"Rechazar"},{"id":"reply","title":"Responder","input":true}],"silent":false}"""

private val ALL_KINDS = listOf(APPROVAL, TASK_WAITS, TASK_ENDS, TASK_FAILS, HELD, SCHEDULE_ENDS, DONE, LIMIT, UPDATE, UNKNOWN)

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NoticeCasesTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val storage = MemoryJobStorage()
    private val jobs = NoteJobs(storage)
    private var screen = LockScreenNotice.Generic
    private val poster = AndroidNotePoster(context, jobs, lockScreen = { screen })
    private val nm get() = context.getSystemService(NotificationManager::class.java)

    private fun plan(raw: String, settings: NotifySettings = NotifySettings(lockScreen = screen)) =
        NotePlanner.plan(PcNotes.parse(js(raw))!!, settings)

    private fun post(raw: String): Notification {
        poster.show(plan(raw))
        return shadowOf(nm).allNotifications.last()
    }

    private fun importance(n: Notification) = nm.getNotificationChannel(n.channelId).importance
    private fun titles(n: Notification) = n.actions.orEmpty().map { it.title.toString() }

    // ---- the channels of mock-ups 24 and 25: Mensajes, Aprobaciones, Estado

    @Test fun theChannelsAreTheThreeOfTheMockUpsWithTheirNamesAndImportance() {
        NotifyChannels.ensure(context)
        val ids = nm.notificationChannels.associate { it.id to (it.name.toString() to it.importance) }
        assertEquals(
            mapOf(
                "orb-chats" to ("Mensajes" to NotificationManager.IMPORTANCE_HIGH),
                "orb-approvals" to ("Aprobaciones" to NotificationManager.IMPORTANCE_HIGH),
                "orb-status" to ("Estado" to NotificationManager.IMPORTANCE_LOW),
            ),
            ids,
        )
    }

    @Test fun anOldChannelKeepsWhatThePersonChoseAndOnlyItsNameIsRefreshed() {
        val old = android.app.NotificationChannel("orb-status", "Estado de la conexión", NotificationManager.IMPORTANCE_MIN)
        nm.createNotificationChannel(old)
        NotifyChannels.ensure(context)
        val now = nm.getNotificationChannel("orb-status")
        assertEquals("Estado", now.name.toString())
        assertEquals(NotificationManager.IMPORTANCE_MIN, now.importance)
    }

    // ---- (a) to (f): what is posted for each case

    @Test fun a_anAgentAsksForPermission() {
        val n = post(APPROVAL)
        assertEquals("orb-approvals", n.channelId)
        assertEquals(NotificationManager.IMPORTANCE_HIGH, importance(n))
        assertEquals(listOf("Rechazar", "Aprobar"), titles(n))
        assertTrue(n.actions.all { it.isAuthenticationRequired })
        assertEquals(JobTarget("chat", "session", "s1"), plan(APPROVAL).tap.target)
        assertEquals(NoticeTarget.Chat("session", "s1"), plan(APPROVAL).tap.target!!.toNotice())
    }

    @Test fun b_aTaskWaitsForYourOk() {
        val n = post(TASK_WAITS)
        assertEquals("orb-approvals", n.channelId)
        assertEquals(NotificationManager.IMPORTANCE_HIGH, importance(n))
        // The approval is signed in the app: the button only opens it, and it is not a button that acts.
        assertEquals(listOf("Aprobar"), titles(n))
        val p = plan(TASK_WAITS)
        assertFalse(p.actions.single().job.acts)
        assertEquals(NoticeTarget.Task(43), p.tap.target!!.toNotice())
        assertEquals(NoticeTarget.Task(43), p.actions.single().job.target!!.toNotice())
    }

    @Test fun c_aTaskEnds() {
        val n = post(TASK_ENDS)
        assertEquals("orb-chats", n.channelId)
        assertEquals(NotificationManager.IMPORTANCE_HIGH, importance(n))
        assertEquals(listOf("Responder", "Marcar leído"), titles(n))
        assertEquals(NoticeTarget.Chat("conversation", "5"), plan(TASK_ENDS).tap.target!!.toNotice())
    }

    @Test fun d_aTaskFailsAndOnlyTheChatLineSaysSo() {
        val n = post(TASK_FAILS)
        assertEquals("orb-chats", n.channelId)
        assertEquals(listOf("Responder", "Marcar leído"), titles(n))
        // The main Orbe chat has no conversation: the tap leads to the chat list.
        assertEquals(NoticeTarget.ChatsTab, plan(TASK_FAILS).tap.target!!.toNotice())
    }

    @Test fun e_aTaskIsHeldByOrb() {
        val n = post(HELD)
        assertEquals("orb-approvals", n.channelId)
        assertEquals(NotificationManager.IMPORTANCE_HIGH, importance(n))
        assertTrue(titles(n).isEmpty())
        assertEquals(NoticeTarget.Task(39), plan(HELD).tap.target!!.toNotice())
    }

    @Test fun f_aScheduleEnds() {
        val n = post(SCHEDULE_ENDS)
        assertEquals("orb-chats", n.channelId)
        assertEquals(listOf("Responder", "Marcar leído"), titles(n))
        assertEquals(NoticeTarget.Chat("conversation", "9"), plan(SCHEDULE_ENDS).tap.target!!.toNotice())
    }

    @Test fun theNoticesThatAreNotChatLinesAreInformationWithNoButtons() {
        for ((raw, target) in listOf(
            DONE to NoticeTarget.TaskChanges(42), LIMIT to NoticeTarget.Account("claude"), UPDATE to NoticeTarget.Version("3.8.9"),
        )) {
            val n = post(raw)
            assertEquals("orb-chats", n.channelId)
            assertTrue(titles(n).isEmpty())
            assertEquals(target, plan(raw).tap.target!!.toNotice())
        }
    }

    // ---- silence: the PC decides, the phone also obeys what a note says

    @Test fun aNoteThatSaysItIsQuietShowsNothing() {
        val shown = mutableListOf<NotificationPlan>()
        val fake = object : NotePoster {
            override fun show(plan: NotificationPlan) { shown += plan }
            override fun say(job: NoteJob, text: String, goneAfterMs: Long?) = Unit
            override fun cancel(id: Int) = Unit
            override fun clearNotes() = Unit
        }
        val notifier = Notifier(kotlinx.coroutines.flow.emptyFlow(), { NotifySettings() }, { false }, fake)
        notifier.handle(LinkEvent("note", js(TASK_ENDS.replaceFirst("{", """{"quiet":true,"""))))
        notifier.handle(LinkEvent("note", js(TASK_ENDS.replaceFirst("{", """{"muted":true,"""))))
        assertTrue(shown.isEmpty())
        notifier.handle(LinkEvent("note", js(TASK_ENDS)))
        assertEquals(1, shown.size)
    }

    // ---- lock screen: three choices, every kind

    @Test fun soloOrbShowsOnlyOrbAndAGenericLineForEveryKind() {
        screen = LockScreenNotice.Generic
        for (raw in ALL_KINDS) {
            val real = PcNotes.parse(js(raw))!!
            val n = post(raw)
            assertEquals(Notification.VISIBILITY_PRIVATE, n.visibility)
            val public = n.publicVersion
            assertNotNull(public)
            assertEquals("Orb", public.extras.getString(Notification.EXTRA_TITLE))
            val text = public.extras.getString(Notification.EXTRA_TEXT)!!
            assertTrue(text in listOf("Tienes un mensaje nuevo", "Tienes un aviso nuevo", "Orb necesita tu respuesta"))
            assertFalse(text.contains(real.body))
            assertTrue(public.actions == null || public.actions.isEmpty())
        }
    }

    @Test fun nothingKeepsEveryKindOffTheLockScreen() {
        screen = LockScreenNotice.Hidden
        for (raw in ALL_KINDS) {
            val n = post(raw)
            assertEquals(Notification.VISIBILITY_SECRET, n.visibility)
            assertNull(n.publicVersion)
        }
    }

    @Test fun fullShowsTheContentOnlyWhenThePersonAsksForIt() {
        screen = LockScreenNotice.Full
        for (raw in ALL_KINDS) assertEquals(Notification.VISIBILITY_PUBLIC, post(raw).visibility)
    }

    @Test fun theResultOfAButtonNeverShowsTheChatNameOnTheLockScreenUnlessAskedTo() {
        val job = plan(APPROVAL).actions[1].job
        screen = LockScreenNotice.Generic
        poster.say(job, "Aprobado", null)
        val n = shadowOf(nm).allNotifications.single()
        assertEquals(Notification.VISIBILITY_PRIVATE, n.visibility)
        assertEquals("Orb", n.publicVersion.extras.getString(Notification.EXTRA_TITLE))
        assertEquals("Claude Code", n.extras.getString(Notification.EXTRA_TITLE))
    }

    @Test fun withThePreviewOffOnThePcTheNoticesCarryNoRealText() {
        val hiddenLimit = """{"key":"limit:claude","nid":11,"kind":"limit","title":"Orb","body":"Tienes un aviso nuevo","hidden":true,"target":{"type":"account","id":"claude"},"actions":[]}"""
        val n = post(hiddenLimit)
        assertEquals("Orb", n.extras.getString(Notification.EXTRA_TITLE))
        assertEquals("Tienes un aviso nuevo", n.extras.getString(Notification.EXTRA_TEXT))
    }

    @Test fun theAppsOwnGenericTextSaysNoticeForTheKindsThatAreNotMessages() {
        for (raw in listOf(DONE, HELD, LIMIT, UPDATE, UNKNOWN)) {
            val p = plan(raw)
            assertEquals("Tienes un aviso nuevo", p.publicText)
        }
        assertEquals("Tienes un mensaje nuevo", plan(TASK_ENDS).publicText)
        assertEquals("Orb necesita tu respuesta", plan(APPROVAL).publicText)
        assertEquals("Orb necesita tu respuesta", plan(TASK_WAITS).publicText)
    }

    // ---- the PendingIntents of the buttons

    @Test fun markAsReadNeedsNoUnlockingAndIsImmutableWhileTheOthersAskForIt() {
        post(TASK_ENDS)
        val actions = shadowOf(nm).allNotifications.single().actions
        val reply = actions[0]
        val read = actions[1]
        assertTrue(reply.isAuthenticationRequired)
        assertFalse(read.isAuthenticationRequired)
        assertTrue(shadowOf(read.actionIntent).flags and PendingIntent.FLAG_IMMUTABLE != 0)
        assertTrue(shadowOf(reply.actionIntent).flags and PendingIntent.FLAG_MUTABLE != 0)
        nm.cancelAll()
        val approval = post(APPROVAL).actions
        assertTrue(approval.all { it.isAuthenticationRequired })
        assertTrue(approval.all { shadowOf(it.actionIntent).flags and PendingIntent.FLAG_IMMUTABLE != 0 })
    }

    // ---- permission denied

    @Test fun withoutThePermissionNothingIsBuiltPostedOrKept() {
        shadowOf(nm).setNotificationsEnabled(false)
        poster.show(plan(APPROVAL))
        poster.show(plan(TASK_ENDS))
        poster.say(plan(APPROVAL).actions[1].job, "Aprobado", null)
        assertTrue(shadowOf(nm).allNotifications.isEmpty())
        // No token of a button was kept either.
        assertTrue(storage.all().isEmpty())
        // And turning them on again works without any leftovers.
        shadowOf(nm).setNotificationsEnabled(true)
        poster.show(plan(TASK_ENDS))
        assertEquals(1, shadowOf(nm).allNotifications.size)
    }
}

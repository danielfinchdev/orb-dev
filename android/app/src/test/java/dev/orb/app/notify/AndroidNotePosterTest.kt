package dev.orb.app.notify

import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class AndroidNotePosterTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val jobs = NoteJobs(MemoryJobStorage())
    private val poster = AndroidNotePoster(context, jobs)
    private val nm get() = context.getSystemService(NotificationManager::class.java)

    private fun plan(raw: String, settings: NotifySettings = NotifySettings()) =
        NotePlanner.plan(PcNotes.parse(Json.parseToJsonElement(raw))!!, settings)

    private val approval = """{"key":"session:s1","kind":"approval","title":"Claude Code","body":"npm install","route":{"view":"chat"},"card":{"method":"sessions.approve","id":"s1","request":"r9"},"actions":[{"id":"deny","title":"Rechazar"},{"id":"allow","title":"Aprobar"}]}"""
    private val message = """{"key":"conversation:5","route":{"view":"chat","id":5},"title":"Orbe","body":"¿Lo subo?","actions":[{"id":"reply","title":"Responder","input":true}]}"""

    @Test fun createsTheThreeChannelsKeepingTheOldMessagesId() {
        NotifyChannels.ensure(context)
        assertNotNull(nm.getNotificationChannel("orb-chats"))
        assertNotNull(nm.getNotificationChannel("orb-approvals"))
        assertEquals(NotificationManager.IMPORTANCE_LOW, nm.getNotificationChannel("orb-status").importance)
    }

    @Test fun anApprovalShowsItsButtonsOnTheApprovalsChannel() {
        poster.show(plan(approval))
        val n = shadowOf(nm).allNotifications.single()
        assertEquals("orb-approvals", n.channelId)
        assertEquals(listOf("Rechazar", "Aprobar"), n.actions.map { it.title.toString() })
        assertEquals("Claude Code", n.extras.getString(Notification.EXTRA_TITLE))
    }

    @Test fun theLockScreenHidesTheContentByDefault() {
        poster.show(plan(message))
        val n = shadowOf(nm).allNotifications.single()
        assertEquals(Notification.VISIBILITY_PRIVATE, n.visibility)
        assertEquals("Tienes un mensaje nuevo", n.publicVersion.extras.getString(Notification.EXTRA_TEXT))
    }

    @Test fun theContentCanBeShownOnTheLockScreen() {
        poster.show(plan(message, NotifySettings(lockScreen = LockScreenNotice.Full)))
        val n = shadowOf(nm).allNotifications.single()
        assertEquals(Notification.VISIBILITY_PUBLIC, n.visibility)
        assertNull(n.publicVersion)
    }

    @Test fun nothingKeepsTheNoticeOffTheLockScreenWithNoPublicVersion() {
        poster.show(plan(message, NotifySettings(lockScreen = LockScreenNotice.Hidden)))
        val n = shadowOf(nm).allNotifications.single()
        assertEquals(Notification.VISIBILITY_SECRET, n.visibility)
        assertNull(n.publicVersion)
        // it is still posted: it shows once the phone is unlocked
        assertEquals("Orbe", n.extras.getString(Notification.EXTRA_TITLE))
    }

    @Test fun theResultNoticeIsSecretTooWhenNothingIsChosen() {
        var screen = LockScreenNotice.Hidden
        val p2 = AndroidNotePoster(context, jobs, lockScreen = { screen })
        val job = plan(approval).actions[1].job
        p2.say(job, "Aprobado", null)
        assertEquals(Notification.VISIBILITY_SECRET, shadowOf(nm).allNotifications.single().visibility)
        screen = LockScreenNotice.Generic
        p2.say(job, "Aprobado", null)
        assertEquals(Notification.VISIBILITY_PRIVATE, shadowOf(nm).allNotifications.single().visibility)
    }

    @Test fun aReplyTakesTypedText() {
        poster.show(plan(message))
        val reply = shadowOf(nm).allNotifications.single().actions.first()
        assertEquals("Responder", reply.title.toString())
        assertTrue(reply.remoteInputs.single().resultKey == NoteIntents.REPLY_KEY)
    }

    @Test fun aNewerNoteReplacesTheSameChatsNotice() {
        poster.show(plan(message))
        poster.show(plan(message))
        assertEquals(1, shadowOf(nm).allNotifications.size)
    }

    @Test fun clearingRemovesTheNoticesAndTheirJobs() {
        poster.show(plan(approval))
        poster.clearNotes()
        assertTrue(shadowOf(nm).allNotifications.isEmpty())
        assertNull(jobs.peek("anything"))
    }

    @Test fun clearingKeepsTheJobOfATapSoALateIntentStillResolves() {
        val p = plan(message)
        poster.show(p)
        val token = shadowOf(nm).allNotifications.single().contentIntent.let { shadowOf(it).savedIntent.getStringExtra(NoteIntents.EXTRA_TOKEN) }
        poster.clearNotes()
        assertNotNull(jobs.peek(token))
    }

    @Test fun theResultNoticeHidesTheRealTitleWhileTheLockIsOn() {
        var locked = true
        val p2 = AndroidNotePoster(context, jobs) { locked }
        val job = plan(approval).actions[1].job
        p2.say(job, "Aprobado", null)
        assertEquals("Orb", shadowOf(nm).allNotifications.single().extras.getString(Notification.EXTRA_TITLE))
        locked = false
        p2.say(job, "Aprobado", null)
        assertEquals("Claude Code", shadowOf(nm).allNotifications.single().extras.getString(Notification.EXTRA_TITLE))
    }

    @Test fun sayingReplacesTheNoticeWithoutButtons() {
        val p = plan(approval)
        poster.show(p)
        poster.say(p.actions[1].job, "Aprobado", 4_000)
        val n = shadowOf(nm).allNotifications.single()
        assertEquals("Aprobado", n.extras.getString(Notification.EXTRA_TEXT))
        assertTrue(n.actions == null || n.actions.isEmpty())
    }
}

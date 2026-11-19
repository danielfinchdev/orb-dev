package dev.orb.app.notify

import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import dev.orb.app.link.api.PcCaller
import dev.orb.app.ui.notes.NoticeTarget
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
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

private fun parse(raw: String) = PcNotes.parse(Json.parseToJsonElement(raw))!!
private fun plan(raw: String, settings: NotifySettings = NotifySettings()) = NotePlanner.plan(parse(raw), settings)

// What a PC of this branch sends. The actions, card and acts of the information notes are added by the tests below to
// prove they are ignored: a PC never sends them, but nothing here may depend on that.
private val DONE = """{"key":"done:42","kind":"done","title":"Orb","body":"#42 terminada y revisada","hidden":false,"route":{"view":"tasks","id":42},"target":{"type":"task","id":42},"actions":[],"silent":false}"""
private val HELD = """{"key":"held:39","kind":"held","title":"Orb","body":"Orb paró la #39 · ha eliminado 12 archivos","hidden":false,"route":{"view":"tasks","id":39},"target":{"type":"task","id":39},"actions":[]}"""
private val LIMIT = """{"key":"limit:claude","kind":"limit","title":"Orb","body":"Claude ya tiene límite otra vez","hidden":false,"route":{"view":"chat"},"target":{"type":"account","id":"claude"},"actions":[]}"""
private val UPDATE = """{"key":"update:3.8.9","kind":"update","title":"Orb","body":"Orb 3.8.9 disponible en el PC","hidden":false,"route":{"view":"chat"},"target":{"type":"version","id":"3.8.9"},"actions":[]}"""
private val TASK_NOTE = """{"key":"task:43","kind":"task","title":"app-movil","body":"#43 espera tu OK","route":{"view":"chat"},"card":{"method":"tasks.approve","task":43},"actions":[{"id":"allow","title":"Aprobar","open":true}]}"""
private val CHAT = """{"key":"conversation:5","id":27091,"route":{"view":"chat","id":5},"kind":"message","title":"Revisar pasarela","body":"Hecho","line":7,"actions":[{"id":"reply","title":"Responder","input":true}]}"""
private val APPROVAL_NOTE = """{"key":"session:s1","kind":"approval","title":"Claude Code","body":"npm install","route":{"view":"chat"},"card":{"method":"sessions.approve","id":"s1","request":"r9"},"actions":[{"id":"deny","title":"Rechazar"},{"id":"allow","title":"Aprobar"}]}"""

private fun withExtras(raw: String) =
    raw.dropLast(1).replace(""","actions":[]""", "") + ""","actions":[{"id":"allow","title":"Aprobar"},{"id":"reply","title":"Responder","input":true}],"card":{"method":"sessions.approve","id":"s1","request":"r9"},"acts":{"allow":"tk-a","reply":"tk-r"}}"""

class NewNoticeKindsPlanTest {
    private val kinds = listOf(DONE, HELD, LIMIT, UPDATE)

    @Test fun theNewKindsOpenTheirDestinationAndNothingElse() {
        assertEquals(JobTarget("taskChanges", id = "42"), plan(DONE).tap.target)
        assertEquals(JobTarget("task", id = "39"), plan(HELD).tap.target)
        assertEquals(JobTarget("account", id = "claude"), plan(LIMIT).tap.target)
        assertEquals(JobTarget("version", id = "3.8.9"), plan(UPDATE).tap.target)
        assertEquals(NoticeTarget.TaskChanges(42), JobTarget("taskChanges", id = "42").toNotice())
        assertEquals(NoticeTarget.Version("3.8.9"), JobTarget("version", id = "3.8.9").toNotice())
        assertEquals(NoticeTarget.Account("claude"), JobTarget("account", id = "claude").toNotice())
    }

    @Test fun theNewKindsCarryNoButtonsEvenIfThePcSentSome() {
        for (raw in kinds) {
            assertTrue(plan(raw).actions.isEmpty())
            val sent = plan(withExtras(raw))
            assertTrue(sent.actions.isEmpty())
            assertFalse(sent.tap.acts)
        }
    }

    @Test fun theTextIsTheOneThePcWroteAndTheChannelFitsTheKind() {
        assertEquals("Orb", plan(DONE).title)
        assertEquals("#42 terminada y revisada", plan(DONE).text)
        assertEquals("Orb paró la #39 · ha eliminado 12 archivos", plan(HELD).text)
        assertEquals(NoteChannel.Messages, plan(DONE).channel)
        assertEquals(NoteChannel.Messages, plan(LIMIT).channel)
        assertEquals(NoteChannel.Messages, plan(UPDATE).channel)
        // A task Orb stopped needs the person: it goes with the approvals.
        assertEquals(NoteChannel.Approvals, plan(HELD).channel)
        assertEquals("Tienes un mensaje nuevo", plan(DONE).publicText)
    }

    @Test fun aHiddenPreviewShowsOnlyTheGenericText() {
        val hidden = """{"key":"done:42","kind":"done","title":"Orb","body":"Tienes un mensaje nuevo","hidden":true,"target":{"type":"task","id":42},"actions":[]}"""
        val p = plan(hidden)
        assertEquals("Tienes un mensaje nuevo", p.text)
        assertEquals("Orb", p.title)
        assertEquals(JobTarget("taskChanges", id = "42"), p.tap.target)
    }

    @Test fun withTheAppLockOnTheNewKindsShowNoContent() {
        val p = plan(HELD, NotifySettings(lockScreen = LockScreenNotice.Full, appLock = true))
        assertEquals("Orb", p.title)
        assertEquals("Tienes un mensaje nuevo", p.text)
        assertEquals(LockScreenNotice.Generic, p.lockScreen)
        assertEquals("Orb", p.tap.title)
    }
}

class NoticeButtonsSecurityTest {
    @Test fun aTaskWaitingForApprovalIsNeverApprovedFromTheNotification() {
        // Even a PC that sent a token, a non-opening button and a card for the task gets no acting button.
        val tricky = TASK_NOTE.dropLast(1).replace(""""open":true""", """"open":false""") + ""","acts":{"allow":"tk-a","deny":"tk-d"}}"""
        for (raw in listOf(TASK_NOTE, tricky)) {
            val p = plan(raw)
            assertEquals(NoteChannel.Approvals, p.channel)
            assertTrue(p.actions.isNotEmpty())
            for (a in p.actions) {
                assertNull(a.job.token)
                assertNull(a.job.method)
                assertFalse(a.job.acts)
                assertEquals(JobTarget("task", id = "43"), a.job.target)
            }
            assertFalse(p.tap.acts)
        }
    }

    @Test fun thePermissionButtonsAreTheSameAsBefore() {
        val p = plan(APPROVAL_NOTE)
        assertEquals(listOf("Rechazar", "Aprobar"), p.actions.map { it.label })
        assertEquals(listOf("deny", "allow"), p.actions.map { it.job.action })
        assertTrue(p.actions.all { it.job.method == "sessions.approve" && !it.job.local })
    }

    @Test fun aChatNoticeGetsReplyAndMarkReadAndNothingElse() {
        val p = plan(CHAT)
        assertEquals(listOf("Responder", "Marcar leído"), p.actions.map { it.label })
        val read = p.actions[1].job
        assertTrue(read.local)
        assertNull(read.method)
        assertNull(read.token)
        assertEquals("note:conversation:5:7", read.notice)
        assertEquals("note:conversation:5:7", p.tap.notice)
        assertFalse(p.actions[1].input)
    }

    @Test fun noButtonAtAllWhileTheAppLockIsOn() {
        assertTrue(plan(CHAT, NotifySettings(appLock = true)).actions.isEmpty())
    }

    @Test fun theThreeButtonLimitStillHolds() {
        val many = plan("""{"key":"k","actions":[{"id":"a"},{"id":"b"},{"id":"c"},{"id":"d"}]}""")
        assertEquals(3, many.actions.size)
    }
}

private class Caller : PcCaller {
    val calls = mutableListOf<String>()
    val tokens = mutableListOf<String>()
    override suspend fun call(method: String, params: JsonObject): Result<JsonElement> { calls += method; return Result.success(JsonNull) }
    override fun supports(method: String) = true
    override suspend fun noteAction(token: String): Result<Unit> { tokens += token; return Result.success(Unit) }
}

@OptIn(ExperimentalCoroutinesApi::class)
class MarkReadRunnerTest {
    private val jobs = NoteJobs(MemoryJobStorage())
    private val caller = Caller()
    private var locked = true
    private val runner = NoteActionRunner(jobs, { caller }, { locked })

    @Test fun markingReadWorksLockedAndTalksToNoPc() = runTest {
        val token = jobs.keep(plan(CHAT).actions[1].job)
        val (job, outcome) = runner.run(token, null)!!
        assertTrue(outcome is NoteOutcome.Read)
        assertEquals("note:conversation:5:7", job.notice)
        assertTrue(caller.calls.isEmpty() && caller.tokens.isEmpty())
    }

    @Test fun markingReadUsesItsTokenOnce() = runTest {
        val token = jobs.keep(plan(CHAT).actions[1].job)
        assertNotNull(runner.run(token, null))
        assertNull(runner.run(token, null))
    }

    @Test fun theReplyStillNeedsTheUnlockedPhoneAndTheApprovalToo() = runTest {
        val reply = jobs.keep(plan(CHAT).actions[0].job)
        assertTrue(runner.run(reply, "hola")!!.second is NoteOutcome.Locked)
        val allow = jobs.keep(plan(APPROVAL_NOTE).actions[1].job)
        assertTrue(runner.run(allow, null)!!.second is NoteOutcome.Locked)
        assertTrue(caller.calls.isEmpty())
    }

    @Test fun readingAJobDropsItsSiblingsLikeAnyOther() = runTest {
        val p = plan(CHAT)
        val reply = jobs.keep(p.actions[0].job)
        val read = jobs.keep(p.actions[1].job)
        runner.run(read, null)
        assertNull(jobs.peek(reply))
    }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NewNoticesPosterTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val jobs = NoteJobs(MemoryJobStorage())
    private val poster = AndroidNotePoster(context, jobs)
    private val nm get() = context.getSystemService(NotificationManager::class.java)
    private fun shown() = shadowOf(nm).allNotifications

    @Test fun eachNewKindIsANoticeWithItsTextAndNoButtons() {
        for ((raw, channel) in listOf(DONE to "orb-chats", HELD to "orb-approvals", LIMIT to "orb-chats", UPDATE to "orb-chats")) {
            poster.clearNotes()
            val p = plan(raw)
            poster.show(p)
            val n = shown().single()
            assertEquals(channel, n.channelId)
            assertEquals("Orb", n.extras.getString(Notification.EXTRA_TITLE))
            assertEquals(p.text, n.extras.getString(Notification.EXTRA_TEXT))
            assertTrue(n.actions == null || n.actions.isEmpty())
            assertNotNull(n.contentIntent)
            assertTrue(n.flags and Notification.FLAG_AUTO_CANCEL != 0)
        }
    }

    @Test fun theLockScreenOfTheNewKindsFollowsTheChoice() {
        poster.show(plan(DONE))
        assertEquals(Notification.VISIBILITY_PRIVATE, shown().single().visibility)
        assertEquals("Tienes un mensaje nuevo", shown().single().publicVersion.extras.getString(Notification.EXTRA_TEXT))
        poster.show(plan(DONE, NotifySettings(lockScreen = LockScreenNotice.Hidden)))
        assertEquals(Notification.VISIBILITY_SECRET, shown().single().visibility)
    }

    @Test fun tappingTheNoticeOpensItsDestination() {
        poster.show(plan(UPDATE))
        val token = shadowOf(shown().single().contentIntent).savedIntent.getStringExtra(NoteIntents.EXTRA_TOKEN)
        assertEquals(JobTarget("version", id = "3.8.9"), jobs.peek(token)!!.target)
    }

    @Test fun onlyTheReplyAsksToUnlockAndMarkReadDoesNot() {
        poster.show(plan(CHAT))
        val actions = shown().single().actions
        assertEquals(listOf("Responder", "Marcar leído"), actions.map { it.title.toString() })
        assertTrue(actions[0].isAuthenticationRequired)
        assertFalse(actions[1].isAuthenticationRequired)
        assertTrue(actions[0].remoteInputs.isNotEmpty())
        assertTrue(actions[1].remoteInputs.isNullOrEmpty())
        // The approval buttons keep asking to unlock.
        poster.show(plan(APPROVAL_NOTE))
        assertTrue(shown().single { it.channelId == "orb-approvals" }.actions.all { it.isAuthenticationRequired })
    }

    @Test fun theTaskNoticeOnlyOpensTheApp() {
        poster.show(plan(TASK_NOTE))
        val n = shown().single()
        assertEquals("orb-approvals", n.channelId)
        // Its button is an activity intent (it opens Orb), never a broadcast to the receiver that acts.
        assertTrue(n.actions.all { shadowOf(it.actionIntent).isActivity })
    }

    @Test fun cancellingTakesTheNoticeAndItsJobsAway() {
        val p = plan(CHAT)
        poster.show(p)
        val token = shadowOf(shown().single().actions[1].actionIntent).savedIntent.getStringExtra(NoteIntents.EXTRA_TOKEN)
        assertNotNull(jobs.peek(token))
        poster.cancel(p.id)
        assertTrue(shown().isEmpty())
        assertNull(jobs.peek(token))
    }
}

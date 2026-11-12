package dev.orb.app.notify

import dev.orb.app.link.api.PcCaller
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkEvent
import dev.orb.app.link.net.LinkException
import dev.orb.app.ui.notes.NoticeTarget
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

private fun json(s: String) = Json.parseToJsonElement(s)

private val MESSAGE = """{"key":"conversation:5","id":27091,"route":{"view":"chat","id":5},"kind":"message","title":"Revisar pasarela","body":"¿Lo subo?","hidden":false,"actions":[{"id":"reply","title":"Responder","input":true}],"silent":false}"""
private val APPROVAL = """{"key":"session:s1","kind":"approval","title":"Claude Code","body":"npm install","route":{"view":"chat"},"card":{"method":"sessions.approve","id":"s1","request":"r9"},"actions":[{"id":"deny","title":"Rechazar"},{"id":"allow","title":"Aprobar"}]}"""
private val HIDDEN_APPROVAL = """{"key":"session:s1","kind":"approval","title":"Orb","body":"Tienes un mensaje nuevo","hidden":true,"route":{"view":"chat"},"card":{"method":"sessions.approve","id":"s1","request":"r9"},"actions":[{"id":"deny","title":"Rechazar","open":true},{"id":"allow","title":"Aprobar","open":true}]}"""
private val TASK = """{"key":"task:7","kind":"task","title":"Tarea 7","body":"Espera","card":{"method":"tasks.approve","task":7},"route":{"view":"chat"},"actions":[{"id":"allow","title":"Aprobar","open":true}]}"""

class NotePlannerTest {
    private fun plan(raw: String, settings: NotifySettings = NotifySettings()) = NotePlanner.plan(PcNotes.parse(json(raw))!!, settings)

    @Test fun idsFollowTheDesktopHash() {
        assertEquals(20626, PcNotes.idOf("orb"))
        assertEquals(27091, PcNotes.idOf("conversation:5"))
        assertEquals(21901, PcNotes.idOf("session:abc-é😀"))
        assertEquals(27091, PcNotes.parse(json("""{"key":"conversation:5"}"""))!!.id)
    }

    @Test fun aMessageGetsAReplyThatSendsToItsChat() {
        val p = plan(MESSAGE)
        assertEquals(NoteChannel.Messages, p.channel)
        assertEquals("Revisar pasarela", p.title)
        assertEquals(27091, p.id)
        val reply = p.actions.single()
        assertTrue(reply.input)
        assertEquals("Responder", reply.label)
        assertEquals("chat.send", reply.job.method)
        assertEquals("text", reply.job.textParam)
        assertEquals("5", reply.job.params!!["conversation"].toString())
        assertEquals(JobTarget("chat", "conversation", "5"), p.tap.target)
    }

    @Test fun aReplyToTheMainChatNamesNoConversation() {
        val p = plan("""{"key":"orb","route":{"view":"chat"},"actions":[{"id":"reply","title":"Responder","input":true}]}""")
        assertTrue(p.actions.single().job.params!!.isEmpty())
        assertEquals(JobTarget("chats"), p.tap.target)
    }

    @Test fun anApprovalIsAnsweredFromTheNotification() {
        val p = plan(APPROVAL)
        assertEquals(NoteChannel.Approvals, p.channel)
        assertEquals(listOf("Rechazar", "Aprobar"), p.actions.map { it.label })
        val allow = p.actions[1].job
        assertEquals("sessions.approve", allow.method)
        assertEquals("allow", (allow.params!!["decision"] as JsonPrimitive).content)
        assertEquals("r9", (allow.params!!["request"] as JsonPrimitive).content)
        assertEquals(JobTarget("chat", "session", "s1"), allow.target)
        assertEquals("deny", (p.actions[0].job.params!!["decision"] as JsonPrimitive).content)
    }

    @Test fun aTokenFromThePcWinsOverALocalCall() {
        val p = plan(APPROVAL.dropLast(1) + ""","acts":{"allow":"tk-a","deny":"tk-d"}}""")
        assertEquals("tk-a", p.actions[1].job.token)
        assertNull(p.actions[1].job.method)
    }

    @Test fun buttonsThatMustOpenTheAppDoNotAct() {
        val hidden = plan(HIDDEN_APPROVAL)
        assertTrue(hidden.actions.none { it.job.acts })
        val task = plan(TASK)
        assertFalse(task.actions.single().job.acts)
        assertEquals(JobTarget("task", id = "7"), task.actions.single().job.target)
        assertEquals(JobTarget("task", id = "7"), task.tap.target)
    }

    @Test fun lockScreenContentIsPrivateUnlessAskedOtherwise() {
        val p = plan(MESSAGE)
        assertFalse(p.lockScreenPublic)
        assertEquals("Tienes un mensaje nuevo", p.publicText)
        assertEquals("Orb necesita tu respuesta", plan(APPROVAL).publicText)
        assertTrue(plan(MESSAGE, NotifySettings(lockScreenPublic = true)).lockScreenPublic)
    }

    @Test fun nothingWithoutAKeyAndAtMostThreeButtons() {
        assertNull(PcNotes.parse(json("""{"title":"x"}""")))
        assertNull(PcNotes.parse(JsonPrimitive("x")))
        val many = plan("""{"key":"k","actions":[{"id":"a"},{"id":"b"},{"id":"c"},{"id":"d"}]}""")
        assertEquals(3, many.actions.size)
    }
}

class NoteJobsTest {
    private var now = 1_000L
    private var n = 0
    private val jobs = NoteJobs(MemoryJobStorage(), { now }, { "t${n++}" })
    private fun job(group: Int, action: String = "allow") = NoteJob(group, action, "T", method = "m")

    @Test fun aJobIsUsedOnceAndItsSiblingsGoWithIt() {
        val a = jobs.keep(job(1, "allow"))
        val b = jobs.keep(job(1, "deny"))
        val other = jobs.keep(job(2))
        assertNotNull(jobs.take(a))
        assertNull(jobs.take(a))
        assertNull(jobs.peek(b))
        assertNotNull(jobs.peek(other))
    }

    @Test fun peekDoesNotUseTheJob() {
        val a = jobs.keep(job(1))
        assertNotNull(jobs.peek(a))
        assertNotNull(jobs.take(a))
    }

    @Test fun aJobOlderThanADayIsRefused() {
        val a = jobs.keep(job(1))
        now += 24L * 3_600_000 + 1
        assertNull(jobs.take(a))
        assertNull(jobs.peek(a))
    }

    @Test fun unknownTokensAndForgottenJobsGiveNothing() {
        val a = jobs.keep(job(1))
        assertNull(jobs.take("nope"))
        assertNull(jobs.take(null))
        jobs.forgetAll()
        assertNull(jobs.take(a))
    }

    @Test fun aNewerNoteReplacesTheJobsOfItsNotification() {
        val a = jobs.keep(job(1))
        jobs.drop(1)
        assertNull(jobs.peek(a))
    }
}

private class FakePoster : NotePoster {
    val shown = mutableListOf<NotificationPlan>()
    val said = mutableListOf<String>()
    var cleared = 0
    override fun show(plan: NotificationPlan) { shown += plan }
    override fun say(job: NoteJob, text: String, goneAfterMs: Long?) { said += text }
    override fun clearNotes() { cleared++ }
}

class NotifierTest {
    private val poster = FakePoster()
    private var foreground = false
    private val logs = mutableListOf<String>()
    private val notifier = Notifier(kotlinx.coroutines.flow.emptyFlow(), { NotifySettings() }, { foreground }, poster, logs::add)
    private fun note(raw: String, name: String = "note") = LinkEvent(name, json(raw))

    @Test fun aNoteBecomesANotification() {
        notifier.handle(note(MESSAGE))
        assertEquals(1, poster.shown.size)
        assertEquals(27091, poster.shown[0].id)
    }

    @Test fun nothingIsShownWhileTheAppIsInFront() {
        foreground = true
        notifier.handle(note(MESSAGE))
        assertTrue(poster.shown.isEmpty())
    }

    @Test fun logsNeverCarryTheText() {
        notifier.handle(note(MESSAGE))
        assertTrue(logs.none { it.contains("pasarela") || it.contains("subo") })
    }

    @Test fun backInFrontClearsTheTray() {
        notifier.onForeground()
        assertEquals(1, poster.cleared)
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    @Test fun onlyNoteEventsAreListenedTo() = runTest {
        val n = Notifier(kotlinx.coroutines.flow.flowOf(note(MESSAGE, "other"), note(MESSAGE)), { NotifySettings() }, { false }, poster)
        n.start(this).join()
        assertEquals(1, poster.shown.size)
    }
}

private class FakeCaller(var result: Result<JsonElement> = Result.success(JsonNull)) : PcCaller {
    val calls = mutableListOf<Pair<String, JsonObject>>()
    val tokens = mutableListOf<String>()
    override suspend fun call(method: String, params: JsonObject): Result<JsonElement> { calls += method to params; return result }
    override fun supports(method: String) = true
    override suspend fun noteAction(token: String): Result<Unit> { tokens += token; return result.map { } }
}

@OptIn(ExperimentalCoroutinesApi::class)
class NoteActionRunnerTest {
    private val jobs = NoteJobs(MemoryJobStorage())
    private val caller = FakeCaller()
    private var locked = false
    private var linked = true
    private val runner = NoteActionRunner(jobs, { if (linked) caller else null }, { locked })
    private fun planFor(raw: String) = NotePlanner.plan(PcNotes.parse(json(raw))!!, NotifySettings())
    private fun token(raw: String, i: Int) = jobs.keep(planFor(raw).actions[i].job)

    @Test fun aReplyIsSentWithTheTypedText() = runTest {
        val (job, outcome) = runner.run(token(MESSAGE, 0), "  Sí, súbelo ")!!
        assertTrue(outcome is NoteOutcome.Sent)
        assertEquals("Revisar pasarela", job.title)
        val (method, params) = caller.calls.single()
        assertEquals("chat.send", method)
        assertEquals("Sí, súbelo", (params["text"] as JsonPrimitive).content)
        assertEquals("5", params["conversation"].toString())
    }

    @Test fun anEmptyReplyDoesNothingAndKeepsTheButton() = runTest {
        val t = token(MESSAGE, 0)
        assertTrue(runner.run(t, "   ")!!.second is NoteOutcome.NothingTyped)
        assertTrue(caller.calls.isEmpty())
        assertNotNull(jobs.peek(t))
    }

    @Test fun approveAndRejectCallTheDecision() = runTest {
        assertTrue(runner.run(token(APPROVAL, 1), null)!!.second is NoteOutcome.Allowed)
        assertTrue(runner.run(token(APPROVAL, 0), null)!!.second is NoteOutcome.Denied)
        assertEquals(listOf("sessions.approve", "sessions.approve"), caller.calls.map { it.first })
    }

    @Test fun aButtonWithAPcTokenUsesNoteAction() = runTest {
        val p = NotePlanner.plan(PcNotes.parse(json(APPROVAL.dropLast(1) + ""","acts":{"allow":"tk-a"}}"""))!!, NotifySettings())
        assertTrue(runner.run(jobs.keep(p.actions[1].job), null)!!.second is NoteOutcome.Allowed)
        assertEquals(listOf("tk-a"), caller.tokens)
        assertTrue(caller.calls.isEmpty())
    }

    @Test fun aLockedPhoneDoesNothingAndKeepsTheJob() = runTest {
        locked = true
        val t = token(APPROVAL, 1)
        assertTrue(runner.run(t, null)!!.second is NoteOutcome.Locked)
        assertTrue(caller.calls.isEmpty())
        assertNotNull(jobs.peek(t))
    }

    @Test fun aTokenWorksOnlyOnce() = runTest {
        val t = token(APPROVAL, 1)
        runner.run(t, null)
        assertNull(runner.run(t, null))
        assertEquals(1, caller.calls.size)
    }

    @Test fun anOpenButtonIsNotRunHere() = runTest {
        assertNull(runner.run(jobs.keep(planFor(TASK).actions[0].job), null))
        assertTrue(caller.calls.isEmpty())
    }

    @Test fun failuresSayWhy() = runTest {
        caller.result = Result.failure(LinkException(LinkError.Offline))
        assertEquals("No se pudo: No se pudo llegar al PC.", runner.run(token(APPROVAL, 1), null)!!.second.text)
        caller.result = Result.failure(LinkException(LinkError.Refused(403, "denegado")))
        assertEquals("No se pudo: denegado", runner.run(token(APPROVAL, 1), null)!!.second.text)
    }

    @Test fun anUnlinkedPhoneFailsWithoutCalling() = runTest {
        linked = false
        assertTrue(runner.run(token(APPROVAL, 1), null)!!.second is NoteOutcome.Failed)
        assertTrue(caller.calls.isEmpty())
    }

    @Test fun targetsMapBackToTheApp() {
        assertEquals(NoticeTarget.Chat("session", "s1"), JobTarget("chat", "session", "s1").toNotice())
        assertEquals(NoticeTarget.Task(7), JobTarget("task", id = "7").toNotice())
        assertNull(JobTarget("task", id = "x").toNotice())
    }
}

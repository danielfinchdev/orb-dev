package dev.orb.app.notify

import dev.orb.app.link.api.PcCaller
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

private fun js(s: String) = Json.parseToJsonElement(s)

private class ButtonCaller : PcCaller {
    val calls = mutableListOf<String>()
    override suspend fun call(method: String, params: JsonObject): Result<JsonElement> { calls += method; return Result.success(JsonNull) }
    override fun supports(method: String) = true
    override suspend fun noteAction(token: String): Result<Unit> { calls += "token:$token"; return Result.success(Unit) }
}

/** Which kinds may carry buttons that act, and that nothing the PC sends can make a button local. */
class NoteButtonsTest {
    private fun plan(raw: String, settings: NotifySettings = NotifySettings()) = NotePlanner.plan(PcNotes.parse(js(raw))!!, settings)

    private val everything = """"card":{"method":"sessions.approve","id":"s1","request":"r9"},"acts":{"allow":"tok-a","deny":"tok-d"},"route":{"view":"chat","id":5},"actions":[{"id":"allow","title":"Aprobar"},{"id":"deny","title":"Rechazar"},{"id":"reply","title":"Responder","input":true}]"""

    @Test fun anUnknownKindWithTokensAndACardGetsNoButtons() {
        val p = plan("""{"key":"gizmo:1","kind":"gizmo","title":"X","body":"y",$everything}""")
        assertTrue(p.actions.isEmpty())
        assertEquals(NoteChannel.Messages, p.channel)
        assertEquals("Tienes un aviso nuevo", p.publicText)
    }

    @Test fun aMisspelledKindIsTreatedLikeAnUnknownOne() {
        for (kind in listOf("Approval", "approvals", "", " approval", "aprobación")) {
            assertTrue(kind, plan("""{"key":"k","kind":"$kind","title":"X","body":"y",$everything}""").actions.isEmpty())
        }
    }

    @Test fun theInformationKindsNeverCarryButtons() {
        for (kind in listOf("done", "held", "limit", "update")) {
            assertTrue(kind, plan("""{"key":"k","kind":"$kind","title":"X","body":"y",$everything}""").actions.isEmpty())
        }
    }

    @Test fun aMessageOnlyKeepsReplyAndMarkAsRead() {
        val p = plan("""{"key":"conversation:5","nid":3,"kind":"message","title":"X","body":"y",$everything}""")
        assertEquals(listOf("Responder", "Marcar leído"), p.actions.map { it.label })
        assertEquals("chat.send", p.actions[0].job.method)
        assertNull(p.actions[0].job.token)
    }

    @Test fun anApprovalOnlyKeepsAllowAndDeny() {
        val p = plan("""{"key":"session:s1","kind":"approval","title":"X","body":"y",$everything}""")
        assertEquals(listOf("Aprobar", "Rechazar"), p.actions.map { it.label })
        assertEquals("tok-a", p.actions[0].job.token)
        assertTrue(p.actions.all { it.job.acts && !it.job.local })
    }

    @Test fun aTaskOnlyOpensTheApp() {
        val p = plan("""{"key":"conversation:5","kind":"task","title":"X","body":"y","card":{"method":"tasks.approve","task":7},"acts":{"allow":"tok-a"},"actions":[{"id":"allow","title":"Aprobar"},{"id":"reply","title":"R","input":true},{"id":"deny","title":"No"}]}""")
        assertEquals(listOf("Aprobar"), p.actions.map { it.label })
        assertFalse(p.actions.single().job.acts)
        assertNull(p.actions.single().job.token)
        assertFalse(p.actions.single().input)
    }

    @Test fun anActionOfThePcWithTheIdReadIsDiscardedAndNeverLocal() {
        val p = plan("""{"key":"conversation:5","nid":3,"kind":"message","title":"X","body":"y","route":{"view":"chat","id":5},"actions":[{"id":"read","title":"Leído por el PC"},{"id":"reply","title":"Responder","input":true}]}""")
        assertEquals(listOf("Responder", "Marcar leído"), p.actions.map { it.label })
        assertEquals(1, p.actions.count { it.job.local })
        assertTrue(p.actions.last().job.local)
        val approval = plan("""{"key":"session:s1","kind":"approval","title":"X","body":"y","actions":[{"id":"read","title":"Leído"}]}""")
        assertTrue(approval.actions.isEmpty())
    }

    @Test fun onlyTheAppsOwnButtonIsLocalAndItIsMarkedByItsOwnField() = runTest {
        val jobs = NoteJobs(MemoryJobStorage())
        val viaId = NoteJob(1, "read", "T")
        assertFalse(viaId.local)
        assertFalse(viaId.acts)
        val token = jobs.keep(viaId)
        // A job whose id is «read» but was not built as the app's button does nothing here.
        assertNull(NoteActionRunner(jobs, { ButtonCaller() }, { false }).run(token, null))
        val own = NoteJob(1, NoteJob.READ, "T", local = true)
        assertTrue(own.acts)
        val caller = ButtonCaller()
        val outcome = NoteActionRunner(jobs, { caller }, { true }).run(jobs.keep(own), null)!!.second
        // It works with the phone locked and calls nothing.
        assertTrue(outcome is NoteOutcome.Read)
        assertTrue(caller.calls.isEmpty())
    }

    @Test fun markAsReadCarriesTheChatKeyOfTheNotification() {
        val p = plan("""{"key":"conversation:5","nid":3,"kind":"message","title":"X","body":"y","route":{"view":"chat","id":5}}""")
        assertEquals("conversation:5", p.actions.last().job.chat)
        assertEquals("conversation:5", p.tap.chat)
    }

    @Test fun withTheAppLockNothingActs() {
        val p = plan("""{"key":"session:s1","kind":"approval","title":"X","body":"y",$everything}""", NotifySettings(appLock = true))
        assertTrue(p.actions.isEmpty())
    }
}

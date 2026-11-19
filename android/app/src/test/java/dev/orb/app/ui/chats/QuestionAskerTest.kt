package dev.orb.app.ui.chats

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class QuestionAskerTest {
    private val question = MsgCard.Question(null, "¿Room o DataStore?", emptyList(), false, "pending", null)

    private fun msg(task: Long?) = ChatMessage(1, MsgRole.Orbe, "¿Room o DataStore?", null, question, null, task)

    private fun detail(agent: String?, runner: String? = null) =
        TaskDetail(43, "Borrar build/", "running", agent, "C:/app-movil", emptyList(), null, runner = runner)

    @Test fun aQuestionWithNoTaskIsOrbes() {
        assertEquals("orbe" to "Orbe", questionAsker(msg(null), OrbeChatState()))
    }

    @Test fun aQuestionOfATaskIsTheAgentThatRunsIt() {
        val state = OrbeChatState(taskInfo = mapOf(43L to detail("codex", runner = "claude")))
        assertEquals("claude" to "Claude", questionAsker(msg(43), state))
    }

    @Test fun withoutARunnerItIsTheAgentTheTaskWasAskedFor() {
        val state = OrbeChatState(taskInfo = mapOf(43L to detail("codex")))
        assertEquals("codex" to "Codex", questionAsker(msg(43), state))
    }

    @Test fun anAutomaticAgentOrAnUnreadTaskNeverInventsAName() {
        assertEquals("orbe" to "Orbe", questionAsker(msg(43), OrbeChatState(taskInfo = mapOf(43L to detail("any")))))
        assertEquals("orbe" to "Orbe", questionAsker(msg(43), OrbeChatState()))
    }

    @Test fun theAnswerDraftIsAboutOneQuestionAtATime() {
        val d = AnswerDraft()
        assertFalse(d.active)
        d.take(3)
        d.picked.add("Room")
        assertTrue(d.active)
        d.take(4)
        assertEquals(4L, d.question)
        assertTrue(d.picked.isEmpty())
        assertFalse(d.active)
        d.typing = true
        assertTrue(d.active)
        d.reset()
        assertEquals(null, d.question)
        assertFalse(d.active)
    }
}

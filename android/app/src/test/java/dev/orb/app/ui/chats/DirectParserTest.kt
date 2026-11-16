package dev.orb.app.ui.chats

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

private fun obj(s: String) = dev.orb.app.data.json(s) as kotlinx.serialization.json.JsonObject

class DirectParserTest {
    private fun display(vararg rows: String, decided: Map<Long, String> = emptyMap()) =
        DirectParser.display(rows.mapNotNull { DirectParser.parseRaw(it) }, decided)

    @Test fun userTextAsStringOrObjectWithImagesAndSteer() {
        val items = display(
            sitem(1, "user", "text", jstr("Pon un límite")),
            sitem(2, "user", "text", """{"text":"mira esto","images":["a.png","b.png"]}"""),
            sitem(3, "user", "text", """{"text":"mejor así","steer":true}"""),
        )
        assertEquals(DItem.User(1, "Pon un límite", 0, false, "2026-11-11T09:01:00.000Z"), items[0])
        assertEquals(2, (items[1] as DItem.User).images)
        assertTrue((items[2] as DItem.User).steer)
    }

    @Test fun assistantTextAndReasoning() {
        val items = display(sitem(1, "assistant", "text", jstr("Hecho **ya**")), sitem(2, "assistant", "reasoning", jstr("Primero miro el módulo")))
        assertEquals("Hecho **ya**", (items[0] as DItem.Assistant).text)
        assertEquals("Primero miro el módulo", (items[1] as DItem.Reasoning).text)
    }

    @Test fun aToolAndItsResultAreOneStepAndConsecutiveStepsOneCard() {
        val items = display(
            sitem(1, "tool", "tool", """{"id":"t1","name":"Bash","input":{"command":"npm test"}}"""),
            sitem(2, "tool", "tool_result", """{"id":"t1","output":"32 pasaron"}"""),
            sitem(3, "tool", "file", """{"path":"src/cobro/reintentos.ts","change":"update"}"""),
            sitem(4, "assistant", "text", jstr("Listo")),
        )
        assertEquals(2, items.size)
        val card = items[0] as DItem.Activity
        assertEquals("i:1", card.key)
        assertEquals(2, card.steps.size)
        assertEquals("Ejecutó en el PC", card.steps[0].verb)
        assertEquals("npm test", card.steps[0].target)
        assertEquals("32 pasaron", card.steps[0].output)
        assertFalse(card.steps[0].running)
        assertEquals("Editó", card.steps[1].verb)
        assertEquals("src/cobro/reintentos.ts", card.steps[1].target)
    }

    @Test fun aCallWithoutResultIsRunningAndCarriesItsPresentForm() {
        val step = (display(sitem(1, "tool", "tool", """{"id":"t1","name":"Bash","input":{"command":"npm test"}}"""))[0] as DItem.Activity).steps[0]
        assertTrue(step.running)
        assertEquals("Ejecutando npm test", step.now)
    }

    @Test fun aFailedResultIsMarkedAndOrphanResultsStayVisible() {
        val items = display(
            sitem(1, "tool", "tool", """{"id":"t1","name":"Bash","input":{"command":"make"}}"""),
            sitem(2, "tool", "tool_result", """{"id":"t1","output":"","error":"exit 2"}"""),
            sitem(3, "tool", "tool_result", """{"id":"zz","output":"suelto"}"""),
        )
        val steps = (items[0] as DItem.Activity).steps
        assertTrue(steps[0].failed)
        assertEquals("exit 2", steps[0].output)
        assertEquals("Resultado", steps[1].verb)
        assertEquals("suelto", steps[1].output)
    }

    @Test fun planStatusUsageAndErrorLines() {
        val items = display(
            sitem(1, "assistant", "plan", """[{"content":"Leer el módulo","status":"completed"},{"content":"Escribir la prueba","status":"pending"}]"""),
            sitem(2, "system", "status", jstr("Contexto compactado")),
            sitem(3, "system", "usage", """{"inputTokens":1200,"outputTokens":80}"""),
            sitem(4, "error", "text", jstr("Se cayó la red")),
        )
        val plan = items[0] as DItem.Plan
        assertEquals(listOf(PlanStep("Leer el módulo", true), PlanStep("Escribir la prueba", false)), plan.steps)
        assertEquals("Contexto compactado", (items[1] as DItem.Note).text)
        assertEquals("1200 tokens de entrada · 80 de salida", (items[2] as DItem.Note).text)
        assertEquals("Se cayó la red", (items[3] as DItem.Failure).text)
    }

    @Test fun handoffShowsOneLineNotTheStoredSummary() {
        val summary = "Traspaso: " + "x".repeat(18_000)
        val items = display(sitem(1, "system", "handoff", """{"from":"claude","to":"codex","at":1,"summary":"$summary","count":9,"truncated":true}"""))
        assertEquals("Traspasado de Claude a Codex", (items.single() as DItem.Note).text)
    }

    @Test fun approvalCarriesTheRequestAndTheLocalDecisionWins() {
        val row = sitem(5, "system", "approval", approvalBody())
        val pending = display(row)[0] as DItem.Approval
        assertEquals("r1", pending.request)
        assertTrue(pending.pending)
        assertEquals("Cambia la base de datos de desarrollo.", pending.reason)
        assertEquals("npm run db:migrate -- --env=dev", pending.title)
        assertEquals("allowed", (display(row, decided = mapOf(5L to "allowed"))[0] as DItem.Approval).status)
        assertEquals("denied", (display(sitem(5, "system", "approval", approvalBody(status = "denied")))[0] as DItem.Approval).status)
    }

    @Test fun sessionRowAndQueue() {
        val info = DirectParser.info(obj("""{"id":"s1","title":"T","agent":"claude","model":"opus","status":"running","settled":0,"context":{"used":58,"size":100}}"""))!!
        assertTrue(info.busy)
        assertTrue(info.canSteer)
        assertEquals(58, info.contextPercent)
        assertFalse(DirectParser.info(obj("""{"id":"s1","agent":"cursor"}"""))!!.canSteer)
        assertNull(DirectParser.info(obj("""{"title":"sin id"}""")))
        val q = DirectParser.queue(dev.orb.app.data.json("""[{"id":4,"text":"a","images":[]},{"id":5,"text":"b","images":["x"]}]"""))
        assertEquals(listOf(QueuedMsg(4, "a", 0), QueuedMsg(5, "b", 1)), q)
    }

    @Test fun unknownItemsAreKeptAsNotesAndEmptyOnesDropped() {
        val items = display(sitem(1, "system", "whatever", jstr("algo")), sitem(2, "system", "status", jstr("  ")))
        assertEquals(1, items.size)
        assertEquals("algo", (items[0] as DItem.Note).text)
    }
}

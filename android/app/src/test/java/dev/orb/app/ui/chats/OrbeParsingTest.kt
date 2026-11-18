package dev.orb.app.ui.chats

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class OrbeParsingTest {
    @Test fun rolesAreMapped() {
        assertEquals(MsgRole.User, OrbeParser.parse(raw(1, "usuario", "hola"))!!.role)
        assertEquals(MsgRole.Orbe, OrbeParser.parse(raw(2, "orb", "hola"))!!.role)
        assertEquals(MsgRole.System, OrbeParser.parse(raw(3, "system", "hola"))!!.role)
        assertNull(OrbeParser.parse("""{"body":"sin id"}"""))
        assertNull(OrbeParser.parse("no es json"))
    }

    @Test fun questionMetaKeepsOptionsAndState() {
        val q = OrbeParser.parse(raw(4, "orb", "?", questionMeta()))!!.card as MsgCard.Question
        assertTrue(q.pending)
        assertEquals(listOf("IndexedDB", "localStorage"), q.options.map { it.label })
        assertEquals("Guarda más datos", q.options[0].description)
        val done = OrbeParser.parse(raw(4, "orb", "?", questionMeta("answered", "IndexedDB")))!!.card as MsgCard.Question
        assertEquals("IndexedDB", done.answer)
        assertEquals(false, done.pending)
    }

    @Test fun reportMeta() {
        val r = OrbeParser.parse(raw(5, "orb", "Informe", """{"kind":"report","tasks":[42,43],"project":"x","accepted":true}"""))!!.card as MsgCard.Report
        assertEquals(listOf(42L, 43L), r.tasks)
        assertTrue(r.accepted)
    }

    @Test fun otherCardsAndUnknownKinds() {
        assertTrue(OrbeParser.parse(raw(6, "system", "a", """{"kind":"attention","task":42}"""))!!.card is MsgCard.TaskAttention)
        assertTrue(OrbeParser.parse(raw(7, "system", "a", """{"kind":"task-end","result":"largo"}"""))!!.card is MsgCard.TaskEnd)
        assertTrue(OrbeParser.parse(raw(8, "orb", "a", """{"kind":"games"}"""))!!.card is MsgCard.None)
        val p = OrbeParser.parse(raw(9, "system", "a", """{"kind":"approval","session":"s","request":"r"}"""))!!.card as MsgCard.Permission
        assertEquals("expired", p.status)
    }

    @Test fun clientIdEchoIsRead() {
        assertEquals("c1", OrbeParser.parse(raw(1, "usuario", "x", extra = ",\"clientId\":\"c1\""))!!.clientId)
    }

    @Test fun toolsAreSaidLikeThePcSaysThem() {
        assertEquals("Leyendo store.ts", ToolText.step("Read", "store.ts"))
        assertEquals("Leyendo archivos", ToolText.step("Read", ""))
        assertEquals("Ejecutando npm test", ToolText.step("Bash", "npm test"))
        assertEquals("Preparando una pregunta", ToolText.step("mcp__orb__orb_ask", null))
        assertEquals("Usando una herramienta", ToolText.step("server_tool_name", null))
        assertEquals("1 min 3 s", elapsedText(63_000))
    }

    @Test fun aLineKeepsTheTaskItIsAbout() {
        assertEquals(42L, OrbeParser.parse(raw(10, "system", "Tarea #42 creada", """{"task":42}"""))!!.task)
        assertNull(OrbeParser.parse(raw(11, "orb", "hola"))!!.task)
    }

    @Test fun theBrainIsReadFromChatSettingsWithoutInventingAnything() {
        val info = OrbeParser.brain(dev.orb.app.data.json("""{"agent":"claude","agentLabel":"Claude Code","modelLabel":"Opus","reasoning":"high","conversation":7}"""))!!
        assertEquals("Opus · alto", info.label)
        assertEquals("Claude Code · medio", OrbeParser.brain(dev.orb.app.data.json("""{"agentLabel":"Claude Code","reasoning":"medium"}"""))!!.label)
        assertEquals("Opus", OrbeParser.brain(dev.orb.app.data.json("""{"modelLabel":"Opus"}"""))!!.label)
        assertEquals("GPT · extra", OrbeParser.brain(dev.orb.app.data.json("""{"modelLabel":"GPT","reasoning":"xhigh"}"""))!!.label)
        assertNull(OrbeParser.brain(dev.orb.app.data.json("""{"conversation":7}""")))
        assertNull(OrbeParser.brain(dev.orb.app.data.json("""[]""")))
        assertNull(OrbeParser.brain(null))
    }

    @Test fun liveTasksCarryWhatEachOneIsDoing() {
        val tasks = OrbeParser.liveTasks(
            dev.orb.app.data.json(
                """[{"id":42,"title":"Registro","agent":"codex","last":"Leyendo src/push.ts","note":"nota","percent":40,"waiting":0},
                    {"id":43,"title":"Otra","agent":"claude","note":"Probando","waiting":1},{"title":"sin id"}]""",
            ),
        )
        assertEquals(listOf(42L, 43L), tasks.map { it.id })
        assertEquals("Leyendo src/push.ts", tasks[0].doing)
        assertEquals(40, tasks[0].percent)
        assertEquals(false, tasks[0].waiting)
        assertEquals("Probando", tasks[1].doing)
        assertEquals(true, tasks[1].waiting)
        assertEquals(emptyList<LiveTask>(), OrbeParser.liveTasks(null))
    }
}

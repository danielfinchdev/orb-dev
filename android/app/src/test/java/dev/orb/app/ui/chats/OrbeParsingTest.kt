package dev.orb.app.ui.chats

import dev.orb.app.data.json
import dev.orb.app.ui.tasks.TaskAction
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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

    // ---------- tasks.get for a card, tasks.diff {stat}, chat.queue ----------

    private fun task(
        status: String = "done", extra: String = "", hash: String = """"previewHash":"h1",""",
        events: String = """[{"actor":"orb","kind":"task.created","detail":"queued","at":"x"}]""",
    ) = json(
        """{"id":42,"title":"Registro","status":"$status","assigned_to":"codex","project_path":"C:/app-movil","folderNow":"C:/app-movil","model":"gpt","sensitivity":[],"agent":"codex","description":"Añade el registro de notificaciones.",$hash
        "autonomy":"auto","approval":{"required":false,"signed":false},"hasCheckpoint":true,"accepted":false,
        "review":{"task":43,"verdict":"ok","agent":"claude"},"events":$events$extra}""",
    )

    private val allMethods: (dev.orb.app.link.api.ApiMethod) -> Boolean = { true }

    @Test fun aCardReadsTheTaskAsOneAnswerWithItsFingerprint() {
        val d = OrbeParser.taskDetail(task(), 42, allMethods)!!
        assertEquals("h1", d.hash)
        assertEquals("codex", d.agent)
        assertEquals("C:/app-movil", d.project)
        assertEquals("auto", d.autonomy)
        assertEquals(false, d.approvalRequired)
        assertEquals("claude", d.reviewAgent)
        assertNull(OrbeParser.taskDetail(json("[]"), 42, allMethods))
    }

    @Test fun theFolderTheHashCoversComesFromTheCurrentFolderThePcSays() {
        val same = OrbeParser.taskDetail(task(status = "awaiting_approval"), 42, allMethods)!!
        assertEquals("C:/app-movil", same.folderNow)
        assertFalse(same.folderChanged)
        assertTrue(same.approvable)
        val moved = OrbeParser.taskDetail(json(task(status = "awaiting_approval").toString().replace(""""folderNow":"C:/app-movil"""", """"folderNow":"C:/otra"""")), 42, allMethods)!!
        assertTrue(moved.folderChanged)
        assertEquals("C:/otra", moved.folderShown)
        assertEquals("C:/app-movil", moved.project)
        assertTrue(moved.approvable)
        val old = OrbeParser.taskDetail(json(task(status = "awaiting_approval").toString().replace(""""folderNow":"C:/app-movil",""", "")), 42, allMethods)!!
        assertNull(old.folderNow)
        assertFalse(old.folderChanged)
        assertFalse(old.approvable)
    }

    @Test fun theTaskScreenShowsTheCurrentFolderWhenThePcSaysIt() {
        val moved = json(task(status = "awaiting_approval").toString().replace(""""folderNow":"C:/app-movil"""", """"folderNow":"C:/otra""""))
        assertEquals("C:/otra", dev.orb.app.ui.tasks.TasksParser.detail(moved)!!.folder)
        val old = json(task(status = "awaiting_approval").toString().replace(""""folderNow":"C:/app-movil",""", ""))
        assertEquals("C:/app-movil", dev.orb.app.ui.tasks.TasksParser.detail(old)!!.folder)
    }

    @Test fun aFinishedTaskOffersChangesUndoAndAcceptWhereThePcHasThem() {
        val d = OrbeParser.taskDetail(task(), 42, allMethods)!!
        assertTrue(setOf(TaskAction.SeeChanges, TaskAction.UndoHeld, TaskAction.AcceptHeld).all { it in d.actions })
        // A PC without tasks.undo / tasks.accept / tasks.diff offers none of them.
        val none = OrbeParser.taskDetail(task(), 42) { false }!!
        assertTrue(none.actions.isEmpty())
        val noUndo = OrbeParser.taskDetail(task(), 42) { it != dev.orb.app.link.api.ApiMethods.TASKS_UNDO }!!
        assertTrue(TaskAction.UndoHeld !in noUndo.actions && TaskAction.AcceptHeld in noUndo.actions)
    }

    @Test fun acceptedOrUndoneTasksDoNotOfferTheSameAgain() {
        val accepted = OrbeParser.taskDetail(json(task().toString().replace(""""accepted":false""", """"accepted":true""")), 42, allMethods)!!
        assertTrue(accepted.accepted && TaskAction.AcceptHeld !in accepted.actions && TaskAction.UndoHeld in accepted.actions)
        val undone = OrbeParser.taskDetail(task(extra = ""","undone":{"at":"x"}"""), 42, allMethods)!!
        assertTrue(undone.undone && TaskAction.UndoHeld !in undone.actions && TaskAction.SeeChanges !in undone.actions)
    }

    @Test fun aTaskThatWaitsOffersTheOkOnlyWithAFingerprintAndNeverAcceptOrUndo() {
        val waiting = OrbeParser.taskDetail(task(status = "awaiting_approval"), 42, allMethods)!!
        assertTrue(TaskAction.Approve in waiting.actions)
        assertTrue(waiting.approvable)
        assertTrue(TaskAction.AcceptHeld !in waiting.actions && TaskAction.UndoHeld !in waiting.actions)
        val noHash = OrbeParser.taskDetail(task(status = "awaiting_approval", hash = ""), 42, allMethods)!!
        assertNull(noHash.hash)
        assertFalse(noHash.approvable)
        assertTrue(TaskAction.Approve !in noHash.actions)
    }

    @Test fun theLastDecisionComesFromTheTasksHistory() {
        val approved = OrbeParser.taskDetail(task(events = """[{"kind":"approval.required"},{"kind":"task.approved"}]"""), 42, allMethods)!!
        assertEquals("approved", approved.decision)
        val rejected = OrbeParser.taskDetail(task(events = """[{"kind":"task.approved"},{"kind":"approval.required"},{"kind":"task.rejected"}]"""), 42, allMethods)!!
        assertEquals("rejected", rejected.decision)
        val again = OrbeParser.taskDetail(task(events = """[{"kind":"task.approved"},{"kind":"approval.required"}]"""), 42, allMethods)!!
        assertNull(again.decision)
        assertNull(OrbeParser.taskDetail(task(), 42, allMethods)!!.decision)
    }

    @Test fun theStatIsReadWithToleranceAndNeverTrustedWhenItLooksLikeAFullDiff() {
        val ok = json("""{"available":true,"files":[{"status":"M","path":"a.kt","added":40,"removed":5},{"status":"A","path":"b.kt","added":2,"removed":2},{"status":"M","path":"img.png","binary":true}],"more":0,"hidden":0}""")
        assertEquals(TaskStat(3, 42, 7), OrbeParser.taskStat(ok))
        // Cut list: the files are counted with what was cut, the lines are not claimed.
        val cut = json("""{"available":true,"files":[{"status":"M","path":"a.kt","added":1,"removed":1}],"more":299}""")
        assertEquals(TaskStat(300, null, null), OrbeParser.taskStat(cut))
        // An older PC ignores `stat` and answers with whole patches.
        val old = json("""{"available":true,"files":[{"status":"M","path":"a.kt","added":1,"removed":1,"patch":"@@ -1 +1 @@
-a
+b
"}],"more":0}""")
        assertTrue(OrbeParser.taskStat(old)!!.unreadable)
        assertEquals("nogit", OrbeParser.taskStat(json("""{"available":false,"reason":"nogit","files":[],"more":0}"""))!!.reason)
        assertNull(OrbeParser.taskStat(json("""{"available":true,"files":[],"more":0}""")))
        assertTrue(OrbeParser.taskStat(json("""[1,2]"""))!!.unreadable)
        assertNull(OrbeParser.taskStat(null))
        // Missing numbers are zero, not a crash.
        assertEquals(TaskStat(1, 0, 0), OrbeParser.taskStat(json("""{"available":true,"files":[{"path":"x"}]}""")))
    }

    @Test fun theQueueIsReadInOrderAndDropsWhatHasNoId() {
        val q = OrbeParser.queue(json("""[{"id":"a","text":"uno","at":1000},{"text":"sin id","at":2},{"id":"b","text":"dos","at":3000}]"""))
        assertEquals(listOf(OrbeQueued("a", "uno", 1000), OrbeQueued("b", "dos", 3000)), q)
        assertEquals(emptyList<OrbeQueued>(), OrbeParser.queue(json("""[]""")))
        assertEquals(emptyList<OrbeQueued>(), OrbeParser.queue(json("""{"a":1}""")))
        assertEquals(emptyList<OrbeQueued>(), OrbeParser.queue(null))
    }

    @Test fun theCardLineSaysWhoWhereAndWhy() {
        assertEquals("Codex (gpt) · C:/app-movil · elimina datos", ChatTexts.approvalLine("Codex", "gpt", "C:/app-movil", listOf("destructive")))
        assertEquals("Codex", ChatTexts.approvalLine("Codex", null, null, emptyList()))
    }
}

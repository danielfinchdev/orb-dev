package dev.orb.app.ui.web

import dev.orb.app.link.api.ApiMethod
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkException
import dev.orb.app.link.net.PcVersions
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class WhiteboardMessagesTest {
    private val rect = """{"id":"a","type":"rectangle","x":1}"""
    private fun save(extra: String = "", elements: String = "[$rect]") = """{"type":"save","elements":$elements$extra}"""

    @Test fun theThreeKnownMessagesAreAccepted() {
        assertEquals(WhiteboardMessage.Load, WhiteboardMessages.parse("""{"type":"load"}"""))
        assertEquals(WhiteboardMessage.Close, WhiteboardMessages.parse("""{"type":"close"}"""))
        val s = WhiteboardMessages.parse(save(""","png":"data:image/png;base64,AAAA","flush":true""")) as WhiteboardMessage.Save
        assertEquals(1, s.elements.size)
        assertEquals("data:image/png;base64,AAAA", s.png)
        assertTrue(s.flush)
    }

    @Test fun unknownOrBrokenMessagesAreDropped() {
        for (raw in listOf(null, "", "nope", "[]", "42", """{"type":"open","url":"https://x"}""", """{"type":"eval"}""", """{"type":7}""", """{}""")) {
            assertNull("must be dropped: $raw", WhiteboardMessages.parse(raw))
        }
    }

    @Test fun anOversizedOrUnreadableSaveIsRejectedNotSilentlyLost() {
        val big = save(""","png":"data:image/png;base64,${"A".repeat(WhiteboardMessages.MAX_MESSAGE_CHARS)}"""")
        assertEquals(WhiteboardMessage.Rejected, WhiteboardMessages.parse(big))
        assertEquals(WhiteboardMessage.Rejected, WhiteboardMessages.parse("""{"type":"save"}"""))
        assertEquals(WhiteboardMessage.Rejected, WhiteboardMessages.parse("""{"type":"save","elements":{"a":1}}"""))
    }

    @Test fun theFlushedAnswerIsKnown() {
        assertEquals(WhiteboardMessage.Flushed, WhiteboardMessages.parse("""{"type":"flushed"}"""))
    }

    @Test fun onlyTheUnsupportedElementsAreRemovedAndCounted() {
        val mixed = """[$rect,{"id":"b","type":"embeddable"},{"id":"c","type":"iframe"},"x",{"type":"rectangle"}]"""
        val s = WhiteboardMessages.parse(save(elements = mixed)) as WhiteboardMessage.Save
        assertEquals(1, s.elements.size)
        assertEquals(4, s.dropped)
        val many = (1..WhiteboardMessages.MAX_ELEMENTS + 1).joinToString(",", "[", "]") { """{"id":"e$it","type":"line"}""" }
        assertEquals(WhiteboardMessage.Rejected, WhiteboardMessages.parse(save(elements = many)))
    }

    @Test fun picturesMustBeSmallDataImages() {
        val ok = save(""","files":{"f-1":{"mimeType":"image/png","dataURL":"data:image/png;base64,AAAA"}}""")
        val s = WhiteboardMessages.parse(ok) as WhiteboardMessage.Save
        assertEquals(setOf("f-1"), s.files.keys)
        assertEquals(setOf("f-1"), s.offered)
        for (bad in listOf(
            """"f":{"dataURL":"https://evil.test/x.png"}""",
            """"f":{"dataURL":"data:text/html;base64,AAAA"}""",
            """"f":{"dataURL":"data:image/x-icon;base64,AAAA"}""",
            """"../x":{"dataURL":"data:image/png;base64,AAAA"}""",
            """"f":{"mimeType":"image/png"}""",
            """"f":"data:image/png;base64,AAAA"""",
        )) {
            // The drawing still travels; only the picture is left out and counted.
            val r = WhiteboardMessages.parse(save(""","files":{$bad}""")) as WhiteboardMessage.Save
            assertTrue("must be left out: $bad", r.files.isEmpty())
            assertEquals(1, r.dropped)
        }
        val huge = """"f":{"dataURL":"data:image/png;base64,${"A".repeat(WhiteboardMessages.MAX_FILE_CHARS)}"}"""
        assertTrue((WhiteboardMessages.parse(save(""","files":{$huge}""")) as WhiteboardMessage.Save).files.isEmpty())
        val tooMany = (1..WhiteboardMessages.MAX_FILES + 1).joinToString(",") { """"f$it":{"dataURL":"data:image/png;base64,AA"}""" }
        assertEquals(WhiteboardMessage.Rejected, WhiteboardMessages.parse(save(""","files":{$tooMany}""")))
    }

    private val img = """{"id":"i","type":"image","fileId":"f1"}"""

    @Test fun anImageWhosePictureIsRefusedIsRemovedAndCountedOnce() {
        val bad = ""","files":{"f1":{"dataURL":"data:image/x-icon;base64,AAAA"}}"""
        val r = WhiteboardMessages.parse(save(bad, elements = "[$rect,$img]")) as WhiteboardMessage.Save
        assertEquals(1, r.elements.size)
        assertTrue(r.files.isEmpty())
        assertEquals(1, r.dropped)
        val huge = ""","files":{"f1":{"dataURL":"data:image/png;base64,${"A".repeat(WhiteboardMessages.MAX_FILE_CHARS)}"}}"""
        val h = WhiteboardMessages.parse(save(huge, elements = "[$img]")) as WhiteboardMessage.Save
        assertEquals(0, h.elements.size)
        assertEquals(1, h.dropped)
    }

    @Test fun anImageWhosePictureIsNotInThisMessageIsKept() {
        val r = WhiteboardMessages.parse(save("", elements = "[$img]")) as WhiteboardMessage.Save
        assertEquals(1, r.elements.size)
        assertEquals(0, r.dropped)
        val other = ""","files":{"f2":{"dataURL":"data:image/x-icon;base64,AAAA"}}"""
        assertEquals(1, (WhiteboardMessages.parse(save(other, elements = "[$img]")) as WhiteboardMessage.Save).elements.size)
    }

    @Test fun anImageWithAnAcceptedPictureIsKept() {
        val ok = ""","files":{"f1":{"dataURL":"data:image/png;base64,AAAA"}}"""
        val r = WhiteboardMessages.parse(save(ok, elements = "[$img]")) as WhiteboardMessage.Save
        assertEquals(1, r.elements.size)
        assertEquals(0, r.dropped)
    }

    @Test fun thePictureIsAPngOrEmpty() {
        assertEquals("", (WhiteboardMessages.parse(save(""","png":""""")) as WhiteboardMessage.Save).png)
        assertNull((WhiteboardMessages.parse(save("")) as WhiteboardMessage.Save).png)
        for (bad in listOf(""""https://evil.test/p.png"""", """"data:image/jpeg;base64,AAAA"""", "5")) {
            assertNull((WhiteboardMessages.parse(save(""","png":$bad""")) as WhiteboardMessage.Save).png)
        }
    }

    @Test fun onlyTheThreeSettingsOfTheDrawingTravel() {
        val s = WhiteboardMessages.parse(save(""","appState":{"viewBackgroundColor":"#fff","gridSize":20,"gridModeEnabled":true,"openMenu":"x","collaborators":[1]}""")) as WhiteboardMessage.Save
        assertEquals(setOf("viewBackgroundColor", "gridSize", "gridModeEnabled"), s.appState.keys)
    }

    @Test fun theBridgeExposesOnlyPost() {
        val exposed = WhiteboardBridge::class.java.declaredMethods.filter { m -> m.isAnnotationPresent(android.webkit.JavascriptInterface::class.java) }.map { it.name }
        assertEquals(listOf("post"), exposed)
    }
}

class FakeWhiteboardBackend : WhiteboardBackend {
    val state = MutableStateFlow<ConnectionState>(ConnectionState.Online("http://pc", "PC", PcVersions(1, 1, "3.8.4")))
    override val connection get() = state
    var unavailable: Set<String> = emptySet()
    var projectList = WhiteboardProjects(listOf("tienda", "api"), "tienda")
    var loadResult: Result<JsonObject> = Result.success(buildJsonObject { put("elements", JsonArray(emptyList())); put("attachments", JsonArray(emptyList())) })
    var saveResult: Result<Unit> = Result.success(Unit)
    val loads = ArrayList<String>()
    var noteResult: Result<Unit> = Result.success(Unit)
    val notes = ArrayList<Triple<String, String, String>>()
    val saves = ArrayList<Pair<String, WhiteboardMessage.Save>>()

    override fun available(m: ApiMethod) = m.name !in unavailable
    override suspend fun projects() = Result.success(projectList)
    override suspend fun load(project: String): Result<JsonObject> { loads += project; return loadResult }
    override suspend fun save(project: String, save: WhiteboardMessage.Save): Result<Unit> { saves += project to save; return saveResult }
    override suspend fun note(project: String, file: String, note: String): Result<Unit> { notes += Triple(project, file, note); return noteResult }
}

@OptIn(ExperimentalCoroutinesApi::class)
class WhiteboardViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val online = ConnectionState.Online("http://pc", "PC", PcVersions(1, 1, "3.8.4"))

    @Before fun setUp() = kotlinx.coroutines.Dispatchers.setMain(dispatcher)
    @After fun tearDown() = kotlinx.coroutines.Dispatchers.resetMain()

    private fun TestScope.vm(b: FakeWhiteboardBackend, project: String? = null): WhiteboardViewModel {
        val vm = WhiteboardViewModel(b, project, debounceMs = 2_000)
        backgroundScope.launch { vm.state.collect { } }
        runCurrent()
        return vm
    }

    private fun scene(vararg ids: String, png: String? = null, files: List<String> = emptyList(), flush: Boolean = false) = WhiteboardMessage.Save(
        JsonArray(ids.map { buildJsonObject { put("id", it); put("type", "line") } }),
        JsonObject(emptyMap()),
        JsonObject(files.associateWith { buildJsonObject { put("dataURL", "data:image/png;base64,AA") } }),
        png, flush,
    )

    @Test fun opensTheActiveProjectWithThePagesPartsOnly() = runTest(dispatcher) {
        val b = FakeWhiteboardBackend()
        val vm = vm(b)
        val phase = vm.state.value.phase as WhiteboardPhase.Ready
        assertEquals("tienda", phase.project)
        assertEquals(listOf("tienda"), b.loads)
        assertEquals(setOf("elements"), phase.scene.keys)
    }

    @Test fun anExplicitProjectWins() = runTest(dispatcher) {
        val b = FakeWhiteboardBackend()
        val vm = vm(b, "api")
        assertEquals("api", (vm.state.value.phase as WhiteboardPhase.Ready).project)
    }

    @Test fun withoutAnActiveProjectThePersonChooses() = runTest(dispatcher) {
        val b = FakeWhiteboardBackend().apply { projectList = WhiteboardProjects(listOf("a", "b"), null) }
        val vm = vm(b)
        assertEquals(WhiteboardPhase.Choose(listOf("a", "b")), vm.state.value.phase)
        vm.choose("b")
        runCurrent()
        assertEquals("b", (vm.state.value.phase as WhiteboardPhase.Ready).project)
    }

    @Test fun withoutThePcTheDrawingIsNotOpened() = runTest(dispatcher) {
        val b = FakeWhiteboardBackend().apply { state.value = ConnectionState.Offline(null, null) }
        val vm = vm(b)
        assertEquals(WhiteboardPhase.NeedsPc(), vm.state.value.phase)
        assertTrue(b.loads.isEmpty())
        // The PC comes back: it opens by itself.
        b.state.value = online
        runCurrent()
        assertTrue(vm.state.value.phase is WhiteboardPhase.Ready)
    }

    @Test fun retryOpensWhenThePcAnswers() = runTest(dispatcher) {
        val b = FakeWhiteboardBackend().apply { loadResult = Result.failure(LinkException(LinkError.Offline)) }
        val vm = vm(b)
        assertEquals(WhiteboardPhase.NeedsPc(), vm.state.value.phase)
        b.loadResult = Result.success(JsonObject(emptyMap()))
        vm.retry()
        runCurrent()
        assertTrue(vm.state.value.phase is WhiteboardPhase.Ready)
    }

    @Test fun aPcWithoutThePizarraSaysSo() = runTest(dispatcher) {
        val b = FakeWhiteboardBackend().apply { unavailable = setOf("whiteboard.save") }
        val vm = vm(b)
        assertEquals(WhiteboardPhase.NeedsPc(unsupported = true), vm.state.value.phase)
        assertTrue(b.loads.isEmpty())
    }

    @Test fun changesAreSavedOnceAfterTheDebounce() = runTest(dispatcher) {
        val b = FakeWhiteboardBackend()
        val vm = vm(b)
        vm.onSave(scene("a"))
        advanceTimeBy(1_000); runCurrent()
        vm.onSave(scene("a", "b"))
        advanceTimeBy(1_500); runCurrent()
        assertTrue(b.saves.isEmpty())
        assertEquals(SaveStatus.Saving, vm.state.value.save)
        advanceTimeBy(600); runCurrent()
        assertEquals(1, b.saves.size)
        assertEquals("tienda", b.saves[0].first)
        assertEquals(2, b.saves[0].second.elements.size)
        assertEquals(SaveStatus.Saved, vm.state.value.save)
    }

    @Test fun aFailedSaveIsNotMarkedAsSavedAndKeepsPicturesForTheNextTry() = runTest(dispatcher) {
        val b = FakeWhiteboardBackend().apply { saveResult = Result.failure(LinkException(LinkError.Offline)) }
        val vm = vm(b)
        vm.onSave(scene("a", files = listOf("img1"), png = "data:image/png;base64,P1"))
        advanceTimeBy(2_100); runCurrent()
        assertEquals(SaveStatus.Unsaved, vm.state.value.save)
        // The next change goes with the picture that never arrived.
        b.saveResult = Result.success(Unit)
        vm.onSave(scene("a", "b"))
        advanceTimeBy(2_100); runCurrent()
        val last = b.saves.last().second
        assertEquals(setOf("img1"), last.files.keys)
        assertEquals("data:image/png;base64,P1", last.png)
        assertEquals(2, last.elements.size)
        assertEquals(SaveStatus.Saved, vm.state.value.save)
    }

    @Test fun pendingChangesGoWhenThePcComesBack() = runTest(dispatcher) {
        val b = FakeWhiteboardBackend().apply { saveResult = Result.failure(LinkException(LinkError.Offline)) }
        val vm = vm(b)
        vm.onSave(scene("a"))
        advanceTimeBy(2_100); runCurrent()
        assertEquals(SaveStatus.Unsaved, vm.state.value.save)
        b.saveResult = Result.success(Unit)
        b.state.value = ConnectionState.Offline(null, null)
        runCurrent()
        b.state.value = online
        runCurrent()
        assertEquals(SaveStatus.Saved, vm.state.value.save)
    }

    @Test fun aFlushSavesAtOnce() = runTest(dispatcher) {
        val b = FakeWhiteboardBackend()
        val vm = vm(b)
        vm.onSave(scene("a", flush = true))
        runCurrent()
        assertEquals(1, b.saves.size)
    }

    @Test fun leavingWaitsForTheSaveAndAsksWhenItFails() = runTest(dispatcher) {
        val b = FakeWhiteboardBackend().apply { saveResult = Result.failure(LinkException(LinkError.Offline)) }
        val vm = vm(b)
        var left = 0
        backgroundScope.launch { vm.leave.collect { left++ } }
        vm.onSave(scene("a"))
        vm.requestLeave()
        runCurrent()
        assertEquals(0, left)
        assertTrue(vm.state.value.confirmLeave)
        vm.keepEditing()
        assertFalse(vm.state.value.confirmLeave)
        b.saveResult = Result.success(Unit)
        vm.requestLeave()
        runCurrent()
        assertEquals(1, left)
    }

    @Test fun leavingWithoutSavingDropsTheChanges() = runTest(dispatcher) {
        val b = FakeWhiteboardBackend().apply { saveResult = Result.failure(LinkException(LinkError.Offline)) }
        val vm = vm(b)
        var left = 0
        backgroundScope.launch { vm.leave.collect { left++ } }
        vm.onSave(scene("a"))
        vm.requestLeave()
        runCurrent()
        vm.leaveWithoutSaving()
        runCurrent()
        assertEquals(1, left)
    }

    @Test fun anotherProjectOpensOnlyOnceTheDrawingIsSaved() = runTest(dispatcher) {
        val b = FakeWhiteboardBackend().apply { saveResult = Result.failure(LinkException(LinkError.Offline)) }
        val vm = vm(b)
        val said = ArrayList<String>()
        backgroundScope.launch { vm.messages.collect { said += it } }
        vm.onSave(scene("a"))
        vm.choose("api")
        runCurrent(); vm.onPageFlushed(); runCurrent()
        assertEquals(listOf(WhiteboardTexts.SWITCH_BLOCKED), said)
        assertEquals("tienda", (vm.state.value.phase as WhiteboardPhase.Ready).project)
        b.saveResult = Result.success(Unit)
        vm.choose("api")
        runCurrent(); vm.onPageFlushed(); runCurrent()
        assertEquals("api", (vm.state.value.phase as WhiteboardPhase.Ready).project)
        assertEquals("tienda", b.saves.last().first)
        assertNotNull(b.loads.lastOrNull { it == "api" })
    }

    @Test fun aRecreatedPageGetsTheLatestDrawingNotTheFirstLoad() = runTest(dispatcher) {
        val b = FakeWhiteboardBackend()
        val vm = vm(b)
        assertEquals(0, (vm.sceneForPage()!!["elements"] as JsonArray).size)
        vm.onSave(scene("a", "b", files = listOf("img1")))
        runCurrent()
        // The save has not reached the PC yet (debounce) and the page is recreated: it still sees its own work.
        val again = vm.sceneForPage()!!
        assertEquals(2, (again["elements"] as JsonArray).size)
        assertEquals(setOf("img1"), (again["files"] as JsonObject).keys)
        advanceTimeBy(2_100); runCurrent()
        assertEquals(2, (vm.sceneForPage()!!["elements"] as JsonArray).size)
    }

    @Test fun aRefusedSaveIsShownAndBlocksLeavingUntilTheNextGoodOne() = runTest(dispatcher) {
        val b = FakeWhiteboardBackend()
        val vm = vm(b)
        val said = ArrayList<String>()
        val commands = ArrayList<PageCommand>()
        backgroundScope.launch { vm.messages.collect { said += it } }
        backgroundScope.launch { vm.pageCommands.collect { commands += it } }
        var left = 0
        backgroundScope.launch { vm.leave.collect { left++ } }
        vm.onRejected()
        runCurrent()
        assertEquals(SaveStatus.Unsaved, vm.state.value.save)
        assertEquals(listOf(WhiteboardTexts.REJECTED), said)
        assertTrue(PageCommand.Unsent in commands)
        vm.requestLeave()
        runCurrent()
        assertEquals(0, left)
        assertTrue(vm.state.value.confirmLeave)
        // The next valid save carries the whole drawing and clears the problem.
        vm.keepEditing()
        vm.onSave(scene("a", flush = true))
        runCurrent()
        assertEquals(SaveStatus.Saved, vm.state.value.save)
        vm.requestLeave()
        runCurrent()
        assertEquals(1, left)
    }

    private fun image(id: String, file: String) = buildJsonObject { put("id", id); put("type", "image"); put("fileId", file) }

    private fun withImages(vararg els: JsonObject) = scene().copy(elements = JsonArray(els.toList()))

    @Test fun aRefusedPictureStaysFilteredInLaterSaves() = runTest(dispatcher) {
        val b = FakeWhiteboardBackend()
        val vm = vm(b)
        vm.onSave(withImages(image("i1", "bad"), image("i2", "ok")).copy(rejectedFileIds = setOf("bad"), offered = setOf("bad")))
        advanceTimeBy(2_100); runCurrent()
        vm.onSave(withImages(image("i1", "bad"), image("i2", "ok")))
        advanceTimeBy(2_100); runCurrent()
        // "ok" is not refused (the PC already has it), so it stays.
        assertEquals(listOf("i2"), b.saves.last().second.elements.map { ((it as JsonObject)["id"] as JsonPrimitive).content })
    }

    @Test fun aRefusedPictureIsFilteredFromThePendingSaveToo() = runTest(dispatcher) {
        val b = FakeWhiteboardBackend()
        val vm = vm(b)
        vm.onSave(withImages(image("i1", "bad")))
        vm.onSave(withImages(image("i1", "bad"), image("i2", "ok")).copy(rejectedFileIds = setOf("bad")))
        advanceTimeBy(2_100); runCurrent()
        assertEquals(listOf("i2"), b.saves.single().second.elements.map { ((it as JsonObject)["id"] as JsonPrimitive).content })
    }

    @Test fun anotherProjectDoesNotInheritRefusedPictures() = runTest(dispatcher) {
        val b = FakeWhiteboardBackend()
        val vm = vm(b)
        vm.onSave(withImages(image("i1", "bad")).copy(rejectedFileIds = setOf("bad"), flush = true))
        runCurrent()
        vm.choose("api")
        runCurrent(); vm.onPageFlushed(); runCurrent()
        vm.onSave(withImages(image("i1", "bad")).copy(flush = true))
        runCurrent()
        assertEquals("api", b.saves.last().first)
        assertEquals(1, b.saves.last().second.elements.size)
    }

    @Test fun removedElementsAreReportedOncePerCount() = runTest(dispatcher) {
        val b = FakeWhiteboardBackend()
        val vm = vm(b)
        val said = ArrayList<String>()
        backgroundScope.launch { vm.messages.collect { said += it } }
        val dropped = scene("a").copy(dropped = 2)
        vm.onSave(dropped); vm.onSave(dropped)
        runCurrent()
        assertEquals(listOf(WhiteboardTexts.dropped(2)), said)
    }

    @Test fun picturesAreConfirmedToThePageOnlyOnceTheyAreSaved() = runTest(dispatcher) {
        val b = FakeWhiteboardBackend().apply { saveResult = Result.failure(LinkException(LinkError.Offline)) }
        val vm = vm(b)
        val commands = ArrayList<PageCommand>()
        backgroundScope.launch { vm.pageCommands.collect { commands += it } }
        vm.onSave(scene("a", files = listOf("img1")).copy(offered = setOf("img1")))
        advanceTimeBy(2_100); runCurrent()
        assertTrue(commands.none { it is PageCommand.Saved })
        b.saveResult = Result.success(Unit)
        vm.flushNow()
        runCurrent()
        assertEquals(listOf<PageCommand>(PageCommand.Saved(setOf("img1"))), commands)
    }

    private fun att(name: String, extra: String = "") = Json.parseToJsonElement(
        """{"name":"$name","size":2048,"mime":"image/png","kind":"image","note":"n","addedAt":5,"thumb":null$extra}""",
    )

    @Test fun attachmentsAreParsedLeniently() = runTest(dispatcher) {
        val b = FakeWhiteboardBackend()
        b.loadResult = Result.success(buildJsonObject {
            put("elements", JsonArray(emptyList()))
            put("attachments", JsonArray(listOf(
                att("a.png"), att(""), JsonPrimitive("x"), Json.parseToJsonElement("""{"name":"b","size":"big","kind":"image","note":"","addedAt":1}"""),
                Json.parseToJsonElement("""{"name":"c.pdf","size":10,"kind":"file","note":"","addedAt":1}"""),
            )))
        })
        val vm = vm(b)
        assertEquals(listOf("a.png", "c.pdf"), vm.state.value.attachments.map { it.name })
        b.loadResult = Result.success(buildJsonObject { put("attachments", JsonPrimitive("rara")) })
        assertTrue(WhiteboardViewModel.parseAttachments(JsonPrimitive("rara")).isEmpty())
        val many = JsonArray((1..300).map { att("f$it") })
        assertEquals(200, WhiteboardViewModel.parseAttachments(many).size)
    }

    private fun TestScope.withAttachment(b: FakeWhiteboardBackend): WhiteboardViewModel {
        b.loadResult = Result.success(buildJsonObject { put("elements", JsonArray(emptyList())); put("attachments", JsonArray(listOf(att("a.png")))) })
        return vm(b)
    }

    @Test fun savingANoteUpdatesTheListWithoutTouchingTheDrawing() = runTest(dispatcher) {
        val b = FakeWhiteboardBackend()
        val vm = withAttachment(b)
        vm.onSave(scene("a"))
        val before = vm.state.value.save
        assertTrue(vm.saveNote("tienda", "a.png", "nueva"))
        assertEquals("nueva", vm.state.value.attachments.single().note)
        assertEquals(listOf(Triple("tienda", "a.png", "nueva")), b.notes)
        assertEquals(before, vm.state.value.save)
        advanceTimeBy(2_100); runCurrent()
        // The pending drawing still goes out as it was.
        assertEquals(1, b.saves.size)
        assertEquals(1, b.saves.single().second.elements.size)
    }

    @Test fun aFailedNoteKeepsTheListAndWarns() = runTest(dispatcher) {
        val b = FakeWhiteboardBackend()
        val vm = withAttachment(b)
        val msgs = ArrayList<String>()
        backgroundScope.launch { vm.messages.collect { msgs += it } }
        b.noteResult = Result.failure(LinkException(LinkError.Offline))
        assertFalse(vm.saveNote("tienda", "a.png", "x"))
        runCurrent()
        assertEquals("n", vm.state.value.attachments.single().note)
        assertEquals(listOf(WhiteboardTexts.NOTE_FAILED), msgs)
        assertFalse(vm.saveNote("tienda", "a.png", "x".repeat(2001)))
    }

    @Test fun aNoteNeverLandsInAnotherProject() = runTest(dispatcher) {
        val b = FakeWhiteboardBackend()
        val vm = withAttachment(b)
        vm.choose("api")
        runCurrent(); vm.onPageFlushed(); runCurrent()
        assertTrue(vm.saveNote("tienda", "a.png", "late"))
        // The note went to the project the panel was opened with, and the open project's list is not changed.
        assertEquals("tienda", b.notes.single().first)
        assertEquals("n", vm.state.value.attachments.single().note)
    }

    @Test fun theNotesButtonNeedsThePcMethod() = runTest(dispatcher) {
        val b = FakeWhiteboardBackend()
        assertTrue(vm(b).canNote)
        b.unavailable = setOf("whiteboard.note")
        assertFalse(vm(b).canNote)
    }

    @Test fun aSavePendingInOneProjectNeverGoesToAnother() = runTest(dispatcher) {
        val b = FakeWhiteboardBackend().apply { saveResult = Result.failure(LinkException(LinkError.Offline)) }
        val vm = vm(b)
        vm.onSave(scene("a"))
        advanceTimeBy(2_100); runCurrent()
        assertEquals("tienda", b.saves.single().first)
        b.saveResult = Result.success(Unit)
        vm.choose("api")
        runCurrent(); vm.onPageFlushed(); runCurrent()
        // Everything pending went to the project it was drawn in, then the other one opened.
        assertEquals(listOf("tienda", "tienda"), b.saves.map { it.first })
        assertEquals("api", (vm.state.value.phase as WhiteboardPhase.Ready).project)
        // From now on saves are stamped with the new project.
        vm.onSave(scene("z", flush = true))
        runCurrent()
        assertEquals("api", b.saves.last().first)
    }

    @Test fun switchingAsksThePageToFlushAndWaitsForIt() = runTest(dispatcher) {
        val b = FakeWhiteboardBackend()
        val vm = vm(b)
        val commands = ArrayList<PageCommand>()
        backgroundScope.launch { vm.pageCommands.collect { commands += it } }
        vm.choose("api")
        runCurrent()
        assertEquals(listOf<PageCommand>(PageCommand.Flush), commands)
        assertEquals("tienda", (vm.state.value.phase as WhiteboardPhase.Ready).project)
        // The last strokes of the page arrive just before it answers.
        vm.onSave(scene("last", flush = true))
        vm.onPageFlushed()
        runCurrent()
        assertEquals("tienda", b.saves.last().first)
        assertEquals("api", (vm.state.value.phase as WhiteboardPhase.Ready).project)
    }

    @Test fun aSaveWithoutAProjectIsNeverReportedAsSaved() = runTest(dispatcher) {
        val b = FakeWhiteboardBackend().apply { projectList = WhiteboardProjects(listOf("a"), null) }
        val vm = vm(b)
        assertTrue(vm.state.value.phase is WhiteboardPhase.Choose)
        var left = 0
        backgroundScope.launch { vm.leave.collect { left++ } }
        vm.onSave(scene("a", flush = true))
        vm.requestLeave()
        runCurrent()
        assertTrue(b.saves.isEmpty())
        assertEquals(0, left)
        assertTrue(vm.state.value.confirmLeave)
    }

    @Test fun aDeadPageWithPendingChangesIsMarkedUnsaved() = runTest(dispatcher) {
        val b = FakeWhiteboardBackend().apply { saveResult = Result.failure(LinkException(LinkError.Offline)) }
        val vm = vm(b)
        vm.onSave(scene("a"))
        runCurrent()
        vm.onPageGone()
        runCurrent()
        assertEquals(SaveStatus.Unsaved, vm.state.value.save)
        assertEquals(1, b.saves.size)
    }
}

class OnceActionTest {
    @Test fun runsOnlyTheFirstTime() {
        var n = 0
        val once = OnceAction { n++ }
        once.run(); once.run(); once.run()
        assertEquals(1, n)
    }
}

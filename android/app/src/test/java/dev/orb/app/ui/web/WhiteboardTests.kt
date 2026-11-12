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
import kotlinx.serialization.json.JsonArray
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
        for (raw in listOf(null, "", "nope", "[]", "42", """{"type":"open","url":"https://x"}""", """{"type":"eval"}""", """{"type":7}""", """{}""", """{"type":"save"}""")) {
            assertNull("must be dropped: $raw", WhiteboardMessages.parse(raw))
        }
    }

    @Test fun anOversizedMessageIsDropped() {
        val big = save(""","png":"data:image/png;base64,${"A".repeat(WhiteboardMessages.MAX_MESSAGE_CHARS)}"""")
        assertNull(WhiteboardMessages.parse(big))
    }

    @Test fun theDrawingIsChecked() {
        assertNull(WhiteboardMessages.parse(save(elements = """[{"id":"a","type":"embeddable"}]""")))
        assertNull(WhiteboardMessages.parse(save(elements = """[{"id":"a","type":"iframe"}]""")))
        assertNull(WhiteboardMessages.parse(save(elements = """["x"]""")))
        assertNull(WhiteboardMessages.parse(save(elements = """[{"type":"rectangle"}]""")))
        assertNull(WhiteboardMessages.parse("""{"type":"save","elements":{"a":1}}"""))
        val many = (1..WhiteboardMessages.MAX_ELEMENTS + 1).joinToString(",", "[", "]") { """{"id":"e$it","type":"line"}""" }
        assertNull(WhiteboardMessages.parse(save(elements = many)))
    }

    @Test fun picturesMustBeSmallDataImages() {
        val ok = save(""","files":{"f-1":{"mimeType":"image/png","dataURL":"data:image/png;base64,AAAA"}}""")
        val s = WhiteboardMessages.parse(ok) as WhiteboardMessage.Save
        assertEquals(setOf("f-1"), s.files.keys)
        for (bad in listOf(
            """"f":{"dataURL":"https://evil.test/x.png"}""",
            """"f":{"dataURL":"data:text/html;base64,AAAA"}""",
            """"../x":{"dataURL":"data:image/png;base64,AAAA"}""",
            """"f":{"mimeType":"image/png"}""",
            """"f":"data:image/png;base64,AAAA"""",
        )) assertNull("must be dropped: $bad", WhiteboardMessages.parse(save(""","files":{$bad}""")))
        val huge = """"f":{"dataURL":"data:image/png;base64,${"A".repeat(WhiteboardMessages.MAX_FILE_CHARS)}"}"""
        assertNull(WhiteboardMessages.parse(save(""","files":{$huge}""")))
        val tooMany = (1..WhiteboardMessages.MAX_FILES + 1).joinToString(",") { """"f$it":{"dataURL":"data:image/png;base64,AA"}""" }
        assertNull(WhiteboardMessages.parse(save(""","files":{$tooMany}""")))
    }

    @Test fun thePictureIsAPngOrEmpty() {
        assertEquals("", (WhiteboardMessages.parse(save(""","png":""""")) as WhiteboardMessage.Save).png)
        assertNull((WhiteboardMessages.parse(save("")) as WhiteboardMessage.Save).png)
        assertNull(WhiteboardMessages.parse(save(""","png":"https://evil.test/p.png"""")))
        assertNull(WhiteboardMessages.parse(save(""","png":"data:image/jpeg;base64,AAAA"""")))
        assertNull(WhiteboardMessages.parse(save(""","png":5""")))
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
    val saves = ArrayList<Pair<String, WhiteboardMessage.Save>>()

    override fun available(m: ApiMethod) = m.name !in unavailable
    override suspend fun projects() = Result.success(projectList)
    override suspend fun load(project: String): Result<JsonObject> { loads += project; return loadResult }
    override suspend fun save(project: String, save: WhiteboardMessage.Save): Result<Unit> { saves += project to save; return saveResult }
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
        runCurrent()
        assertEquals(listOf(WhiteboardTexts.SWITCH_BLOCKED), said)
        assertEquals("tienda", (vm.state.value.phase as WhiteboardPhase.Ready).project)
        b.saveResult = Result.success(Unit)
        vm.choose("api")
        runCurrent()
        assertEquals("api", (vm.state.value.phase as WhiteboardPhase.Ready).project)
        assertEquals("tienda", b.saves.last().first)
        assertNotNull(b.loads.lastOrNull { it == "api" })
    }
}

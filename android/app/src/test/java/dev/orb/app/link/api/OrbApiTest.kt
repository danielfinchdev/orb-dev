package dev.orb.app.link.api

import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkException
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

@OptIn(UserConfirmation::class)
class OrbApiTest {
    private class Recorder(val listed: Set<String> = emptySet(), val result: JsonElement = JsonObject(emptyMap())) : PcCaller {
        val calls = ArrayList<Pair<String, JsonObject>>()
        override suspend fun call(method: String, params: JsonObject): Result<JsonElement> { calls += method to params; return Result.success(result) }
        override fun supports(method: String) = method in listed
    }

    private val remote: Set<String> = Json.parseToJsonElement(
        OrbApiTest::class.java.getResourceAsStream("/vectors/remote-methods.json")!!.readBytes().toString(Charsets.UTF_8)
    ).jsonObject["methods"]!!.jsonArray.map { it.jsonPrimitive.content }.toSet()

    @Test
    fun `every method the api can call is one a linked phone may call, except the newer ones`() {
        val unknown = ApiMethods.all.filter { it.requiresPc == null && it.name !in remote }.map { it.name }
        assertEquals("not in REMOTE_METHODS of the PC", emptyList<String>(), unknown)
        // the newer ones must really be absent today, or they would not need the flag
        for (m in ApiMethods.all.filter { it.requiresPc != null }) assertFalse(m.name, m.name in remote)
        assertEquals(setOf("pc.screenshot", "conversations.trash", "conversations.restore", "sessions.trash", "sessions.restore", "projects.mergePr"),
            ApiMethods.all.filter { it.requiresPc != null }.map { it.name }.toSet())
        assertEquals("no method is listed twice", ApiMethods.all.size, ApiMethods.all.map { it.name }.toSet().size)
    }

    @Test
    fun `the api covers the remote methods the plan lists`() {
        val names = ApiMethods.all.map { it.name }.toSet()
        val planned = listOf("inbox.list", "conversations.list", "chat.send", "chat.list", "sessions.send", "tasks.create", "tasks.list", "projects.list",
            "schedules.list", "approvals.list", "usage.get", "agents.status", "logs.list", "whiteboard.load", "activity.list", "models.catalog",
            "mentions.options", "permissions.setMode", "control.pause", "control.resume", "app.state")
        for (m in planned) assertTrue(m, m in names)
    }

    @Test
    fun `chat send and sessions send add a client id and tasks create is a plain call`() = runBlocking {
        val rec = Recorder()
        var n = 0
        val api = OrbApi(rec) { "id-${++n}" }
        api.chatSend(buildJsonObject { put("text", "hola") })
        api.sessionsSend(buildJsonObject { put("id", "s1"); put("text", "x") }, clientId = "mine")
        api.tasksCreate(buildJsonObject { put("title", "t") })
        assertEquals("chat.send", rec.calls[0].first)
        assertEquals("id-1", rec.calls[0].second["clientId"]!!.jsonPrimitive.content)
        assertEquals("hola", rec.calls[0].second["text"]!!.jsonPrimitive.content)
        assertEquals("mine", rec.calls[1].second["clientId"]!!.jsonPrimitive.content)
        assertEquals("tasks.create", rec.calls[2].first)
    }

    @Test
    fun `the newer methods are hidden and refused unless the pc lists them`() = runBlocking {
        val old = Recorder()
        val api = OrbApi(old)
        assertFalse(api.available(ApiMethods.PC_SCREENSHOT))
        val res = api.pcScreenshot()
        assertEquals(LinkError.Unsupported("pc.screenshot"), (res.exceptionOrNull() as LinkException).error)
        assertTrue("nothing was sent", old.calls.isEmpty())

        val newer = Recorder(listed = setOf("pc.screenshot"), result = buildJsonObject { put("path", "C:/x.png") })
        val api2 = OrbApi(newer)
        assertTrue(api2.available(ApiMethods.PC_SCREENSHOT))
        assertEquals("C:/x.png", api2.pcScreenshot().getOrThrow())
        assertTrue(api2.available(ApiMethods.CHAT_SEND))
    }

    @Test
    fun `deleting a chat needs a confirmation made for that chat and gives the undo`() = runBlocking {
        val rec = Recorder(listed = setOf("conversations.trash", "sessions.trash", "conversations.restore"), result = buildJsonObject { put("undo", "u-1") })
        val api = OrbApi(rec)
        val undo = api.conversationsTrash("c1", Confirmed(ConfirmAction.TrashConversation, "c1")).getOrThrow()
        assertEquals("u-1", (undo.token as JsonPrimitive).content)
        assertEquals("conversations.trash" to "c1", rec.calls[0].first to rec.calls[0].second["id"]!!.jsonPrimitive.content)
        try {
            api.conversationsTrash("c2", Confirmed(ConfirmAction.TrashConversation, "c1"))
            fail("a confirmation for another chat must not pass")
        } catch (e: IllegalArgumentException) { /* expected */ }
        try {
            api.sessionsTrash("c1", Confirmed(ConfirmAction.TrashConversation, "c1"))
            fail("a confirmation for another action must not pass")
        } catch (e: IllegalArgumentException) { /* expected */ }
        assertEquals(1, rec.calls.size)
        api.conversationsRestore("c1")
        assertEquals("conversations.restore", rec.calls.last().first)
    }

    @Test
    fun `merging a pr needs its confirmation and sends name number and method`() = runBlocking {
        val rec = Recorder(listed = setOf("projects.mergePr"))
        val api = OrbApi(rec)
        api.projectsMergePr("orb", 12, "squash", Confirmed(ConfirmAction.MergePr, "orb#12"))
        val p = rec.calls.single().second
        assertEquals("orb", p["name"]!!.jsonPrimitive.content)
        assertEquals("12", p["number"]!!.jsonPrimitive.content)
        assertEquals("squash", p["method"]!!.jsonPrimitive.content)
        try {
            api.projectsMergePr("orb", 13, null, Confirmed(ConfirmAction.MergePr, "orb#12"))
            fail()
        } catch (e: IllegalArgumentException) { /* expected */ }
    }

    @Test
    fun `area wrappers call their own method`() = runBlocking {
        val rec = Recorder()
        val api = OrbApi(rec)
        api.inbox.list(); api.tasks.live(); api.usage.history(); api.control.pause(); api.app.state(); api.inbox.sectionsMove()
        assertEquals(listOf("inbox.list", "tasks.live", "usage.history", "control.pause", "app.state", "inbox.sections.move"), rec.calls.map { it.first })
    }
}

package dev.orb.app.ui.chats

import java.util.TimeZone
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatModelTest {
    private fun obj(s: String) = Json.parseToJsonElement(s) as JsonObject

    private val inbox = """
    {"zone":"orb","unread":2,"sections":[{"id":3,"name":"Importantes","position":0,"count":1,"unread":0}],
     "items":[
      {"key":"conversation:12","kind":"conversation","id":12,"conversation":12,"title":"Revisar pasarela","project":"api-pagos","done":false,
       "avatar":{"type":"project","project":"api-pagos"},"state":"working","at":"2026-11-11T09:20:00.000Z","pinned":true,"pinOrder":0,
       "section":null,"muted":false,"snoozedUntil":null,
       "lastMessage":{"id":5,"text":"He añadido\n un límite","at":"2026-11-11T09:20:00.000Z","from":{"type":"orbe"},"kind":"text"},"unread":2},
      {"key":"session:s1","kind":"session","id":"s1","conversation":null,"pinned":false,"pinOrder":null,"section":3,"muted":true,
       "snoozedUntil":"2026-11-12T08:00:00.000Z","lastMessage":null,"unread":0,"at":null}
     ]}"""

    @Test fun parsesAnOrbeConversationRow() {
        val data = InboxParser.parse(obj(inbox))
        val r = data.rows[0]
        assertEquals("conversation:12", r.key)
        assertEquals(ChatKind.Orbe, r.kind)
        assertEquals("12", r.id)
        assertEquals("api-pagos", r.project)
        assertEquals(ChatState.Working, r.state)
        assertTrue(r.pinned)
        assertEquals(0, r.pinOrder)
        assertEquals(2, r.unread)
        assertEquals("He añadido un límite", r.lastText)
        assertEquals(Speaker.Orbe, r.lastFrom)
        assertEquals("2026-11-11T09:20:00.000Z", r.at)
        assertEquals(2, data.unread)
        assertEquals(listOf("Importantes"), data.sections.map { it.name })
    }

    @Test fun parsesADirectSessionStub() {
        val r = InboxParser.parse(obj(inbox)).rows[1]
        assertEquals(ChatKind.Agent, r.kind)
        assertEquals("s1", r.id)
        assertTrue(r.muted)
        assertEquals(3L, r.section)
        assertEquals("2026-11-12T08:00:00.000Z", r.snoozedUntil)
        assertEquals(ChatTexts.UNTITLED, r.title)
        assertNull(r.lastText)
        assertFalse(r.pinned)
    }

    @Test fun mergeCompletesDirectChatsAndOrbeAgents() {
        val merged = InboxMerge.merge(
            obj(inbox),
            conversations = Json.parseToJsonElement("""[{"id":12,"agent":"claude","asking":true}]"""),
            sessions = Json.parseToJsonElement(
                """[{"id":"s1","kind":"chat","agent":"codex","project":"api-pagos","title":"Directo con Codex","status":"running","updated_at":"2026-11-11T09:38:00.000Z","settled":0},
                    {"id":"s2","kind":"chat","agent":"cursor","title":"Nuevo","status":"idle","updated_at":"2026-11-10T09:00:00.000Z"},
                    {"id":"t9","kind":"task","title":"no"},{"id":"s3","kind":"chat","archived":1,"title":"viejo"}]"""),
            approvals = Json.parseToJsonElement("""[{"key":"x","session":{"id":"s2"}}]"""),
        )
        val rows = InboxParser.parse(merged).rows.associateBy { it.key }
        assertEquals(setOf("conversation:12", "session:s1", "session:s2"), rows.keys)
        assertEquals("claude", rows.getValue("conversation:12").agent)
        assertTrue(rows.getValue("conversation:12").asking)
        val s1 = rows.getValue("session:s1")
        assertEquals("Directo con Codex", s1.title)
        assertEquals(ChatState.Working, s1.state)
        assertEquals("api-pagos", s1.project)
        assertTrue(s1.muted)
        assertTrue(rows.getValue("session:s2").waitingPermission)
        assertEquals("cursor", rows.getValue("session:s2").agent)
    }

    @Test fun mergeDropsMarksOfSessionsThatAreGone() {
        val merged = InboxMerge.merge(obj(inbox), null, Json.parseToJsonElement("[]"), null)
        assertEquals(listOf("conversation:12"), InboxParser.parse(merged).rows.map { it.key })
    }

    @Test fun groupingPutsPinnedThenSectionsThenProjects() {
        val rows = listOf(
            row("1", project = "api", at = "2026-11-11T09:00:00.000Z"),
            row("2", pinned = true),
            row("3", project = "web", at = "2026-11-11T10:00:00.000Z"),
            row("4", section = 7),
            row("5", at = "2026-11-10T10:00:00.000Z"),
            row("6", done = true, project = "api"),
        )
        val entries = ChatGrouping.build(rows, listOf(ChatSection(7, "Mi sección", 0, 1, 0)), ChatFilter.All)
        val shape = entries.map { if (it is HeaderEntry) "#" + it.title else (it as RowEntry).row.id }
        assertEquals(listOf("#Fijados", "2", "#Mi sección", "4", "#web", "3", "#api", "1", "#Sin proyecto", "5", "#Completados · 1"), shape)
        assertEquals(entries.size, entries.map { it.key }.toSet().size)
    }

    @Test fun filtersSelectRows() {
        val rows = listOf(
            row("1", unread = 2), row("2", state = ChatState.Working), row("3", kind = ChatKind.Agent, agent = "codex"), row("4"),
        )
        fun ids(f: ChatFilter) = ChatGrouping.build(rows, emptyList(), f).filterIsInstance<RowEntry>().map { it.row.id }.toSet()
        assertEquals(setOf("1", "2", "3", "4"), ids(ChatFilter.All))
        assertEquals(setOf("1"), ids(ChatFilter.Unread))
        assertEquals(setOf("2"), ids(ChatFilter.Working))
        assertEquals(setOf("3"), ids(ChatFilter.Direct))
    }

    @Test fun shortTimes() {
        val utc = TimeZone.getTimeZone("UTC")
        val now = ChatTime.parse("2026-11-11T10:42:00.000Z")!!
        assertEquals("9:15", ChatTime.short("2026-11-11T09:15:00.000Z", now, utc))
        assertEquals("ayer", ChatTime.short("2026-11-10T23:00:00.000Z", now, utc))
        assertEquals("sáb", ChatTime.short("2026-11-07T08:00:00.000Z", now, utc))
        assertEquals("3 nov", ChatTime.short("2026-11-03T08:00:00.000Z", now, utc))
        assertEquals("", ChatTime.short(null, now, utc))
        assertEquals("2026-11-11T11:42:00.000Z", ChatTime.iso(now + 3_600_000))
        assertEquals("2026-11-12T09:00:00.000Z", ChatTime.tomorrowMorning(now, utc))
    }

    @Test fun searchParsingFillsBareDirectChatsFromTheCache() {
        val known = listOf(row("s1", kind = ChatKind.Agent, title = "Directo con Codex", project = "api"))
        val inboxSearch = obj(
            """{"zone":"orb","items":[{"key":"session:s1","kind":"session","id":"s1","pinned":false,"muted":false,"unread":0}],
                "messages":[{"key":"session:s1","kind":"session","id":"s1","conversation":null,"title":"",
                "line":{"id":4,"text":"idb-keyval","at":"2026-11-11T09:00:00.000Z","from":{"type":"user"},"kind":"text"}}]}""",
        )
        val tasks = Json.parseToJsonElement("""[{"id":42,"title":"Guardar el carrito","status":"running","project":"api","snippet":"idb"}]""")
        val r = SearchParser.parse("idb", inboxSearch, tasks, known)
        assertEquals("Directo con Codex", r.chats.single().title)
        assertEquals("Directo con Codex", r.messages.single().chatTitle)
        assertEquals(Speaker.User, r.messages.single().from)
        assertEquals(42L, r.tasks.single().id)
        assertEquals(emptyList<SearchProject>(), r.projects)
        assertEquals(listOf("api"), SearchParser.projects("ap", known).map { it.name })
    }
}

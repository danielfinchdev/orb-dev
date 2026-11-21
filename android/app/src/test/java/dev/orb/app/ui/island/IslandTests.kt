package dev.orb.app.ui.island

import androidx.compose.material3.Text
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.orb.app.ui.theme.OrbTheme
import dev.orb.app.ui.theme.OrbPaletteChoice
import dev.orb.app.ui.web.LocalWebPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

class IslandMessagesTest {
    private fun p(s: String?) = IslandMessages.parse(s)

    @Test fun validMessages() {
        assertEquals(IslandMessage.Ready, p("""{"type":"ready"}"""))
        assertEquals(IslandMessage.Size(3, 120), p("""{"type":"size","seq":3,"height":120}"""))
        assertEquals(IslandMessage.Size(3, 121), p("""{"type":"size","seq":3,"height":121.7}"""))
        assertEquals(IslandMessage.Failed(7), p("""{"type":"failed","seq":7}"""))
    }

    @Test fun heightsAreClamped() {
        assertEquals(IslandMessage.Size(1, 8000), p("""{"type":"size","seq":1,"height":1000000}"""))
        assertEquals(IslandMessage.Size(1, 1), p("""{"type":"size","seq":1,"height":0}"""))
        assertEquals(IslandMessage.Size(1, 1), p("""{"type":"size","seq":1,"height":-50}"""))
    }

    @Test fun oddTypesAndShapesAreDropped() {
        for (s in listOf(
            null, "", "nope", "[]", "42", "{}", """{"type":5}""", """{"type":"save"}""", """{"type":"load"}""", """{"type":"close"}""",
            """{"type":"size","seq":1}""", """{"type":"size","height":10}""", """{"type":"size","seq":"1","height":10}""",
            """{"type":"size","seq":1,"height":"10"}""", """{"type":"size","seq":1.5,"height":10}""", """{"type":"size","seq":-1,"height":10}""",
            """{"type":"size","seq":99999999999,"height":10}""", """{"type":"failed"}""", """{"type":"failed","seq":null}""",
            """{"type":"size","seq":1,"height":1e999}""",
        )) assertNull("must be dropped: $s", p(s))
    }

    @Test fun anHugeMessageIsDropped() {
        val big = """{"type":"ready","pad":"${"x".repeat(IslandMessages.MAX_MESSAGE_CHARS)}"}"""
        assertNull(p(big))
    }

    @Test fun renderJsonEscapesTheSource() {
        val json = IslandMessages.renderJson(IslandKind.Mermaid, "a\"b\n</script>", false, 2)
        val o = kotlinx.serialization.json.Json.parseToJsonElement(json) as kotlinx.serialization.json.JsonObject
        assertEquals("a\"b\n</script>", (o["source"] as kotlinx.serialization.json.JsonPrimitive).content)
        assertEquals("mermaid", (o["kind"] as kotlinx.serialization.json.JsonPrimitive).content)
        assertFalse(json.contains('\n'))
    }
}

class IslandStateTest {
    @Test fun shownSetKeepsTheMostRecentlyUsed() {
        val s = ShownSet(3)
        s.mark("a"); s.mark("b"); s.mark("c")
        assertTrue(s.contains("a")) // a is now the freshest
        s.mark("d")
        assertEquals(3, s.size)
        assertFalse(s.contains("b"))
        assertTrue(s.contains("a") && s.contains("c") && s.contains("d"))
        s.remove("a")
        assertFalse(s.contains("a"))
    }

    @Test fun slotsLimitHowManyIslandsAreMounted() {
        val slots = IslandSlots(3)
        val t = List(4) { Any() }
        assertTrue(t.take(3).all { slots.tryAcquire(it) })
        assertFalse(slots.tryAcquire(t[3]))
        assertTrue(slots.tryAcquire(t[0])) // already holding one
        slots.release(t[1])
        assertTrue(slots.tryAcquire(t[3]))
        assertEquals(3, slots.inUse())
    }

    @Test fun keysDependOnKindAndSource() {
        assertEquals(IslandShown.key(IslandKind.Math, "x"), IslandShown.key(IslandKind.Math, "x"))
        assertFalse(IslandShown.key(IslandKind.Math, "x") == IslandShown.key(IslandKind.Mermaid, "x"))
        assertFalse(IslandShown.key(IslandKind.Math, "x") == IslandShown.key(IslandKind.Math, "y"))
    }

    @Test fun thePolicyServesTheIslandAndNothingElse() {
        val base = "https://appassets.androidplatform.net/assets/web"
        assertTrue(LocalWebPolicy.isAllowed(LocalWebPolicy.pageUrl("island/index.html", dark = true)))
        assertTrue(LocalWebPolicy.isAllowed("$base/island/assets/katex-x.js"))
        assertFalse(LocalWebPolicy.isAllowed("https://appassets.androidplatform.net/assets/island/index.html"))
        assertFalse(LocalWebPolicy.isAllowed("https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"))
        assertFalse(LocalWebPolicy.isAllowed("$base/island/../../x"))
    }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class IslandBlockTest {
    @get:Rule val rule = createComposeRule()

    private fun show(kind: IslandKind, source: String) = rule.setContent {
        OrbTheme(OrbPaletteChoice.Grafito, dark = false) {
            IslandBlock(kind, source, dark = false) { Text("CODE:$source") }
        }
    }

    @Test fun aDiagramStartsAsACardWithItsCode() {
        show(IslandKind.Mermaid, "graph TD; A-->B")
        rule.onNodeWithText("Ver diagrama").assertExists()
        rule.onNodeWithText("CODE:graph TD; A-->B").assertExists()
    }

    @Test fun aFormulaStartsAsACard() {
        show(IslandKind.Math, "x^2")
        rule.onNodeWithText("Ver fórmula").assertExists()
    }

    @Test fun anOversizedSourceStaysAsCodeWithoutCard() {
        show(IslandKind.Math, "x".repeat(IslandMessages.MAX_SOURCE_CHARS + 1))
        assertEquals(0, rule.onAllNodesWithText("Ver fórmula").fetchSemanticsNodes().size)
    }

    @Test fun tappingTheCardMountsTheIslandAndCodeComesBack() {
        val src = "graph LR; tap-->me"
        show(IslandKind.Mermaid, src)
        rule.onNodeWithText("Ver diagrama").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Ver código").assertExists()
        assertEquals(0, rule.onAllNodesWithText("Ver diagrama").fetchSemanticsNodes().size)
        rule.onNodeWithText("Ver código").performClick()
        rule.onNodeWithText("Ver diagrama").assertExists()
        assertEquals(0, IslandShown.slots.inUse())
    }
}

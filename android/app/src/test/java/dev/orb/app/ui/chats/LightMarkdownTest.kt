package dev.orb.app.ui.chats

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LightMarkdownTest {
    private fun spans(s: String) = LightMarkdown.inline(s)

    @Test fun boldItalicCodeAndLinks() {
        val s = spans("Un **fuerte**, otro *suave* y `code` con [enlace](https://orb.dev)")
        assertTrue(s.any { it.text == "fuerte" && it.bold })
        assertTrue(s.any { it.text == "suave" && it.italic })
        assertTrue(s.any { it.text == "code" && it.code })
        assertTrue(s.any { it.text == "enlace" && it.link == "https://orb.dev" })
    }

    @Test fun snakeCaseAndUnclosedMarksStayAsTyped() {
        assertEquals("mi_variable_larga", spans("mi_variable_larga").joinToString("") { it.text })
        assertEquals("2 * 3 = 6", spans("2 * 3 = 6").joinToString("") { it.text })
        assertEquals("**sin cerrar", spans("**sin cerrar").joinToString("") { it.text })
        assertTrue(spans("`abierto").none { it.code })
    }

    @Test fun blocks() {
        val b = LightMarkdown.parse("# Título\n\nUn párrafo\ncon dos líneas.\n\n- uno\n- dos\n1. primero\n\n> cita\n\n```kotlin\nval x = 1\n```\n---")
        assertTrue(b[0] is MdBlock.Heading)
        assertEquals("Un párrafo\ncon dos líneas.", (b[1] as MdBlock.Paragraph).spans.joinToString("") { it.text })
        assertEquals(listOf(null, null, 1), b.filterIsInstance<MdBlock.Item>().map { it.number })
        assertTrue(b.any { it is MdBlock.Quote })
        val code = b.filterIsInstance<MdBlock.Code>().single()
        assertEquals("kotlin", code.lang)
        assertEquals("val x = 1", code.text)
        assertEquals(false, code.onlyOnPc)
        assertTrue(b.last() is MdBlock.Rule)
    }

    @Test fun diagramsAreFlaggedForThePc() {
        val b = LightMarkdown.parse("```mermaid\ngraph TD; A-->B\n```")
        assertTrue((b.single() as MdBlock.Code).onlyOnPc)
    }

    @Test fun anUnclosedFenceStillShowsWhatArrived() {
        val b = LightMarkdown.parse("```js\nlet a = 1")
        assertEquals("let a = 1", (b.single() as MdBlock.Code).text)
    }

    @Test fun nestedBulletsKeepDepth() {
        val items = LightMarkdown.parse("- a\n  - b\n    - c").filterIsInstance<MdBlock.Item>()
        assertEquals(listOf(0, 1, 2), items.map { it.depth })
    }
}

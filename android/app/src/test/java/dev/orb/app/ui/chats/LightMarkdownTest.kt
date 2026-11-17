package dev.orb.app.ui.chats

import dev.orb.app.ui.island.IslandKind
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

    @Test fun onlyHttpHttpsAndMailtoLinksSurvive() {
        assertEquals("https://orb.dev", safeLink("https://orb.dev"))
        assertEquals("MAILTO:a@b.c", safeLink(" MAILTO:a@b.c "))
        assertEquals(null, safeLink("file:///sdcard/x"))
        assertEquals(null, safeLink("otraapp://accion"))
        assertEquals(null, safeLink("intent:#Intent;end"))
        assertEquals(null, safeLink("javascript:alert(1)"))
        assertEquals(null, safeLink("/relativo"))
        val s = spans("[docs](file:///sdcard/x) y [web](http://orb.dev)")
        assertTrue(s.any { it.text == "docs" && it.link == null })
        assertTrue(s.any { it.text == "web" && it.link == "http://orb.dev" })
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

    @Test fun closedDiagramsAndFormulasAreRich() {
        val m = LightMarkdown.parse("```mermaid\ngraph TD; A-->B\n```").single() as MdBlock.Code
        assertEquals(IslandKind.Mermaid, m.rich)
        assertEquals(false, m.onlyOnPc)
        for (l in listOf("latex", "katex", "math", "LaTeX")) {
            assertEquals(l, IslandKind.Math, (LightMarkdown.parse("```$l\nx^2\n```").single() as MdBlock.Code).rich)
        }
    }

    @Test fun htmlAndSvgStayCodeOnlyOnThePc() {
        for (l in listOf("html", "svg")) {
            val c = LightMarkdown.parse("```$l\n<b>x</b>\n```").single() as MdBlock.Code
            assertEquals(null, c.rich)
            assertTrue(c.onlyOnPc)
        }
    }

    @Test fun anUnclosedMermaidFenceIsPlainCodeUntilItCloses() {
        val c = LightMarkdown.parse("```mermaid\ngraph TD; A-->B").single() as MdBlock.Code
        assertEquals(null, c.rich)
        assertEquals(false, c.onlyOnPc)
        assertEquals("graph TD; A-->B", c.text)
    }

    private fun math(s: String) = LightMarkdown.parse(s).filterIsInstance<MdBlock.Code>()
    private val dd = "$$"

    @Test fun displayFormulaOnOneLine() {
        val src = "Antes\n\n$dd E = mc^2 $dd\n\nDespués"
        val c = math(src).single()
        assertEquals(IslandKind.Math, c.rich)
        assertEquals("E = mc^2", c.text)
        assertEquals(3, LightMarkdown.parse(src).size)
    }

    @Test fun displayFormulaOverSeveralLines() {
        assertEquals("\\frac{a}{b}\n= c", math("$dd\n\\frac{a}{b}\n= c\n$dd").single().text)
        assertEquals("a +\nb", math("${dd}a +\nb$dd").single().text)
    }

    @Test fun unclosedFormulaIsPlainText() {
        for (s in listOf("$dd\nx = 1", "$dd x = 1", "$dd\nx = 1\n\nmás texto$dd")) {
            val b = LightMarkdown.parse(s)
            assertTrue(s, b.none { it is MdBlock.Code })
            assertTrue(s, b.all { it is MdBlock.Paragraph })
        }
    }

    @Test fun dollarAmountsAndInlineFormulasAreUntouched() {
        for (s in listOf("Cuesta \$5 y \$10", "\$5 y luego \$10\$", "La fórmula ${dd}x$dd va en la frase", "\$100", "$dd$dd")) {
            assertTrue(s, LightMarkdown.parse(s).none { it is MdBlock.Code })
        }
        assertEquals("Cuesta \$5 y \$10", (LightMarkdown.parse("Cuesta \$5 y \$10").single() as MdBlock.Paragraph).spans.joinToString("") { it.text })
    }

    @Test fun aFormulaInterruptsAParagraph() {
        val b = LightMarkdown.parse("Mira:\n$dd x $dd\nfin")
        assertEquals(3, b.size)
        assertTrue(b[1] is MdBlock.Code)
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

package dev.orb.app.ui.chats

import androidx.compose.runtime.Immutable

/**
 * The few Markdown pieces a chat bubble needs, parsed by hand: no library, so the phone stays light and the result is
 * plain data a test can read. Diagrams, formulas and HTML are not drawn here; their blocks are kept as code and flagged.
 */
@Immutable
data class Span(val text: String, val bold: Boolean = false, val italic: Boolean = false, val code: Boolean = false, val link: String? = null)

@Immutable
sealed interface MdBlock {
    data class Paragraph(val spans: List<Span>) : MdBlock
    data class Heading(val level: Int, val spans: List<Span>) : MdBlock
    data class Item(val number: Int?, val depth: Int, val spans: List<Span>) : MdBlock
    data class Quote(val spans: List<Span>) : MdBlock
    /** [onlyOnPc]: a diagram or formula block the phone shows as code. */
    data class Code(val lang: String?, val text: String, val onlyOnPc: Boolean) : MdBlock
    data object Rule : MdBlock
}

object LightMarkdown {
    private val fence = Regex("^\\s*(```|~~~)\\s*([\\w+#.-]*)\\s*$")
    private val heading = Regex("^(#{1,6})\\s+(.*?)\\s*#*\\s*$")
    private val bullet = Regex("^(\\s*)[-*+]\\s+(.*)$")
    private val numbered = Regex("^(\\s*)(\\d{1,4})[.)]\\s+(.*)$")
    private val quote = Regex("^\\s*>\\s?(.*)$")
    private val rule = Regex("^\\s*([-*_])(\\s*\\1){2,}\\s*$")
    private val onlyPc = setOf("mermaid", "katex", "latex", "math", "html", "svg")

    fun parse(text: String): List<MdBlock> {
        val out = ArrayList<MdBlock>()
        val para = StringBuilder()
        fun flush() {
            if (para.isNotEmpty()) { out += MdBlock.Paragraph(inline(para.toString())); para.setLength(0) }
        }
        val lines = text.replace("\r\n", "\n").split('\n')
        var i = 0
        while (i < lines.size) {
            val line = lines[i]
            val f = fence.matchEntire(line)
            if (f != null) {
                flush()
                val mark = f.groupValues[1]
                val body = ArrayList<String>()
                i++
                // An unclosed fence (a reply still streaming) shows what has arrived so far.
                while (i < lines.size && !lines[i].trim().startsWith(mark)) { body += lines[i]; i++ }
                val lang = f.groupValues[2].ifBlank { null }
                out += MdBlock.Code(lang, body.joinToString("\n"), lang?.lowercase() in onlyPc)
                i++
                continue
            }
            val h = heading.matchEntire(line)
            val b = bullet.matchEntire(line)
            val n = numbered.matchEntire(line)
            val q = quote.matchEntire(line)
            when {
                line.isBlank() -> flush()
                rule.matches(line) -> { flush(); out += MdBlock.Rule }
                h != null -> { flush(); out += MdBlock.Heading(h.groupValues[1].length, inline(h.groupValues[2])) }
                b != null -> { flush(); out += MdBlock.Item(null, depthOf(b.groupValues[1]), inline(b.groupValues[2])) }
                n != null -> { flush(); out += MdBlock.Item(n.groupValues[2].toInt(), depthOf(n.groupValues[1]), inline(n.groupValues[3])) }
                q != null -> { flush(); out += MdBlock.Quote(inline(q.groupValues[1])) }
                else -> { if (para.isNotEmpty()) para.append('\n'); para.append(line.trimEnd()) }
            }
            i++
        }
        flush()
        return out
    }

    private fun depthOf(indent: String) = (indent.replace("\t", "  ").length / 2).coerceAtMost(3)

    /** `**bold**`, `*italic*`/`_italic_`, `` `code` `` and `[text](url)`; anything unclosed stays as typed. */
    fun inline(s: String): List<Span> {
        val out = ArrayList<Span>()
        val buf = StringBuilder()
        fun flush() { if (buf.isNotEmpty()) { out += Span(buf.toString()); buf.setLength(0) } }
        var i = 0
        while (i < s.length) {
            val c = s[i]
            when {
                c == '\\' && i + 1 < s.length && s[i + 1] in "\\`*_[]()#>-+.!" -> { buf.append(s[i + 1]); i += 2 }
                c == '`' -> {
                    val end = s.indexOf('`', i + 1)
                    if (end > i + 1) { flush(); out += Span(s.substring(i + 1, end), code = true); i = end + 1 } else { buf.append(c); i++ }
                }
                (s.startsWith("**", i) || s.startsWith("__", i)) -> {
                    val mark = s.substring(i, i + 2)
                    val end = s.indexOf(mark, i + 2)
                    if (end > i + 2) {
                        flush()
                        inline(s.substring(i + 2, end)).mapTo(out) { it.copy(bold = true) }
                        i = end + 2
                    } else { buf.append(mark); i += 2 }
                }
                (c == '*' || c == '_') && opensEmphasis(s, i) -> {
                    val end = closeEmphasis(s, i)
                    if (end > i + 1) {
                        flush()
                        inline(s.substring(i + 1, end)).mapTo(out) { it.copy(italic = true) }
                        i = end + 1
                    } else { buf.append(c); i++ }
                }
                c == '[' -> {
                    val close = s.indexOf(']', i + 1)
                    if (close > i && close + 1 < s.length && s[close + 1] == '(') {
                        val end = s.indexOf(')', close + 2)
                        if (end > close + 2) {
                            flush()
                            val url = s.substring(close + 2, end).trim()
                            inline(s.substring(i + 1, close)).mapTo(out) { it.copy(link = url) }
                            i = end + 1
                            continue
                        }
                    }
                    buf.append(c); i++
                }
                else -> { buf.append(c); i++ }
            }
        }
        flush()
        return out
    }

    // «snake_case_words» and «2 * 3» are not emphasis: the opener needs a non-space after it and no letter before an underscore.
    private fun opensEmphasis(s: String, i: Int): Boolean {
        if (i + 1 >= s.length || s[i + 1].isWhitespace() || s[i + 1] == s[i]) return false
        if (s[i] == '_' && i > 0 && s[i - 1].isLetterOrDigit()) return false
        return closeEmphasis(s, i) > i + 1
    }

    private fun closeEmphasis(s: String, i: Int): Int {
        var j = i + 1
        while (j < s.length) {
            if (s[j] == s[i] && !s[j - 1].isWhitespace() && (s[i] == '*' || j + 1 >= s.length || !s[j + 1].isLetterOrDigit())) return j
            j++
        }
        return -1
    }
}

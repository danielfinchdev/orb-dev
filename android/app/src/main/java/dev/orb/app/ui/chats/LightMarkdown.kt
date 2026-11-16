package dev.orb.app.ui.chats

import androidx.compose.runtime.Immutable
import dev.orb.app.ui.island.IslandKind

/**
 * The few Markdown pieces a chat bubble needs, parsed by hand: no library, so the phone stays light and the result is
 * plain data a test can read. Diagrams and formulas are not drawn here: their blocks carry a [IslandKind] and the chat draws them
 * in a local page. HTML and SVG blocks stay code, flagged [MdBlock.Code.onlyOnPc].
 */
@Immutable
data class Span(val text: String, val bold: Boolean = false, val italic: Boolean = false, val code: Boolean = false, val link: String? = null)

@Immutable
sealed interface MdBlock {
    data class Paragraph(val spans: List<Span>) : MdBlock
    data class Heading(val level: Int, val spans: List<Span>) : MdBlock
    data class Item(val number: Int?, val depth: Int, val spans: List<Span>) : MdBlock
    data class Quote(val spans: List<Span>) : MdBlock
    /**
     * [rich]: a closed diagram or formula block the phone can draw; [onlyOnPc]: an HTML or SVG block it shows as code.
     * A fence still streaming (not closed yet) is plain code with neither.
     */
    data class Code(val lang: String?, val text: String, val rich: IslandKind? = null, val onlyOnPc: Boolean = false) : MdBlock
    data object Rule : MdBlock
}

/** The link target when it is http, https or mailto; null for any other scheme (file:, other apps' schemes, intent:...). */
fun safeLink(url: String?): String? {
    val u = url?.trim() ?: return null
    val colon = u.indexOf(':')
    if (colon <= 0) return null
    return if (u.substring(0, colon).lowercase() in setOf("http", "https", "mailto") && u.length > colon + 1) u else null
}

object LightMarkdown {
    private val fence = Regex("^\\s*(```|~~~)\\s*([\\w+#.-]*)\\s*$")
    private val heading = Regex("^(#{1,6})\\s+(.*?)\\s*#*\\s*$")
    private val bullet = Regex("^(\\s*)[-*+]\\s+(.*)$")
    private val numbered = Regex("^(\\s*)(\\d{1,4})[.)]\\s+(.*)$")
    private val quote = Regex("^\\s*>\\s?(.*)$")
    private val rule = Regex("^\\s*([-*_])(\\s*\\1){2,}\\s*$")
    private val onlyPc = setOf("html", "svg")
    private val math = setOf("katex", "latex", "math")
    private val dollarLine = Regex("^\\s*[$][$](.*)$")
    private const val MAX_MATH_LINES = 200
    private const val DD = "$$"

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
                val closed = i < lines.size
                val l = lang?.lowercase()
                val rich = if (!closed) null else if (l == "mermaid") IslandKind.Mermaid else if (l in math) IslandKind.Math else null
                out += MdBlock.Code(lang, body.joinToString("\n"), rich, closed && l in onlyPc)
                i++
                continue
            }
            val m = mathBlock(lines, i)
            if (m != null) {
                flush()
                out += MdBlock.Code("math", m.first, IslandKind.Math)
                i = m.second
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

    /**
     * A display formula that starts a line with two dollar signs: either all on one line or closed by a later line that
     * ends with two dollar signs. Returns the formula and the index of the next line, or null (unclosed, empty, or just a
     * dollar amount) so the text stays as typed. The search stops at a blank line, so a stray marker never swallows the
     * rest of a reply.
     */
    private fun mathBlock(lines: List<String>, at: Int): Pair<String, Int>? {
        val first = dollarLine.matchEntire(lines[at])?.groupValues?.get(1) ?: return null
        val one = first.trimEnd()
        if (one.endsWith(DD)) {
            val inner = one.removeSuffix(DD)
            return if (inner.contains(DD) || inner.isBlank()) null else inner.trim() to at + 1
        }
        if (first.contains(DD)) return null
        val body = ArrayList<String>()
        if (first.isNotBlank()) body += first.trim()
        var j = at + 1
        while (j < lines.size && j - at <= MAX_MATH_LINES) {
            val l = lines[j]
            if (l.isBlank()) return null
            val t = l.trimEnd()
            if (t.endsWith(DD)) {
                val last = t.removeSuffix(DD)
                if (last.contains(DD)) return null
                if (last.isNotBlank()) body += last.trim()
                return if (body.isEmpty()) null else body.joinToString("\n") to j + 1
            }
            if (t.contains(DD)) return null
            body += l.trim()
            j++
        }
        return null
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
                            inline(s.substring(i + 1, close)).mapTo(out) { it.copy(link = safeLink(url)) }
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

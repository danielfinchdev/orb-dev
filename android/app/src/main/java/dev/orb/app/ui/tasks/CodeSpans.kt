package dev.orb.app.ui.tasks

import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.withStyle

/**
 * Draws file names and `backticked` words of a task's text in the monospaced face, as the mockup's `<code>` does. A name is
 * recognised only by a known extension, so a version number or an abbreviation with a dot stays plain text.
 */
object CodeSpans {
    private val EXTENSIONS = setOf(
        "html", "htm", "css", "scss", "js", "mjs", "cjs", "ts", "tsx", "jsx", "json", "md", "txt", "csv", "xml", "yml", "yaml", "toml", "lock",
        "kt", "kts", "java", "rs", "py", "go", "rb", "php", "c", "h", "cpp", "sh", "bat", "ps1", "sql", "svg", "png", "jpg", "jpeg", "gif", "webp", "pdf", "env",
    )

    // A name, optionally with folders, whose last part is `.ext`.
    private val FILE = Regex("""(?<![\w./\\-])[\w.-]+(?:[/\\][\w.-]+)*\.([A-Za-z0-9]{1,5})(?![\w-])""")
    private val TICKS = Regex("`([^`\n]+)`")

    /** [text] with its code parts in monospace; the backticks themselves are not shown. */
    fun of(text: String): AnnotatedString = buildAnnotatedString {
        val mono = SpanStyle(fontFamily = FontFamily.Monospace)
        var at = 0
        for (m in TICKS.findAll(text)) {
            plain(text.substring(at, m.range.first), mono)
            withStyle(mono) { append(m.groupValues[1]) }
            at = m.range.last + 1
        }
        plain(text.substring(at), mono)
    }

    private fun AnnotatedString.Builder.plain(part: String, mono: SpanStyle) {
        var at = 0
        for (m in FILE.findAll(part)) {
            if (m.groupValues[1].lowercase() !in EXTENSIONS) continue
            append(part.substring(at, m.range.first))
            withStyle(mono) { append(m.value) }
            at = m.range.last + 1
        }
        append(part.substring(at))
    }
}

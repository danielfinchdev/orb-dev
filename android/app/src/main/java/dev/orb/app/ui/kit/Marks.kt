package dev.orb.app.ui.kit

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.orb.app.ui.theme.oklch
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin

/** The two hues and the angle of a project's dot, derived from its name exactly like the mockups and the desktop. */
class ProjectDotSpec(val hueA: Int, val hueB: Int, val angle: Int)

object ProjectDotMath {
    /** FNV-1a over the code points of [name], kept in 32 bits. */
    fun hash(name: String): Long {
        var h = 2166136261L
        var i = 0
        while (i < name.length) {
            val cp = name.codePointAt(i)
            h = h xor cp.toLong()
            h = (h * 16777619L) and 0xFFFFFFFFL
            i += Character.charCount(cp)
        }
        return h
    }

    fun spec(name: String): ProjectDotSpec {
        val h = hash(name)
        val a = (h % 360).toInt()
        val b = ((a + 40 + (h ushr 9) % 80) % 360).toInt()
        return ProjectDotSpec(a, b, ((h ushr 17) % 360).toInt())
    }

    /** CSS `hsl()` to a colour. */
    fun hsl(h: Int, s: Float, l: Float): Color {
        val c = (1f - abs(2f * l - 1f)) * s
        val hp = (h % 360) / 60f
        val x = c * (1f - abs(hp % 2f - 1f))
        val (r, g, b) = when (hp.toInt()) {
            0 -> Triple(c, x, 0f)
            1 -> Triple(x, c, 0f)
            2 -> Triple(0f, c, x)
            3 -> Triple(0f, x, c)
            4 -> Triple(x, 0f, c)
            else -> Triple(c, 0f, x)
        }
        val m = l - c / 2f
        return Color(r + m, g + m, b + m)
    }

    fun first(spec: ProjectDotSpec) = hsl(spec.hueA, 0.95f, 0.58f)
    fun second(spec: ProjectDotSpec) = hsl(spec.hueB, 0.90f, 0.52f)
}

/** Sizes of the dot: 8 inside dense lines, 10 in group headers and rows, 48 on a project's page. */
object ProjectDotSize {
    val Small = 8.dp
    val Normal = 10.dp
    val Large = 48.dp
}

/**
 * A project's identity: a round gradient drawn from its name (never letters). A null [name] is «Sin proyecto»,
 * drawn as a hollow ring.
 */
@Composable
fun ProjectDot(name: String?, modifier: Modifier = Modifier, size: Dp = ProjectDotSize.Normal) {
    val spec = remember(name) { name?.let(ProjectDotMath::spec) }
    val ring = OrbKit.faintForeground
    Canvas(modifier.size(size).clearAndSetSemantics {}) {
        if (spec == null) {
            val w = 1.dp.toPx()
            drawCircle(ring, radius = (this.size.minDimension - w) / 2f, style = Stroke(w))
        } else {
            // CSS gradient line: 0deg points up and turns clockwise; its length makes the corners reach the end colours.
            val rad = Math.toRadians(spec.angle.toDouble())
            val dx = sin(rad).toFloat()
            val dy = -cos(rad).toFloat()
            val half = (abs(this.size.width * dx) + abs(this.size.height * dy)) / 2f
            val c = Offset(this.size.width / 2f, this.size.height / 2f)
            drawCircle(
                Brush.linearGradient(
                    listOf(ProjectDotMath.first(spec), ProjectDotMath.second(spec)),
                    start = Offset(c.x - dx * half, c.y - dy * half), end = Offset(c.x + dx * half, c.y + dy * half),
                ),
            )
        }
    }
}

/** The agents with a mark of their own; any other agent gets a neutral dot. */
object AgentGlyphs {
    fun glyph(agent: String?): String? = when (agent?.lowercase()) {
        "claude" -> "✳"
        "codex" -> "◎"
        "cursor" -> "▲"
        "orbe" -> "●"
        else -> null
    }

    fun name(agent: String?): String = when (agent?.lowercase()) {
        "claude" -> "Claude"
        "codex" -> "Codex"
        "cursor" -> "Cursor"
        "orbe" -> "Orbe"
        null, "" -> "Agente"
        else -> agent
    }
}

/** The mark of an agent, with no background: ✳ Claude, ◎ Codex, ▲ Cursor, ● Orbe. */
@Composable
fun AgentMark(agent: String?, modifier: Modifier = Modifier, size: Dp = 16.dp, description: String? = AgentGlyphs.name(agent)) {
    val glyph = AgentGlyphs.glyph(agent)
    val color = when (agent?.lowercase()) {
        "claude" -> remember { oklch(0.62, 0.17, 40.0) }
        "codex", "cursor" -> OrbKit.foreground
        "orbe" -> OrbKit.info
        else -> OrbKit.faintForeground
    }
    val semantics = Modifier.clearAndSetSemantics { if (description != null) contentDescription = description }
    if (glyph == null) {
        Canvas(modifier.size(size).then(semantics)) { drawCircle(color, radius = 4.dp.toPx()) }
    } else {
        Box(modifier.size(size).then(semantics), contentAlignment = Alignment.Center) {
            Text(glyph, color = color, style = TextStyle(fontSize = 14.5.sp, lineHeight = 14.5.sp))
        }
    }
}

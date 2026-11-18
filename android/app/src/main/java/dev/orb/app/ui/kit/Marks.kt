package dev.orb.app.ui.kit

import androidx.compose.foundation.Canvas
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.material3.Icon
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.graphicsLayer
import dev.orb.app.ui.icons.OrbIcons
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
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

/**
 * The mark of an agent, with no background, drawn as a vector so it has the same size and weight on every phone:
 * ✳ Claude, ◎ Codex, ▲ Cursor, ● Orbe. [size] is the box; the drawing is what the mockups' 14.5 px glyph shows in a
 * 16 px box: about 11 dp across for ✳ ◎ ▲ with hairline strokes, and 7 to 8 dp for ●.
 */
@Composable
fun AgentMark(agent: String?, modifier: Modifier = Modifier, size: Dp = 16.dp, description: String? = AgentGlyphs.name(agent)) {
    val kind = agent?.lowercase()
    val color = when (kind) {
        "claude" -> remember { oklch(0.62, 0.17, 40.0) }
        "codex", "cursor" -> OrbKit.foreground
        "orbe" -> OrbKit.info
        else -> OrbKit.faintForeground
    }
    val semantics = Modifier.clearAndSetSemantics { if (description != null) contentDescription = description }
    Canvas(modifier.size(size).then(semantics)) {
        val s = this.size.minDimension
        val c = Offset(this.size.width / 2f, this.size.height / 2f)
        when (kind) {
            "claude" -> {
                // Eight spokes: four lines through the centre.
                val r = s * 0.34f
                for (k in 0 until 4) {
                    val a = Math.toRadians(k * 45.0)
                    val d = Offset((cos(a) * r).toFloat(), (sin(a) * r).toFloat())
                    drawLine(color, c - d, c + d, strokeWidth = s * 0.075f, cap = StrokeCap.Round)
                }
            }
            "codex" -> {
                val w = s * 0.09f
                drawCircle(color, radius = s * 0.36f - w / 2f, center = c, style = Stroke(w))
                drawCircle(color, radius = s * 0.15f, center = c, style = Stroke(w))
            }
            "cursor" -> {
                val tri = Path().apply {
                    moveTo(s * 0.50f, s * 0.20f); lineTo(s * 0.84f, s * 0.74f); lineTo(s * 0.16f, s * 0.74f); close()
                }
                drawPath(tri, color)
                drawPath(tri, color, style = Stroke(s * 0.04f, join = StrokeJoin.Round))
            }
            "orbe" -> drawCircle(color, radius = s * 0.23f, center = c)
            else -> drawCircle(color, radius = s * 0.20f, center = c)
        }
    }
}

/** A 14 dp (by default) loader that turns forever; the turn is a layer property, so nothing is measured or drawn again. */
@Composable
fun OrbSpinner(modifier: Modifier = Modifier, size: Dp = 14.dp, tint: Color = OrbKit.mutedForeground) {
    val reduced = reducedMotion()
    val angle = if (reduced) null else rememberInfiniteTransition(label = "spinner").animateFloat(
        0f, 360f, infiniteRepeatable(tween(1000, easing = LinearEasing), RepeatMode.Restart), label = "angle",
    )
    Icon(
        OrbIcons.Loader, null, modifier.size(size).graphicsLayer { rotationZ = angle?.value ?: 0f }, tint = tint,
    )
}

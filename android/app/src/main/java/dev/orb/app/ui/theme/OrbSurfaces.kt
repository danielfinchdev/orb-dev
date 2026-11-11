package dev.orb.app.ui.theme

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.border
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.unit.dp

// One soft blob of the field: centre and radii as fractions of the screen, and where the colour fades out (the CSS ellipses).
private class Blob(val cx: Float, val cy: Float, val rx: Float, val ry: Float, val color: (OrbColors) -> Color, val fade: Float)

// Same layers as th-cristal.css; the first one in the CSS is on top, so they are drawn in reverse.
private val blobs = listOf(
    Blob(0.00f, 0.04f, 0.40f, 0.52f, { it.field1 }, 0.74f),
    Blob(0.04f, 1.00f, 0.30f, 0.46f, { it.field2 }, 0.72f),
    Blob(1.00f, 1.00f, 0.44f, 0.60f, { it.field2 }, 0.72f),
    Blob(0.40f, 1.08f, 0.40f, 0.50f, { it.field3 }, 0.70f),
    Blob(0.96f, 0.06f, 0.34f, 0.44f, { it.field4 }, 0.70f),
    Blob(0.20f, 0.50f, 0.30f, 0.44f, { it.field3.copy(alpha = it.field3.alpha * 0.85f) }, 0.72f),
    Blob(0.60f, 0.44f, 0.34f, 0.46f, { it.field1.copy(alpha = it.field1.alpha * 0.45f) }, 0.70f),
)

private fun Modifier.colourField(c: OrbColors): Modifier = background(c.fieldBase).drawWithCache {
    // Brushes are built once per size/colour change; the field never animates by itself.
    val w = size.width
    val h = size.height
    val layers = blobs.asReversed().map { b ->
        val col = b.color(c)
        val centre = Offset(b.cx * w, b.cy * h)
        val radius = (b.rx * w).coerceAtLeast(1f)
        // Fade to the same colour at zero alpha: fading to black would dirty the middle of the gradient.
        val brush = Brush.radialGradient(0f to col, b.fade to col.copy(alpha = 0f), center = centre, radius = radius)
        Triple(brush, centre, Pair(radius, (b.ry * h) / radius))
    }
    onDrawBehind {
        for ((brush, centre, r) in layers) {
            // A circle squashed vertically is the CSS ellipse.
            scale(1f, r.second, pivot = centre) {
                drawRect(brush, topLeft = Offset(centre.x - r.first, centre.y - r.first), size = androidx.compose.ui.geometry.Size(r.first * 2, r.first * 2))
            }
        }
    }
}

/** Órbita: the flat `bg`. Cristal: a still colour field (radial gradients over the base colour). */
@Composable
fun OrbBackground(modifier: Modifier = Modifier.fillMaxSize(), content: @Composable BoxScope.() -> Unit) {
    val c = OrbTheme.colors
    val look = if (c.isGlass) Modifier.colourField(c) else Modifier.background(MaterialTheme.colorScheme.background)
    Box(modifier.then(look), content = content)
}

/**
 * Bars, floating tabs and the composer. Cristal: translucent fill, a light rim along the top and a soft shadow. Only
 * translucency, no blur: Modifier.blur blurs the node's own content, not what is behind it, and a real backdrop blur
 * would cost too much inside scrolling lists. Órbita: a plain raised surface with a hairline border.
 */
@Composable
fun GlassSurface(
    modifier: Modifier = Modifier,
    shape: Shape = RoundedCornerShape(28.dp),
    content: @Composable BoxScope.() -> Unit,
) {
    val c = OrbTheme.colors
    val scheme = MaterialTheme.colorScheme
    val look = if (c.isGlass) {
        Modifier
            .shadow(8.dp, shape, ambientColor = c.rimEdge, spotColor = Color.Black.copy(alpha = 0.25f))
            .clip(shape)
            .background(Brush.verticalGradient(listOf(c.barTop, c.barBottom)))
            .border(BorderStroke(1.dp, Brush.verticalGradient(listOf(c.rimTop, c.rimEdge))), shape)
    } else {
        Modifier.clip(shape).background(scheme.surfaceContainerLow).border(BorderStroke(1.dp, scheme.outlineVariant), shape)
    }
    Box(modifier.then(look), content = content)
}

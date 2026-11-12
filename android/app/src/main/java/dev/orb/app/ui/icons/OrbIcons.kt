package dev.orb.app.ui.icons

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.dp

// The few Lucide icons the design uses, drawn as vectors so the app does not ship the whole icon pack.
private fun lucide(name: String, vararg paths: String): ImageVector =
    ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f).apply {
        for (d in paths) {
            addPath(
                pathData = addPathNodes(d), fill = null, stroke = SolidColor(Color.Black), strokeLineWidth = 2f,
                strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round,
            )
        }
    }.build()

// "circle" helper: cx, cy, r as two arcs.
private fun circle(cx: Float, cy: Float, r: Float) = "M${cx - r} $cy a$r $r 0 1 0 ${2 * r} 0 a$r $r 0 1 0 ${-2 * r} 0"

object OrbIcons {
    val Menu by lazy { lucide("menu", "M4 5h16", "M4 12h16", "M4 19h16") }
    val Search by lazy { lucide("search", "m21 21-4.34-4.34", circle(11f, 11f, 8f)) }
    val Plus by lazy { lucide("plus", "M5 12h14", "M12 5v14") }
    val Check by lazy { lucide("check", "M20 6 9 17l-5-5") }
    val CheckCheck by lazy { lucide("check-check", "M18 6 7 17l-5-5", "m22 10-7.5 7.5L13 16") }
    val Close by lazy { lucide("x", "M18 6 6 18", "m6 6 12 12") }
    val ArrowLeft by lazy { lucide("arrow-left", "m12 19-7-7 7-7", "M19 12H5") }
    val Chat by lazy {
        lucide("message-square", "M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z")
    }
    val Tasks by lazy {
        lucide("list-checks", "M4 5h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z", "m3 17 2 2 4-4", "M13 6h8", "M13 12h8", "M13 18h8")
    }
    val Folder by lazy {
        lucide("folder", "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z")
    }
    val Pin by lazy {
        lucide(
            "pin", "M12 17v5",
            "M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z",
        )
    }
    val Bell by lazy {
        lucide("bell", "M10.268 21a2 2 0 0 0 3.464 0", "M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326")
    }
    val BellOff by lazy {
        lucide(
            "bell-off", "M10.268 21a2 2 0 0 0 3.464 0", "M17 17H4a1 1 0 0 1-.74-1.673C4.59 13.956 6 12.499 6 8a6 6 0 0 1 .258-1.742",
            "m2 2 20 20", "M8.668 3.01A6 6 0 0 1 18 8c0 2.687.77 4.653 1.707 6.05",
        )
    }
    val Gauge by lazy { lucide("gauge", "m12 14 4-4", "M3.34 19a10 10 0 1 1 17.32 0") }
    val Clock by lazy { lucide("clock", circle(12f, 12f, 10f), "M12 6v6l4 2") }
    val Shield by lazy {
        lucide("shield-alert", "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z", "M12 8v4", "M12 16h.01")
    }
    val Loader by lazy { lucide("loader-circle", "M21 12a9 9 0 1 1-6.219-8.56") }
    val Archive by lazy {
        lucide("archive", "M3 3h18a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z", "M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8", "M10 12h4")
    }
    val Trash by lazy {
        lucide("trash-2", "M3 6h18", "M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6", "M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2", "M10 11v6", "M14 11v6")
    }
    val Pencil by lazy {
        lucide("pencil", "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z", "m15 5 4 4")
    }
    val FolderInput by lazy {
        lucide(
            "folder-input", "M2 9V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-1",
            "M2 13h10", "m9 16 3-3-3-3",
        )
    }
    val Palette by lazy {
        lucide(
            "palette", "M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z",
            "M13.5 6.5h.01", "M17.5 10.5h.01", "M6.5 12.5h.01", "M8.5 7.5h.01",
        )
    }
    val Activity by lazy {
        lucide("activity", "M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2")
    }
    val LogOut by lazy { lucide("log-out", "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4", "m16 17 5-5-5-5", "M21 12H9") }
    val Send by lazy {
        lucide(
            "send",
            "M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z",
            "m21.854 2.147-10.94 10.939",
        )
    }
    val Square by lazy { lucide("square", "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z") }
    val ArrowDown by lazy { lucide("arrow-down", "M12 5v14", "m19 12-7 7-7-7") }
    val ChevronDown by lazy { lucide("chevron-down", "m6 9 6 6 6-6") }
    val MoreVertical by lazy { lucide("ellipsis-vertical", circle(12f, 12f, 1f), circle(12f, 5f, 1f), circle(12f, 19f, 1f)) }
    val ArrowUp by lazy { lucide("arrow-up", "m5 12 7-7 7 7", "M12 19V5") }
    val ChevronUp by lazy { lucide("chevron-up", "m18 15-6-6-6 6") }
    val ChevronRight by lazy { lucide("chevron-right", "m9 18 6-6-6-6") }
    val ListOrdered by lazy {
        lucide("list-ordered", "M11 5h10", "M11 12h10", "M11 19h10", "M4 4h1v5", "M4 9h2", "M6.5 20H3.4c0-1 2.6-1.925 2.6-3.5a1.5 1.5 0 0 0-2.6-1.02")
    }
    val Camera by lazy {
        lucide(
            "camera", "M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z",
            circle(12f, 13f, 3f),
        )
    }
    val Image by lazy { lucide("image", "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", circle(9f, 9f, 2f), "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21") }
    val File by lazy { lucide("file", "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z", "M14 2v5a1 1 0 0 0 1 1h5") }
}

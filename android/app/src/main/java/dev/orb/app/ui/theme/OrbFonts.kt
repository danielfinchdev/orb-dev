package dev.orb.app.ui.theme

import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import dev.orb.app.R

/**
 * The mockups' `--title` face (Outfit 600). Only titles use it: header name, wordmark, sheet and dialog titles, empty
 * states, big figures and section titles. Everything else keeps the system font; glyphs Outfit lacks fall back to it.
 */
object OrbFonts {
    val title: FontFamily = FontFamily(Font(R.font.outfit_semibold, FontWeight.SemiBold))
}

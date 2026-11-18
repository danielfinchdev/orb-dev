package dev.orb.app.ui.shell

import androidx.compose.foundation.layout.RowScope
import androidx.compose.runtime.Composable
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.kit.OrbIconButton
import dev.orb.app.ui.kit.OrbTopBar

/** The top bar of a screen that is opened from the menu: back arrow, title, an optional line under it and actions on the right. */
@Composable
fun ScreenBar(title: String, onBack: () -> Unit, backLabel: String = "Volver", sub: String? = null, actions: @Composable RowScope.() -> Unit = {}) {
    OrbTopBar(title, sub = sub, leading = { OrbIconButton(OrbIcons.ArrowLeft, backLabel, onBack) }, actions = actions)
}

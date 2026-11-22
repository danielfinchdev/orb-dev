package dev.orb.app.ui.thisphone

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.orb.app.lock.LockDelay
import dev.orb.app.notify.LockScreenNotice
import dev.orb.app.notify.NoteChannel
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.kit.OrbBadge
import dev.orb.app.ui.kit.OrbBadgeKind
import dev.orb.app.ui.kit.OrbButton
import dev.orb.app.ui.kit.OrbButtonKind
import dev.orb.app.ui.kit.OrbCard
import dev.orb.app.ui.kit.OrbDialog
import dev.orb.app.ui.kit.OrbDialogAction
import dev.orb.app.ui.kit.OrbKit
import dev.orb.app.ui.kit.OrbNote
import dev.orb.app.ui.kit.OrbSettingRow
import dev.orb.app.ui.kit.OrbSheet
import dev.orb.app.ui.kit.OrbSheetItem
import dev.orb.app.ui.kit.OrbSwitch
import dev.orb.app.ui.settings.AppearanceCard
import dev.orb.app.ui.shell.ScreenBar
import dev.orb.app.ui.theme.ThemePrefs

/**
 * The «Este móvil» screen, as the mockup draws it: the link (PC, fingerprint, route), the notices, the look, the security
 * and the way to unlink. What the mockup does not draw but the phone keeps (the connection test) is under «Más opciones».
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ThisPhoneScreen(
    vm: ThisPhoneViewModel, theme: ThemePrefs, onBack: () -> Unit, onLinkTest: () -> Unit, onUnlinked: () -> Unit, modifier: Modifier = Modifier,
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val look by theme.settings.collectAsStateWithLifecycle()
    var confirming by rememberSaveable { mutableStateOf(false) }
    var lockScreenSheet by rememberSaveable { mutableStateOf(false) }
    var channelsSheet by rememberSaveable { mutableStateOf(false) }
    var lockSheet by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(state.unlinked) { if (state.unlinked) onUnlinked() }
    // Everything the person can change in Android's settings is read again each time the screen comes back.
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { vm.refresh() }
    // One measurement each time the PC becomes reachable (the screen opening included), never a loop.
    LaunchedEffect(state.online) { if (state.online) vm.measure() }

    Column(modifier.fillMaxSize()) {
        ScreenBar(ThisPhoneTexts.TITLE, onBack, ThisPhoneTexts.BACK, sub = ThisPhoneTexts.headerSub(state.pcName, state.connection))
        PullToRefreshBox(isRefreshing = state.measuring, onRefresh = vm::measure, modifier = Modifier.weight(1f).fillMaxWidth()) {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                Group(ThisPhoneTexts.SECTION_LINK)
                LinkCard(state)

                Group(ThisPhoneTexts.SECTION_NOTICES)
                Padded {
                    OrbCard {
                        // «On» only when a notice can really arrive: a channel turned off in Android counts as off too.
                        SwitchRow(ThisPhoneTexts.NOTICES, ThisPhoneTexts.NOTICES_HINT, state.notices.working, { vm.toggleNotifications() }, divider = false)
                        // Without the permission nothing can arrive: say it, and give the way to ask for it or to Android's settings.
                        if (!state.notices.allowed) {
                            OrbSettingRow(
                                ThisPhoneTexts.NOTICES_OFF,
                                subtitle = if (state.notices.canAsk) ThisPhoneTexts.NOTICES_OFF_HINT else ThisPhoneTexts.NOTICES_OFF_SETTINGS_HINT,
                                trailing = {
                                    OrbButton(
                                        if (state.notices.canAsk) ThisPhoneTexts.ALLOW else ThisPhoneTexts.OPEN_SETTINGS,
                                        vm::requestNotifications, small = true,
                                    )
                                },
                            )
                        } else if (state.notices.offChannels.isNotEmpty()) {
                            OrbSettingRow(
                                ThisPhoneTexts.NOTICES_CHANNEL_OFF, subtitle = ThisPhoneTexts.channelsOffHint(state.notices.offChannels),
                                trailing = { OrbButton(ThisPhoneTexts.OPEN_SETTINGS, vm::fixChannels, small = true) },
                            )
                        }
                        SwitchRow(ThisPhoneTexts.KEEP, ThisPhoneTexts.KEEP_HINT, state.keepConnected, vm::setKeepConnected)
                        OrbSettingRow(
                            ThisPhoneTexts.LOCK_SCREEN, onClick = { lockScreenSheet = true },
                            subtitle = if (state.appLock) ThisPhoneTexts.LOCK_SCREEN_WITH_LOCK else ThisPhoneTexts.lockScreenChoice(state.lockScreen),
                            trailing = { Chevron() },
                        )
                        OrbSettingRow(
                            ThisPhoneTexts.CHANNELS, subtitle = ThisPhoneTexts.CHANNELS_HINT, onClick = { channelsSheet = true },
                            trailing = { Chevron() },
                        )
                    }
                }
                // What the service shows and does not use: said once, quietly, under the card.
                OrbNote(ThisPhoneTexts.KEEP_NOTE, Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
                // Android may still close the app to save battery: the way to that setting is one tap from here.
                Box(Modifier.padding(horizontal = 16.dp)) {
                    OrbButton(ThisPhoneTexts.BATTERY_LINK, vm::openBatterySettings, small = true, kind = OrbButtonKind.Ghost)
                }

                Group(ThisPhoneTexts.SECTION_LOOK)
                Padded { AppearanceCard(look, theme::setPalette, theme::setDark) }

                Group(ThisPhoneTexts.SECTION_SECURITY)
                Padded {
                    OrbCard {
                        // Turning it off stays possible whatever Android now has; only turning it on needs something to authenticate with.
                        val usable = state.lockAvailable || state.appLock
                        OrbSettingRow(
                            ThisPhoneTexts.APP_LOCK, divider = false, onClick = if (usable) ({ lockSheet = true }) else null,
                            subtitle = if (usable) ThisPhoneTexts.lockChoice(if (state.appLock) state.lockDelay else null) else ThisPhoneTexts.FINGERPRINT_UNAVAILABLE,
                            trailing = { OrbSwitch(state.appLock, vm::setAppLock, label = ThisPhoneTexts.APP_LOCK, enabled = usable) },
                        )
                    }
                }
                state.lockMessage?.let {
                    Text(it, Modifier.padding(horizontal = 16.dp, vertical = 8.dp), color = OrbKit.warningInk, fontSize = 13.sp, lineHeight = 18.sp)
                }

                Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    OrbButton(
                        ThisPhoneTexts.UNLINK, { confirming = true }, Modifier.fillMaxWidth(), kind = OrbButtonKind.Danger, block = true,
                        enabled = !state.unlinking, icon = OrbIcons.Unlink,
                    )
                    OrbNote(ThisPhoneTexts.UNLINK_NOTE)
                }

                // What the mockup does not draw but the phone keeps.
                Group(ThisPhoneTexts.MORE_OPTIONS)
                Padded {
                    OrbCard {
                        OrbSettingRow(
                            ThisPhoneTexts.LINK_TEST, subtitle = ThisPhoneTexts.LINK_TEST_HINT, onClick = onLinkTest,
                            trailing = { Chevron() },
                        )
                        // What the person can change about Orb in Android, shown as the system has it right now.
                        OrbSettingRow(
                            ThisPhoneTexts.CAMERA, subtitle = when (state.camera) {
                                CameraState.Allowed -> ThisPhoneTexts.CAMERA_ON
                                CameraState.NotAllowed -> ThisPhoneTexts.CAMERA_OFF
                                CameraState.None -> ThisPhoneTexts.CAMERA_NONE
                            },
                            trailing = if (state.camera == CameraState.None) null else ({ OrbButton(ThisPhoneTexts.SETTINGS, vm::openCameraSettings, small = true) }),
                        )
                        OrbSettingRow(
                            ThisPhoneTexts.BATTERY, divider = false,
                            subtitle = if (state.batteryRestricted) ThisPhoneTexts.BATTERY_RESTRICTED else ThisPhoneTexts.BATTERY_FREE,
                            trailing = { OrbButton(ThisPhoneTexts.SETTINGS, vm::openBatterySettings, small = true) },
                        )
                    }
                }
                Box(Modifier.size(24.dp))
            }
        }
    }

    if (lockScreenSheet) {
        OrbSheet({ lockScreenSheet = false }, title = ThisPhoneTexts.LOCK_SCREEN) {
            for (mode in LockScreenNotice.entries) {
                Choice(ThisPhoneTexts.lockScreenChoice(mode), state.lockScreen == mode) { vm.setLockScreen(mode); lockScreenSheet = false }
            }
        }
    }
    if (channelsSheet) {
        OrbSheet({ channelsSheet = false }, title = ThisPhoneTexts.CHANNELS) {
            for (c in NoteChannel.entries) {
                OrbSheetItem(ThisPhoneTexts.channel(c), { vm.openChannelSettings(c); channelsSheet = false }, icon = OrbIcons.Bell, chevron = true)
            }
            OrbNote(ThisPhoneTexts.CHANNELS_NOTE, Modifier.padding(horizontal = 20.dp, vertical = 8.dp))
        }
    }
    if (lockSheet) {
        OrbSheet({ lockSheet = false }, title = ThisPhoneTexts.APP_LOCK) {
            val options: List<LockDelay?> = listOf(null, LockDelay.Immediate, LockDelay.FiveMinutes, LockDelay.FifteenMinutes)
            for (o in options) {
                Choice(ThisPhoneTexts.lockChoice(o), (if (state.appLock) state.lockDelay else null) == o) { vm.chooseLock(o); lockSheet = false }
            }
        }
    }
    if (confirming) {
        OrbDialog(
            { confirming = false }, ThisPhoneTexts.UNLINK_TITLE, OrbDialogAction(ThisPhoneTexts.UNLINK_CONFIRM, { confirming = false; vm.unlink() }),
            text = ThisPhoneTexts.unlinkBody(state.pcName), dismiss = OrbDialogAction(ThisPhoneTexts.CANCEL, { confirming = false }),
        )
    }
}

/** `.mgrp b`: the heading of a group of cards. */
@Composable
private fun Group(title: String) {
    Text(
        title, Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 6.dp).semantics { heading() },
        color = OrbKit.foreground, fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.Medium,
    )
}

/** `.pad`: the 16 dp the cards keep from the edges. */
@Composable
private fun Padded(content: @Composable () -> Unit) {
    Box(Modifier.padding(horizontal = 16.dp)) { content() }
}

@Composable
private fun Chevron() {
    Icon(OrbIcons.ChevronRight, null, Modifier.size(20.dp), tint = OrbKit.faintForeground)
}

/** A row whose whole body is the switch, announced as one. */
@Composable
private fun SwitchRow(title: String, subtitle: String, checked: Boolean, onChange: (Boolean) -> Unit, divider: Boolean = true) {
    OrbSettingRow(
        title, Modifier.toggleable(value = checked, role = Role.Switch, onValueChange = onChange), subtitle = subtitle, divider = divider,
        trailing = { OrbSwitch(checked, null) },
    )
}

/** A choice of a sheet, as the mockup draws it: a check in front of the chosen one, an empty circle in front of the others. */
@Composable
private fun Choice(text: String, selected: Boolean, onClick: () -> Unit) {
    OrbSheetItem(
        text, onClick, Modifier.semantics { this.selected = selected },
        icon = if (selected) OrbIcons.Check else OrbIcons.Circle,
    )
}

@Composable
private fun LinkCard(s: ThisPhoneState) {
    Padded {
        OrbCard {
            Column(Modifier.padding(horizontal = 16.dp, vertical = 14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                // The PC cannot be reached: say so before the details, which then describe the last known link.
                if (!s.online && s.connection !is dev.orb.app.link.net.ConnectionState.Connecting) {
                    OrbBadge(ThisPhoneTexts.link(s.connection).substringBefore(" · "), kind = OrbBadgeKind.Warn)
                }
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Kv(OrbIcons.Monitor, ThisPhoneTexts.LINK_PC, s.pcName?.takeIf { it.isNotBlank() } ?: ThisPhoneTexts.NO_NAME)
                    Kv(OrbIcons.Fingerprint, ThisPhoneTexts.LINK_FINGERPRINT, s.fingerprint ?: ThisPhoneTexts.NO_FINGERPRINT, mono = true)
                    Kv(OrbIcons.Route, ThisPhoneTexts.LINK_ROUTE, ThisPhoneTexts.route(s))
                    // Every way to the PC with the last time it worked, so a failure can be told apart (home Wi-Fi or Tailscale).
                    s.paths.forEach { Kv(OrbIcons.Route, it.label, it.text) }
                }
            }
        }
    }
}

/** `.kv-m`: a key with its small icon and the value after it. */
@Composable
private fun Kv(icon: ImageVector, key: String, value: String, mono: Boolean = false) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.Top) {
        Row(Modifier.width(88.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, null, Modifier.size(16.dp), tint = OrbKit.mutedForeground)
            Text(key, color = OrbKit.mutedForeground, fontSize = 14.5.sp, lineHeight = 21.sp)
        }
        Text(
            value, Modifier.weight(1f), color = OrbKit.foreground, fontSize = 14.5.sp, lineHeight = 21.sp,
            fontFamily = if (mono) FontFamily.Monospace else FontFamily.Default,
        )
    }
}

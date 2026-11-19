package dev.orb.app.ui.offline

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.delay
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.kit.OrbBanner
import dev.orb.app.ui.kit.OrbBannerKind
import dev.orb.app.ui.kit.OrbButton
import dev.orb.app.ui.kit.OrbButtonKind
import dev.orb.app.ui.kit.OrbDialog
import dev.orb.app.ui.kit.OrbDialogAction
import dev.orb.app.ui.kit.OrbIconButton
import dev.orb.app.ui.kit.OrbKit
import dev.orb.app.ui.kit.OrbNote
import dev.orb.app.ui.kit.OrbProgress
import dev.orb.app.ui.kit.OrbSpinner
import dev.orb.app.ui.kit.OrbTopBar
import dev.orb.app.ui.kit.OrbWordmark
import dev.orb.app.ui.theme.OrbFonts
import dev.orb.app.ui.thisphone.ThisPhoneTexts
import kotlinx.coroutines.delay

object PcOffTexts {
    const val TITLE = "No llego a tu PC"
    const val NOW = "Ahora"
    const val CONNECTING = "Conectando…"
    const val RETRY_NOTE = "Reintentos a los 3, 6, 12 s… hasta 30 s. Al volver a la app o a la red, al instante."
    const val TAILSCALE = "Fuera de casa: activa Tailscale en el móvil."
    const val SEE_SAVED = "Ver chats guardados"
    const val OTHER_PC = "Vincular con otro PC"
    const val OTHER_PC_TITLE = "¿Vincular con otro PC?"
    const val OTHER_PC_CONFIRM = "Vincular"
    const val UNLINKING = "Desvinculando…"
    const val BACK_TO_PC = "Volver a «No llego a tu PC»"

    fun body(pc: String?) = "${pc?.takeIf { it.isNotBlank() } ?: "Tu PC"} está apagado o fuera de tu red."

    /** Says all of it, in the very words of «Desvincular este móvil»: the link, the saved copy and the unsent messages go. */
    fun otherPcBody(pc: String?) = ThisPhoneTexts.unlinkBody(pc)

    /** The countdown line; a retry already due reads as under way. */
    fun retryIn(nextRetryAt: Long?, now: Long): String {
        if (nextRetryAt == null) return OfflineTexts.RETRYING
        val s = (nextRetryAt - now + 999) / 1000
        return if (s <= 0) OfflineTexts.RETRYING else "Reintento en $s s"
    }
}

/** What the retry line shows: a countdown with how much of the wait has gone, or an attempt in progress. */
sealed interface PcOffRetry {
    data class Waiting(val text: String, val fraction: Float) : PcOffRetry
    data object Connecting : PcOffRetry
}

class PcOffActions(
    val retryNow: () -> Unit = {},
    val seeSaved: () -> Unit = {},
    val linkOther: () -> Unit = {},
    val dismissDialog: () -> Unit = {},
    val confirmOther: () -> Unit = {},
)

/** The 06 page as a pure function of what it shows. */
@Composable
fun PcOffContent(pcName: String?, lastConnection: String, retry: PcOffRetry, confirmingOther: Boolean, actions: PcOffActions, modifier: Modifier = Modifier, unlinking: Boolean = false) {
    Column(modifier.fillMaxSize()) {
        OrbTopBar("Orb", center = { OrbWordmark() })
        Box(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()), contentAlignment = Alignment.Center) {
            Column(Modifier.padding(horizontal = 28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Icon(OrbIcons.WifiOff, null, Modifier.size(24.dp), tint = OrbKit.foreground)
                Text(
                    PcOffTexts.TITLE, Modifier.semantics { heading() }, color = OrbKit.foreground, fontSize = 24.sp, lineHeight = 30.sp,
                    fontFamily = OrbFonts.title, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center,
                )
                Text(
                    PcOffTexts.body(pcName) + "\n" + lastConnection, color = OrbKit.mutedForeground, fontSize = 14.5.sp, lineHeight = 22.sp,
                    textAlign = TextAlign.Center,
                )
                Column(Modifier.fillMaxWidth().padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    when (retry) {
                        is PcOffRetry.Waiting -> {
                            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                    OrbSpinner(tint = OrbKit.primaryText)
                                    Text(retry.text, color = OrbKit.primaryText, fontSize = 13.sp, lineHeight = 18.sp)
                                }
                                OrbButton(PcOffTexts.NOW, actions.retryNow, small = true)
                            }
                            OrbProgress(retry.fraction, description = retry.text)
                            OrbNote(PcOffTexts.RETRY_NOTE)
                        }
                        PcOffRetry.Connecting -> {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                OrbSpinner(tint = OrbKit.primaryText)
                                Text(PcOffTexts.CONNECTING, color = OrbKit.primaryText, fontSize = 13.sp, lineHeight = 18.sp)
                            }
                            OrbProgress(1f, description = PcOffTexts.CONNECTING)
                        }
                    }
                }
                OrbNote(PcOffTexts.TAILSCALE)
            }
        }
        Column(Modifier.padding(start = 20.dp, end = 20.dp, top = 12.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            OrbButton(PcOffTexts.SEE_SAVED, actions.seeSaved, kind = OrbButtonKind.Primary, block = true, icon = OrbIcons.Database, big = true)
            OrbButton(PcOffTexts.OTHER_PC, actions.linkOther, kind = OrbButtonKind.Secondary, block = true, big = true)
        }
    }
    if (confirmingOther) {
        OrbDialog(
            actions.dismissDialog, PcOffTexts.OTHER_PC_TITLE, OrbDialogAction(if (unlinking) PcOffTexts.UNLINKING else PcOffTexts.OTHER_PC_CONFIRM, actions.confirmOther, enabled = !unlinking),
            text = PcOffTexts.otherPcBody(pcName), dismiss = OrbDialogAction(ThisPhoneTexts.CANCEL, actions.dismissDialog),
        )
    }
}

/**
 * «No llego a tu PC»: why the app is empty-handed, the real countdown to the next attempt, the way to try now and the ways out.
 * [onSeeSaved] enters the read-only app; [onLinkOther] runs after the dialog said everything that is erased.
 */
@Composable
fun PcOffScreen(info: OfflineInfo, onSeeSaved: () -> Unit, onLinkOther: () -> Unit, modifier: Modifier = Modifier, unlinking: Boolean = false) {
    val connection by info.connection.collectAsStateWithLifecycle()
    val lastContact by info.lastContact.collectAsStateWithLifecycle()
    val now by produceState(info.clock(), info) { while (true) { value = info.clock(); delay(1_000) } }
    var confirming by rememberSaveable { mutableStateOf(false) }
    val offline = connection as? ConnectionState.Offline
    val seen = offline?.lastSeen ?: lastContact
    // The wait the countdown started from, so the bar shows how much of it has gone.
    val total = remember(offline?.nextRetryAt) { offline?.nextRetryAt?.let { (it - info.clock()).coerceAtLeast(1L) } }
    val retry = when {
        offline == null -> PcOffRetry.Connecting
        offline.nextRetryAt == null || offline.nextRetryAt - now <= 0 -> PcOffRetry.Connecting
        else -> PcOffRetry.Waiting(
            PcOffTexts.retryIn(offline.nextRetryAt, now),
            if (total == null) 0f else 1f - ((offline.nextRetryAt - now).toFloat() / total).coerceIn(0f, 1f),
        )
    }
    PcOffContent(
        info.pcName(), OfflineTexts.lastConnectionAbsolute(seen, now), retry, confirming,
        PcOffActions(
            retryNow = info.retryNow, seeSaved = onSeeSaved, linkOther = { confirming = true }, dismissDialog = { confirming = false },
            confirmOther = { confirming = false; onLinkOther() },
        ),
        modifier,
        unlinking = unlinking,
    )
}

/** The note of the read-only app: why nothing can be sent, since when the phone has not seen the PC, and the way back. */
@Composable
fun ReadOnlyBar(info: OfflineInfo, onBack: () -> Unit, modifier: Modifier = Modifier) {
    val lastContact by info.lastContact.collectAsStateWithLifecycle()
    val connection by info.connection.collectAsStateWithLifecycle()
    val seen = (connection as? ConnectionState.Offline)?.lastSeen ?: lastContact
    // «Today» in the banner is read again when the screen comes back and when the day turns, not once per composition.
    var now by remember { mutableLongStateOf(info.clock()) }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { now = info.clock() }
    LaunchedEffect(now) {
        delay(OfflineTexts.untilNextDay(now))
        now = info.clock()
    }
    Row(modifier.fillMaxWidth().padding(end = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        OrbIconButton(OrbIcons.ArrowLeft, PcOffTexts.BACK_TO_PC, onBack)
        OrbBanner(OfflineTexts.readOnlyBanner(seen, now), OrbIcons.Database, Modifier.weight(1f), kind = OrbBannerKind.Warning)
    }
}

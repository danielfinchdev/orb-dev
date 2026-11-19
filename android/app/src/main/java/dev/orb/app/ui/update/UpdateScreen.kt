package dev.orb.app.ui.update

import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.kit.OrbBanner
import dev.orb.app.ui.kit.OrbButton
import dev.orb.app.ui.kit.OrbButtonKind
import dev.orb.app.ui.kit.OrbCard
import dev.orb.app.ui.kit.OrbIconButton
import dev.orb.app.ui.kit.OrbKit
import dev.orb.app.ui.kit.OrbNote
import dev.orb.app.ui.kit.OrbTopBar
import dev.orb.app.ui.kit.OrbWordmark
import dev.orb.app.ui.offline.OfflineInfo
import dev.orb.app.ui.offline.PcOffTexts
import dev.orb.app.ui.theme.OrbFonts

class UpdateActions(
    val download: () -> Unit = {},
    val retry: () -> Unit = {},
    val seeSaved: (() -> Unit)? = null,
    val back: (() -> Unit)? = null,
)

/** The 07 page as a pure function of what it shows. [browserMissing] is the answer of the last tap on the download button. */
@Composable
fun UpdateContent(view: UpdateView, browserMissing: Boolean, actions: UpdateActions, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxSize()) {
        OrbTopBar(
            "Orb", center = { OrbWordmark() }, sideWidth = 56.dp,
            leading = { actions.back?.let { OrbIconButton(OrbIcons.ArrowLeft, UpdateTexts.BACK, it) } },
        )
        if (browserMissing) OrbBanner(UpdateTexts.NO_BROWSER, OrbIcons.WifiOff, Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
        Box(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()), contentAlignment = Alignment.Center) {
            Column(Modifier.padding(horizontal = 28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Icon(if (view is UpdateView.UpToDate) OrbIcons.CircleCheck else OrbIcons.Download, null, Modifier.size(24.dp), tint = OrbKit.foreground)
                Text(
                    title(view), Modifier.semantics { heading() }, color = OrbKit.foreground, fontSize = 24.sp, lineHeight = 30.sp,
                    fontFamily = OrbFonts.title, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center,
                )
                Text(body(view), color = OrbKit.mutedForeground, fontSize = 14.5.sp, lineHeight = 22.sp, textAlign = TextAlign.Center)
                OrbCard(Modifier.padding(top = 8.dp)) {
                    Column(Modifier.padding(horizontal = 16.dp, vertical = 14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        VersionLine(UpdateTexts.ON_PHONE, UpdateTexts.phone(view.appVersion))
                        when (view) {
                            is UpdateView.App -> VersionLine(UpdateTexts.PC_ASKS, UpdateTexts.asks(view), bold = true)
                            is UpdateView.Pc -> VersionLine(UpdateTexts.PC_IS, UpdateTexts.pcOld(view), bold = true)
                            is UpdateView.UpToDate -> VersionLine(UpdateTexts.PC_IS, UpdateTexts.pcNow(view.pcLink, view.pcVersion))
                            is UpdateView.Unknown -> Unit
                        }
                    }
                }
            }
        }
        Column(Modifier.padding(start = 20.dp, end = 20.dp, top = 12.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            when (view) {
                is UpdateView.App -> {
                    OrbButton(UpdateTexts.DOWNLOAD, actions.download, kind = OrbButtonKind.Primary, block = true, icon = OrbIcons.Download, big = true)
                    OrbNote(UpdateTexts.DOWNLOAD_NOTE, Modifier.fillMaxWidth(), center = true)
                }
                is UpdateView.Pc -> {
                    OrbButton(UpdateTexts.RETRY, actions.retry, kind = OrbButtonKind.Secondary, block = true, big = true)
                    OrbNote(UpdateTexts.PC_NOTE, Modifier.fillMaxWidth(), center = true)
                }
                is UpdateView.UpToDate -> OrbButton(UpdateTexts.DOWNLOADS, actions.download, kind = OrbButtonKind.Secondary, block = true, big = true)
                is UpdateView.Unknown -> OrbButton(UpdateTexts.RETRY, actions.retry, kind = OrbButtonKind.Secondary, block = true, big = true)
            }
            actions.seeSaved?.let { OrbButton(PcOffTexts.SEE_SAVED, it, kind = OrbButtonKind.Secondary, block = true, icon = OrbIcons.Database, big = true) }
        }
    }
}

@Composable
private fun VersionLine(label: String, value: String, bold: Boolean = false) {
    androidx.compose.foundation.layout.Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        Text(label, Modifier.width(104.dp), color = OrbKit.mutedForeground, fontSize = 14.5.sp, lineHeight = 21.sp)
        Text(
            value, Modifier.weight(1f), color = OrbKit.foreground, fontSize = 14.5.sp, lineHeight = 21.sp,
            fontWeight = if (bold) FontWeight.SemiBold else FontWeight.Normal,
        )
    }
}

private fun title(v: UpdateView) = when (v) {
    is UpdateView.App -> UpdateTexts.TITLE_APP
    is UpdateView.Pc -> UpdateTexts.TITLE_PC
    is UpdateView.UpToDate -> UpdateTexts.TITLE_OK
    is UpdateView.Unknown -> UpdateTexts.TITLE_UNKNOWN
}

private fun body(v: UpdateView) = when (v) {
    is UpdateView.App -> UpdateTexts.bodyApp(v)
    is UpdateView.Pc -> UpdateTexts.bodyPc()
    is UpdateView.UpToDate -> UpdateTexts.BODY_OK
    is UpdateView.Unknown -> UpdateTexts.BODY_UNKNOWN
}

/** The version the installed app reports, or a question mark when the system will not say. */
fun appVersionName(context: Context): String = try {
    context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "?"
} catch (_: Exception) {
    "?"
}

/**
 * The page for the link's real state. [seeSaved] is set only for the full-screen use at launch (the way into the read-only
 * app); [onBack] only for the page opened from the notice.
 */
@Composable
fun UpdateScreen(info: OfflineInfo, seeSaved: (() -> Unit)? = null, onBack: (() -> Unit)? = null, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val connection by info.connection.collectAsStateWithLifecycle()
    val appVersion = remember(context) { appVersionName(context) }
    var browserMissing by rememberSaveable { mutableStateOf(false) }
    UpdateContent(
        updateView(connection, info.pcVersions(), appVersion), browserMissing,
        UpdateActions(
            download = { browserMissing = !openDownloadPage(context::startActivity) },
            retry = info.retryNow, seeSaved = seeSaved, back = onBack,
        ),
        modifier,
    )
}

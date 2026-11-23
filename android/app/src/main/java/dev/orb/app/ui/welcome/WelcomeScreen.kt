package dev.orb.app.ui.welcome

import android.content.ClipboardManager
import android.content.Context
import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.orb.app.link.net.FoundPc
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.kit.OrbBanner
import dev.orb.app.ui.kit.OrbBannerKind
import dev.orb.app.ui.kit.OrbButton
import dev.orb.app.ui.kit.OrbFoot
import dev.orb.app.ui.kit.OrbButtonKind
import dev.orb.app.ui.kit.OrbCard
import dev.orb.app.ui.kit.OrbDialog
import dev.orb.app.ui.kit.OrbDialogAction
import dev.orb.app.ui.kit.OrbIconButton
import dev.orb.app.ui.kit.OrbKit
import dev.orb.app.ui.kit.OrbNote
import dev.orb.app.ui.kit.OrbProgress
import dev.orb.app.ui.kit.OrbSheet
import dev.orb.app.ui.kit.OrbSwitch
import dev.orb.app.ui.kit.OrbSnackbar
import dev.orb.app.ui.kit.OrbSpinner
import dev.orb.app.ui.kit.OrbTextField
import dev.orb.app.ui.kit.OrbTopBar
import dev.orb.app.ui.kit.OrbWordmark
import dev.orb.app.ui.theme.OrbFonts

/** What the screens call; the real one is the view model, a picture of a state passes empty ones. */
object WelcomeTexts {
    const val PROTECT = "Proteger Orb con tu huella o tu cara"
    const val PROTECT_EN = "Protect Orb with your fingerprint or face"
    fun protect(language: String = java.util.Locale.getDefault().language) = if (language == "en") PROTECT_EN else PROTECT

    /** The texts of «Buscar mi PC en Tailscale». */
    class TailscaleTexts(val title: String, val hint: String, val search: String, val searching: String, val none: String, val store: String, val next: String, val help: String, val found: (String) -> String)
    fun tailscale(language: String = java.util.Locale.getDefault().language) = if (language == "en") TailscaleTexts(
        "Find my PC on Tailscale", "PC name on Tailscale", "Search", "Looking on your Tailscale network…",
        "No Orb answered. Is Orb open on the PC and Tailscale signed in on both, with the same account? You can also scan the QR.", "Get Tailscale",
        "Now type the code shown on the PC (Settings › Devices).", "Install Tailscale on this phone and the PC and sign in with the same account. Type the PC's name as Settings › Devices shows it.",
    ) { n -> "Use $n" } else TailscaleTexts(
        "Buscar mi PC en Tailscale", "Nombre del PC en Tailscale", "Buscar", "Buscando en tu red de Tailscale…",
        "Ningún Orb ha respondido. ¿Orb está abierto en el PC y Tailscale con sesión en los dos, con la misma cuenta? También puedes escanear el QR.", "Conseguir Tailscale",
        "Ahora escribe el código que se ve en el PC (Ajustes › Dispositivos).", "Instala Tailscale en este móvil y en el PC e inicia sesión con la misma cuenta. Escribe el nombre del PC tal como lo muestra Ajustes › Dispositivos.",
    ) { n -> "Usar $n" }
}

class WelcomeActions(
    val onScan: () -> Unit = {},
    val openSheet: () -> Unit = {},
    val closeSheet: () -> Unit = {},
    val setLink: (String) -> Unit = {},
    val setCode: (String) -> Unit = {},
    val setAddress: (String) -> Unit = {},
    val paste: () -> Unit = {},
    val resolve: () -> Unit = {},
    val back: () -> Unit = {},
    val setPassword: (String) -> Unit = {},
    val toggleShowPassword: () -> Unit = {},
    val confirm: () -> Unit = {},
    val activateNotices: () -> Unit = {},
    val declineNotices: () -> Unit = {},
    val done: () -> Unit = {},
    val openThisPhone: () -> Unit = {},
    val dismissError: () -> Unit = {},
    val setProtect: (Boolean) -> Unit = {},
    val toggleTs: () -> Unit = {},
    val setTsQuery: (String) -> Unit = {},
    val searchTs: () -> Unit = {},
    val pickTs: (FoundPc) -> Unit = {},
    val openTailscaleStore: () -> Unit = {},
)

/** Tailscale's page in Google Play (or the web page when there is no Play Store). */
private fun openTailscaleStore(context: Context) {
    val open = { uri: String -> context.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(uri)).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)) }
    try { open("market://details?id=com.tailscale.ipn") } catch (e: Exception) { try { open("https://tailscale.com/download/android") } catch (_: Exception) { } }
}

/** The text on the clipboard, or null when there is none. */
fun systemClipboardText(context: Context): String? {
    val clip = (context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager)?.primaryClip ?: return null
    if (clip.itemCount == 0) return null
    return clip.getItemAt(0).coerceToText(context)?.toString()
}

/**
 * First start: welcome, fingerprint and password, then the three steps of the link. [onScan] is the scan button (the scanner, or
 * the short-code sheet on a phone with no camera); [onDone] leaves for the chats and [onOpenThisPhone] for «Este móvil».
 */
@Composable
fun WelcomeScreen(
    vm: WelcomeViewModel,
    onDone: () -> Unit,
    onOpenThisPhone: () -> Unit,
    modifier: Modifier = Modifier,
    onScan: () -> Unit = vm::openSheet,
    noticesEnabled: Boolean = false,
    readClipboard: (Context) -> String? = ::systemClipboardText,
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    LaunchedEffect(noticesEnabled) { vm.noticesChanged(noticesEnabled) }
    BackHandler(enabled = state.stage == WelcomeStage.Fingerprint && !state.checking) { vm.back() }
    val actions = WelcomeActions(
        onScan = onScan, openSheet = vm::openSheet, closeSheet = vm::closeSheet, setLink = vm::setLink, setCode = vm::setCode,
        setAddress = vm::setAddress, paste = { vm.paste(readClipboard(context)) }, resolve = vm::resolve, back = vm::back,
        setPassword = vm::setPassword, toggleShowPassword = vm::toggleShowPassword, confirm = vm::confirm,
        activateNotices = vm::activateNotices, declineNotices = vm::declineNotices, done = { vm.finish(onDone) }, openThisPhone = onOpenThisPhone, setProtect = vm::setProtect,
        dismissError = vm::dismissError, toggleTs = vm::toggleTs, setTsQuery = vm::setTsQuery, searchTs = vm::searchTs, pickTs = vm::pickTs,
        openTailscaleStore = { openTailscaleStore(context) },
    )
    WelcomeContent(state, actions, modifier)
}

@Composable
fun WelcomeContent(state: WelcomeUiState, a: WelcomeActions, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxSize().background(OrbKit.background)) {
        when (state.stage) {
            WelcomeStage.Entry -> EntryPage(state, a)
            WelcomeStage.Fingerprint -> FingerprintPage(state, a)
            WelcomeStage.Linking, WelcomeStage.Done -> LinkingPage(state, a)
        }
        if (state.stage == WelcomeStage.Entry && state.sheet) ShortCodeSheet(state, a)
        if (state.noticeDialog) {
            OrbDialog(
                onDismiss = a.declineNotices, title = "¿Avisos de Orb?", icon = OrbIcons.Bell, iconSize = 16.dp, elevation = 24.dp,
                text = "Mensajes nuevos y tareas que esperan tu OK. Puedes responder desde el aviso.",
                confirm = OrbDialogAction("Activar", a.activateNotices), dismiss = OrbDialogAction("Ahora no", a.declineNotices),
            )
        }
    }
}

@Composable
private fun Hero(title: String, modifier: Modifier = Modifier, text: androidx.compose.ui.text.AnnotatedString? = null, mark: Boolean = false) {
    Column(modifier.fillMaxWidth().padding(horizontal = 28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (mark) {
            OrbWordmark(fontSize = 32.sp)
            Spacer(Modifier.height(12.dp))
        }
        Text(
            title, Modifier.semantics { heading() }, color = OrbKit.foreground, fontSize = 24.sp, lineHeight = 30.sp,
            fontFamily = OrbFonts.title, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center,
        )
        if (text != null) Text(text, color = OrbKit.mutedForeground, fontSize = 14.5.sp, lineHeight = 22.sp, textAlign = TextAlign.Center)
    }
}

@Composable
private fun EntryPage(state: WelcomeUiState, a: WelcomeActions) {
    val failure = state.errorKind?.let { kind -> state.error?.let { kind to it } }
    if (failure != null) {
        // A spent code or a public address is a page of its own, as the mockup draws it: the notice, and the way out.
        val (kind, message) = failure
        Column(Modifier.fillMaxSize()) {
            OrbBanner(
                message, if (kind == WelcomeErrorKind.CodeSpent) OrbIcons.Clock else OrbIcons.ShieldAlert, Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 8.dp),
                kind = if (kind == WelcomeErrorKind.CodeSpent) OrbBannerKind.Warning else OrbBannerKind.Error,
            )
            Spacer(Modifier.weight(1f))
            OrbFoot {
                // The way out of a banner is the button; both bring the first page back as it was.
                when (kind) {
                    WelcomeErrorKind.CodeSpent -> OrbButton("Escanear otro QR", { a.dismissError(); a.onScan() }, kind = OrbButtonKind.Primary, block = true, icon = OrbIcons.ScanLine, big = true)
                    WelcomeErrorKind.NotPrivate -> OrbButton("Volver", a.dismissError, kind = OrbButtonKind.Primary, block = true, big = true)
                }
            }
        }
        return
    }
    Column(Modifier.fillMaxSize()) {
        Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
            Hero(
                "Enlaza el móvil con tu Orb", mark = true,
                text = buildAnnotatedString {
                    append("En el PC: ")
                    withStyle(SpanStyle(fontWeight = FontWeight.SemiBold, color = OrbKit.foreground)) { append("Ajustes › Dispositivos") }
                    append(" y pulsa «Mostrar código QR».")
                },
            )
        }
        OrbFoot(spacing = 6.dp) {
            OrbButton("Escanear el código QR", a.onScan, kind = OrbButtonKind.Primary, block = true, icon = OrbIcons.ScanLine, big = true)
            OrbButton("Sin cámara: código corto", a.openSheet, kind = OrbButtonKind.Ghost, block = true, icon = OrbIcons.Keyboard)
            OrbNote("Wi-Fi de casa o Tailscale. Todo va cifrado.", Modifier.fillMaxWidth().padding(top = 4.dp))
        }
    }
}

@Composable
private fun Label(text: String) = Text(text, color = OrbKit.mutedForeground, fontSize = 13.sp, lineHeight = 18.sp)

@Composable
private fun ShortCodeSheet(state: WelcomeUiState, a: WelcomeActions) {
    val linkOnly = state.linkOnly
    OrbSheet(onDismiss = a.closeSheet, title = if (linkOnly) "Pegar el enlace del QR" else "Sin cámara: código corto", showClose = true, dismissible = !state.busy) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Label(if (linkOnly) "Enlace" else "Pega el enlace")
                OrbTextField(
                    state.link, a.setLink, "orb://enlazar…", leading = OrbIcons.Link, enabled = !state.busy, keyboardType = KeyboardType.Uri,
                    trailing = { OrbButton("Pegar", a.paste, kind = OrbButtonKind.Ghost, small = true, enabled = !state.busy) },
                )
            }
            if (!linkOnly) TailscaleSearch(state, a)
            if (!linkOnly) {
                OrbNote("o escribe el código y la dirección", Modifier.fillMaxWidth())
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Label("Código")
                    OrbTextField(state.code, a.setCode, "Código de 6 caracteres", enabled = !state.busy)
                }
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Label("Dirección del PC")
                    OrbTextField(state.address, a.setAddress, "192.168.1.20:7780", enabled = !state.busy, keyboardType = KeyboardType.Uri)
                    OrbNote("Solo Wi-Fi de casa o Tailscale.")
                }
            }
            state.error?.let { Text(it, color = OrbKit.destructive, fontSize = 13.sp, lineHeight = 18.sp) }
            if (state.busy) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OrbSpinner()
                OrbNote("Preguntando al PC…")
            }
            OrbButton("Continuar", a.resolve, kind = OrbButtonKind.Primary, block = true, enabled = !state.busy)
        }
    }
}

/** «Buscar mi PC en Tailscale»: the PC's name on Tailscale, the Orbs that answer, and how to get Tailscale when it is missing. */
@Composable
private fun TailscaleSearch(state: WelcomeUiState, a: WelcomeActions) {
    val tx = WelcomeTexts.tailscale()
    // closed by default: the sheet keeps its short layout for the people who scan or type the code
    if (!state.tsOpen) return OrbButton(tx.title, a.toggleTs, kind = OrbButtonKind.Ghost, block = true, icon = OrbIcons.Monitor)
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Label(tx.title)
        OrbTextField(
            state.tsQuery, a.setTsQuery, tx.hint, enabled = !state.busy && !state.tsSearching, keyboardType = KeyboardType.Uri,
            trailing = { OrbButton(tx.search, a.searchTs, kind = OrbButtonKind.Ghost, small = true, enabled = !state.busy && !state.tsSearching && state.tsQuery.isNotBlank()) },
        )
        if (state.tsSearching) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) { OrbSpinner(); OrbNote(tx.searching) }
        state.tsFound.forEach { pc -> OrbButton(tx.found(pc.name), { a.pickTs(pc) }, kind = OrbButtonKind.Ghost, block = true, icon = OrbIcons.Monitor, enabled = !state.busy) }
        if (state.tsSearched && state.tsFound.isEmpty()) {
            OrbNote(tx.none)
            OrbButton(tx.store, a.openTailscaleStore, kind = OrbButtonKind.Ghost, small = true)
        } else if (state.tsFound.isNotEmpty()) OrbNote(tx.next)
        else OrbNote(tx.help)
    }
}

@Composable
private fun FingerprintPage(state: WelcomeUiState, a: WelcomeActions) {
    val pc = state.pc ?: return
    // The master password is typed here: keep it out of the app switcher and screenshots even when the app lock is off.
    if (!pc.passwordFree) dev.orb.app.ui.SecureWhileShown("master-password")
    Column(Modifier.fillMaxSize()) {
        OrbTopBar(
            "Comprueba que es tu PC", sideWidth = 56.dp,
            leading = { OrbIconButton(OrbIcons.ArrowLeft, "Atrás", a.back, enabled = !state.checking) },
        )
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            OrbCard(Modifier.padding(top = 4.dp)) {
                Row(Modifier.padding(horizontal = 16.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Icon(OrbIcons.Monitor, null, Modifier.size(16.dp), tint = OrbKit.mutedForeground)
                        Text("PC", color = OrbKit.mutedForeground, fontSize = 14.5.sp)
                    }
                    Text(pc.name, color = OrbKit.foreground, fontSize = 14.5.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
                }
            }
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Label("Huella de tu Orb")
                // Three groups, exactly the ones the PC shows, so the two can be compared by eye.
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (g in pc.groups) {
                        Box(
                            Modifier.weight(1f).height(44.dp).clip(RadiusGroup).background(OrbKit.secondary),
                            contentAlignment = Alignment.Center,
                        ) { Text(g, color = OrbKit.foreground, fontSize = 18.sp, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.SemiBold, maxLines = 1) }
                    }
                }
                OrbNote("Tiene que coincidir con la que ves en el PC.")
            }
            if (pc.passwordFree) {
                // A one-use code: no password. The PC shows this phone's name to its owner, who confirms it there.
                OrbNote("Este móvil se enlaza con un código de un solo uso, sin contraseña. Antes de seguir, comprueba que la huella es la que enseña el PC. Cuando sigas, el PC te preguntará si quieres enlazarlo: confírmalo allí.")
            } else Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Label("Contraseña maestra del PC")
                val shown = if (state.checking) "•".repeat(state.passwordLength) else state.password
                OrbTextField(
                    shown, a.setPassword, "Contraseña maestra del PC", placeholder = "", leading = OrbIcons.KeyRound, enabled = !state.checking,
                    secret = !state.showPassword && !state.checking, invalid = state.passwordError != null, onDone = a.confirm,
                    keyboardType = KeyboardType.Password,
                    trailing = {
                        OrbIconButton(
                            if (state.showPassword) OrbIcons.EyeOff else OrbIcons.Eye, if (state.showPassword) "Ocultar" else "Mostrar",
                            a.toggleShowPassword, enabled = !state.checking,
                        )
                    },
                )
                val bad = state.passwordError
                if (bad != null) Text(bad, color = OrbKit.destructive, fontSize = 12.sp, lineHeight = 17.sp)
                else OrbNote("Se queda en el móvil: solo demuestra que la sabes.")
            }
        }
        OrbFoot(spacing = 10.dp) {
            state.error?.let { Text(it, color = OrbKit.destructive, fontSize = 13.sp, lineHeight = 18.sp) }
            if (state.checking) {
                Waiting()
                OrbNote(if (pc.passwordFree) "Esperando la confirmación en el PC…" else "Comprobando la contraseña en segundo plano…", Modifier.fillMaxWidth())
            }
            OrbButton(
                when { state.checking -> if (pc.passwordFree) "Esperando al PC…" else "Comprobando…"; pc.passwordFree -> "Coincide, enlazar"; pc.viaCode -> "Coincide con la del PC"; else -> "Coincide, enlazar" },
                a.confirm, kind = OrbButtonKind.Primary, block = true, enabled = !state.checking, big = true,
            )
        }
    }
}

private val RadiusGroup = androidx.compose.foundation.shape.RoundedCornerShape(12.dp)

/** A bar that moves while the PC is being asked; the real time is not known, so it does not pretend to be a percentage. */
@Composable
private fun Waiting() {
    val t = rememberInfiniteTransition(label = "waiting")
    val f by t.animateFloat(0.15f, 0.9f, infiniteRepeatable(tween(1400, easing = LinearEasing), RepeatMode.Reverse), label = "fraction")
    OrbProgress(f, description = "Comprobando la contraseña")
}

@Composable
private fun LinkingPage(state: WelcomeUiState, a: WelcomeActions) {
    val pc = state.pc
    // While the notices question is open the page still reads «Enlazando…» and offers no exit, as the mockup does.
    val done = state.stage == WelcomeStage.Done && !state.noticeDialog
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center) {
            Hero(
                if (done) "Listo, enlazado" else "Enlazando…",
                text = if (done && pc != null) androidx.compose.ui.text.AnnotatedString("${pc.name} está enlazado." + if (state.noticesOn) " Avisos activados." else "") else null,
            )
            Spacer(Modifier.height(24.dp))
            val labels = listOf(if (pc?.viaCode == true) "Código corto válido" else "Código QR válido", if (pc?.passwordFree == true) "Confirmado en el PC" else "Contraseña comprobada", "Guardando la llave en este móvil")
            Column(Modifier.padding(horizontal = 24.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                labels.forEachIndexed { i, text ->
                    val ok = i < state.stepsDone
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        when {
                            ok -> Icon(OrbIcons.CircleCheck, null, Modifier.size(20.dp), tint = OrbKit.success)
                            i == state.stepsDone -> OrbSpinner(size = 20.dp)
                            else -> Icon(OrbIcons.Circle, null, Modifier.size(20.dp), tint = OrbKit.faintForeground)
                        }
                        Text(text, color = if (ok || i == state.stepsDone) OrbKit.foreground else OrbKit.faintForeground, fontSize = 15.sp)
                    }
                }
            }
            if (state.stage != WelcomeStage.Done) OrbProgress(state.stepsDone / 3f + 1f / 6f, Modifier.padding(start = 16.dp, end = 16.dp, top = 24.dp), description = "Enlazando")
            if (done && state.protectOffer) {
                Row(Modifier.padding(horizontal = 24.dp, vertical = 16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(WelcomeTexts.protect(), Modifier.weight(1f), color = OrbKit.foreground, fontSize = 15.sp)
                    OrbSwitch(state.protect, a.setProtect, label = WelcomeTexts.protect())
                }
            }
            if (done) OrbFoot(Modifier.padding(top = 24.dp)) {
                OrbButton("Ir a Chats", a.done, kind = OrbButtonKind.Primary, block = true, big = true)
            }
        }
        if (state.noticesLater && done) {
            OrbSnackbar(
                "Podrás activar los avisos en Este móvil", Modifier.align(Alignment.BottomCenter).padding(start = 16.dp, end = 16.dp, bottom = 48.dp),
                actionLabel = "Abrir", onAction = a.openThisPhone,
            )
        }
    }
}
